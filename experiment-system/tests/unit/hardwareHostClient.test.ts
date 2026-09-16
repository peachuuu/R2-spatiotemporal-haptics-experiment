import { describe, expect, it, vi } from "vitest";
import { HardwareHostClient } from "../../src/integration/hardwareHostClient";
import { HAPTIC_BRIDGE_SOURCE, HAPTIC_BRIDGE_VERSION } from "../../src/integration/hapticMessages";

const GAME = "http://localhost:3001";
const SESSION = "session-host-1";

/** 模拟 HardwareHost iframe 的 window：拦截 postMessage，允许测试回发响应。 */
class FakeHostWindow {
  sent: Array<{ envelope: unknown; targetOrigin: string }> = [];
  postMessage(envelope: unknown, targetOrigin: string) {
    this.sent.push({ envelope, targetOrigin });
  }
}

function hostResponse(txnId: number, payload: unknown, sessionId = SESSION) {
  return {
    source: HAPTIC_BRIDGE_SOURCE,
    protocolVersion: HAPTIC_BRIDGE_VERSION,
    sessionId,
    txnId,
    type: "HAPTIC_HOST_RESPONSE",
    payload
  };
}

function deliver(windowObj: Window, host: FakeHostWindow, data: unknown, origin: string = GAME) {
  windowObj.dispatchEvent(new MessageEvent("message", { origin, source: host as unknown as Window, data }));
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

describe("HardwareHostClient", () => {
  it("sends allowlisted commands with explicit target origin and resolves matching txns", async () => {
    const host = new FakeHostWindow();
    const client = new HardwareHostClient(SESSION, GAME, host as unknown as Window);
    client.attach();

    const armPromise = client.arm(3000);
    await flush();
    expect(host.sent).toHaveLength(1);
    const sent = host.sent[0]!;
    expect(sent.targetOrigin).toBe(GAME);
    const envelope = sent.envelope as { type: string; payload: { kind: string }; txnId: number };
    expect(envelope.type).toBe("HAPTIC_HOST_COMMAND");
    expect(envelope.payload.kind).toBe("ARM");

    deliver(window, host, hostResponse(envelope.txnId, { kind: "RESULT", result: { ok: true, value: { kind: "ARMED" } } }));
    const result = await armPromise;
    expect(result).toEqual({ ok: true, value: { kind: "ARMED" } });
    client.detach();
  });

  it("ignores responses from foreign origins, sessions and windows", async () => {
    const host = new FakeHostWindow();
    const other = new FakeHostWindow();
    const client = new HardwareHostClient(SESSION, GAME, host as unknown as Window);
    client.attach();

    const prepare = client.prepareSample("07Alf", 4000);
    await flush();
    const txnId = (host.sent[0]!.envelope as { txnId: number }).txnId;

    deliver(window, host, hostResponse(txnId, { kind: "RESULT", result: { ok: true, value: { kind: "PREPARED", sampleId: "07Alf", durationUs: 1 } } }), "https://evil.example");
    deliver(window, other, hostResponse(txnId, { kind: "RESULT", result: { ok: true, value: { kind: "PREPARED", sampleId: "07Alf", durationUs: 1 } } }));
    deliver(window, host, hostResponse(txnId, { kind: "RESULT", result: { ok: true, value: { kind: "PREPARED", sampleId: "07Alf", durationUs: 1 } } }, "OTHER-SESSION"));
    await flush();
    // 事务仍挂起
    expect(prepare).toBeInstanceOf(Promise);

    deliver(window, host, hostResponse(txnId, { kind: "RESULT", result: { ok: true, value: { kind: "PREPARED", sampleId: "07Alf", durationUs: 5090000 } } }));
    const result = await prepare;
    expect(result).toEqual({ ok: true, value: { kind: "PREPARED", sampleId: "07Alf", durationUs: 5090000 } });
    client.detach();
  });

  it("fails with a typed timeout result when the host never answers", async () => {
    const host = new FakeHostWindow();
    const client = new HardwareHostClient(SESSION, GAME, host as unknown as Window);
    client.attach();
    const result = await client.hello(150);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("TIMEOUT");
    client.detach();
  });

  it("lets STOP pre-empt a pending prepare transaction", async () => {
    const host = new FakeHostWindow();
    const client = new HardwareHostClient(SESSION, GAME, host as unknown as Window);
    client.attach();

    const prepare = client.prepareSample("01", 4000);
    await flush();
    const prepareTxn = (host.sent[0]!.envelope as { txnId: number }).txnId;

    const stop = client.emergencyStop(3000);
    await flush();
    const stopEnvelope = host.sent[1]!.envelope as { txnId: number; payload: { kind: string } };
    expect(stopEnvelope.payload.kind).toBe("STOP");
    deliver(window, host, hostResponse(stopEnvelope.txnId, { kind: "RESULT", result: { ok: true, value: { kind: "STOPPED" } } }));

    const stopResult = await stop;
    expect(stopResult).toEqual({ ok: true, value: { kind: "STOPPED" } });
    const prepareResult = await prepare;
    expect(prepareResult.ok).toBe(false);
    if (!prepareResult.ok) expect(prepareResult.error.code).toBe("STOP_PREEMPTED");
    // 被抢占事务的迟到响应只能作为设备事件路径，不会复活事务
    deliver(window, host, hostResponse(prepareTxn, { kind: "RESULT", result: { ok: true, value: { kind: "PREPARED", sampleId: "01", durationUs: 1 } } }));
    client.detach();
  });

  it("relays device events and status changes to subscribers", async () => {
    const host = new FakeHostWindow();
    const client = new HardwareHostClient(SESSION, GAME, host as unknown as Window);
    client.attach();
    const events: string[] = [];
    const statuses: string[] = [];
    client.onDeviceEvent(event => events.push(event.kind));
    client.onStatusChanged(status => statuses.push(status.connected ? "connected" : "disconnected"));

    deliver(window, host, hostResponse(0, { kind: "DEVICE_EVENT", event: { kind: "COMPLETE", txnId: 3, sampleId: "01", elapsedUs: 5090000 } }));
    deliver(window, host, hostResponse(0, { kind: "STATUS_CHANGED", status: { connected: true, armed: true, busy: false, voltageCode: 50, firmware: null, fault: 0 } }));
    await flush();
    expect(events).toEqual(["COMPLETE"]);
    expect(statuses).toEqual(["connected"]);
    client.detach();
  });

  it("rejects responses with bridge-level errors into typed failures", async () => {
    const host = new FakeHostWindow();
    const client = new HardwareHostClient(SESSION, GAME, host as unknown as Window);
    client.attach();
    const prepare = client.prepareSample("07Alf", 4000);
    await flush();
    const txnId = (host.sent[0]!.envelope as { txnId: number }).txnId;
    deliver(window, host, hostResponse(txnId, { kind: "ERROR", code: "REJECTED", message: "stale session" }));
    const result = await prepare;
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toEqual({ code: "REJECTED", message: "stale session" });
    client.detach();
  });
});
