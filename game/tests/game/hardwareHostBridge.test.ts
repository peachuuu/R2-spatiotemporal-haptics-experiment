import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  executeHostCommand,
  HOST_BRIDGE_VERSION,
  parseHostCommandEnvelope
} from "../../app/game/hardwareHostBridge";
import { HapticSerialHost } from "../../app/game/hapticHost";
import { StudyEntry } from "../../app/components/StudyEntry";
import {
  ARM_IDLE_KEEPALIVE_MS,
  isCurrentConnectionEpoch,
  isSelectedSerialDisconnect,
  shouldReleaseDisconnectedHost,
  shouldMaintainArmedIdle,
  shouldReleaseUnresponsiveConnection
} from "../../app/components/HardwareHostPage";

const PARENT = "http://localhost:5173";
const SESSION = "session-host-1";

function commandEnvelope(txnId: number, payload: unknown) {
  return {
    source: "r2-haptic-bridge",
    protocolVersion: HOST_BRIDGE_VERSION,
    sessionId: SESSION,
    txnId,
    type: "HAPTIC_HOST_COMMAND",
    payload
  };
}

describe("hardware host bridge envelope validation", () => {
  it("rejects a status reply from the connection that was just released", () => {
    const releasedConnection = 14;
    const newlySelectedConnection = 15;

    expect(isCurrentConnectionEpoch(releasedConnection, newlySelectedConnection)).toBe(false);
    expect(isCurrentConnectionEpoch(newlySelectedConnection, newlySelectedConnection)).toBe(true);
  });

  it("monitors every connected hardware state and keeps armed states alive", () => {
    expect(ARM_IDLE_KEEPALIVE_MS).toBeLessThan(10_000);
    expect(shouldMaintainArmedIdle({ connected: true, armed: true, busy: false })).toBe(true);
    expect(shouldMaintainArmedIdle({ connected: true, armed: true, busy: true })).toBe(true);
    expect(shouldMaintainArmedIdle({ connected: true, armed: false, busy: false })).toBe(true);
    expect(shouldMaintainArmedIdle({ connected: false, armed: true, busy: false })).toBe(false);
  });

  it("releases the Web Serial port after transport failure but not a valid device rejection", () => {
    expect(shouldReleaseUnresponsiveConnection("TIMEOUT", 1)).toBe(false);
    expect(shouldReleaseUnresponsiveConnection("TIMEOUT", 2)).toBe(false);
    expect(shouldReleaseUnresponsiveConnection("TIMEOUT", 3)).toBe(true);
    expect(shouldReleaseUnresponsiveConnection("IO")).toBe(true);
    expect(shouldReleaseUnresponsiveConnection("NOT_CONNECTED")).toBe(true);
    expect(shouldReleaseUnresponsiveConnection("BUSY")).toBe(false);
    expect(shouldReleaseUnresponsiveConnection("DEVICE_ERROR")).toBe(false);
  });

  it("releases the stale Web Serial handle when its read stream has ended", () => {
    expect(shouldReleaseDisconnectedHost(false)).toBe(true);
    expect(shouldReleaseDisconnectedHost(true)).toBe(false);
  });

  it("handles only the browser disconnect event for the selected port", () => {
    const selected = {};
    expect(isSelectedSerialDisconnect(selected, selected)).toBe(true);
    expect(isSelectedSerialDisconnect({}, selected)).toBe(false);
    expect(isSelectedSerialDisconnect(selected, null)).toBe(false);
  });

  it("accepts only trusted origin, source window, session, version and allowlisted payloads", () => {
    const valid = commandEnvelope(7, { kind: "PREPARE_SAMPLE", sampleId: "07Alf" });
    expect(parseHostCommandEnvelope({ origin: PARENT, source: null, data: valid }, PARENT, SESSION)).not.toHaveProperty("error");

    expect(parseHostCommandEnvelope({ origin: "https://evil.example", source: null, data: valid }, PARENT, SESSION)).toEqual({
      error: "untrusted origin"
    });
    expect(parseHostCommandEnvelope({ origin: PARENT, source: {}, data: valid }, PARENT, SESSION)).toEqual({
      error: "untrusted source window"
    });
    expect(parseHostCommandEnvelope({ origin: PARENT, source: null, data: { ...valid, sessionId: "OTHER" } }, PARENT, SESSION)).toEqual({
      error: "stale session"
    });
    expect(parseHostCommandEnvelope({ origin: PARENT, source: null, data: { ...valid, protocolVersion: 2 } }, PARENT, SESSION)).toEqual({
      error: "bad protocol version"
    });
    expect(
      parseHostCommandEnvelope(
        { origin: PARENT, source: null, data: commandEnvelope(7, { kind: "FLASH_FIRMWARE" }) },
        PARENT,
        SESSION
      )
    ).toEqual({ error: "command not allowed: FLASH_FIRMWARE" });
  });

  it("routes allowlisted commands to the transactional host", async () => {
    const host = new HapticSerialHost();
    // 未连接：所有命令必须返回显式失败（NOT_CONNECTED），而不是抛异常
    const result = await executeHostCommand(host, { kind: "PREPARE_SAMPLE", sampleId: "07Alf" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("NOT_CONNECTED");

    const stopped = await executeHostCommand(host, { kind: "STOP" });
    expect(stopped.ok).toBe(false);
  });

  it("rejects malformed payload fields before touching the port", async () => {
    const host = new HapticSerialHost();
    const badVoltage = await executeHostCommand(host, { kind: "SET_CALIBRATION", regionIndex: 0, voltageCode: 300 });
    expect(badVoltage.ok).toBe(false);
    if (!badVoltage.ok) expect(badVoltage.error.code).toBe("PROTOCOL");

    const badDelay = await executeHostCommand(host, { kind: "COMMIT_AFTER", delayMs: 9000 });
    expect(badDelay.ok).toBe(false);
    if (!badDelay.ok) expect(badDelay.error.code).toBe("PROTOCOL");
  });

  it("routes the serial-host page for the persistent iframe", () => {
    const html = renderToStaticMarkup(
      createElement(StudyEntry, {
        searchOverride:
          "?mode=serial-host&embedded=1&sessionId=S-1&parentOrigin=http%3A%2F%2Flocalhost%3A5173"
      })
    );
    expect(html).toContain("HARDWARE CONNECTION");
    expect(html).toContain("选择串口并连接");
  });
});
