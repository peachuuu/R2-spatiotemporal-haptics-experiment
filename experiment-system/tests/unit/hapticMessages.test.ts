import { describe, expect, it } from "vitest";
import {
  HAPTIC_BRIDGE_VERSION,
  isHostEnvelope,
  isStopResponse,
  matchTransaction,
  type HostBridgeResponsePayload,
  type HostResponse,
  type ResponseEnvelope
} from "../../src/integration/hapticMessages";

const SESSION = "session-haptic-1";

function response(txnId: number, payload: HostBridgeResponsePayload): ResponseEnvelope {
  return {
    source: "r2-haptic-bridge",
    protocolVersion: HAPTIC_BRIDGE_VERSION,
    sessionId: SESSION,
    txnId,
    type: "HAPTIC_HOST_RESPONSE",
    payload
  };
}

const result = (device: HostResponse) => response(0, { kind: "RESULT", result: device });

describe("R2 <-> HardwareHost message contract", () => {
  it("accepts only bridge envelopes with matching source, version and session", () => {
    expect(isHostEnvelope(response(1, { kind: "RESULT", result: { kind: "ARMED" } }), SESSION, "RESPONSE")).toBe(true);
    expect(isHostEnvelope(response(1, { kind: "RESULT", result: { kind: "ARMED" } }), "OTHER-SESSION", "RESPONSE")).toBe(false);
    expect(
      isHostEnvelope({ ...response(1, { kind: "RESULT", result: { kind: "ARMED" } }), source: "spirit-ruins" }, SESSION, "RESPONSE")
    ).toBe(false);
    expect(
      isHostEnvelope({ ...response(1, { kind: "RESULT", result: { kind: "ARMED" } }), protocolVersion: 2 }, SESSION, "RESPONSE")
    ).toBe(false);
    expect(
      isHostEnvelope({ ...response(1, { kind: "RESULT", result: { kind: "ARMED" } }), type: "HAPTIC_HOST_COMMAND" }, SESSION, "RESPONSE")
    ).toBe(false);
    expect(isHostEnvelope(null, SESSION, "RESPONSE")).toBe(false);
  });

  it("resolves a transaction only on the matching transaction id and payload kind", () => {
    const prepared = result({ kind: "PREPARED", sampleId: "07Alf", durationUs: 5090000 });
    const withTxn = response(7, prepared.payload);
    expect(matchTransaction(withTxn, 7, "RESULT")).toEqual({ kind: "match", payload: withTxn.payload });
    expect(matchTransaction(withTxn, 8)).toEqual({ kind: "mismatch" });
    expect(matchTransaction(response(7, { kind: "ERROR", code: "TIMEOUT", message: "x" }), 7, "RESULT")).toEqual({
      kind: "mismatch"
    });
  });

  it("lets STOP pre-empt any pending transaction", () => {
    const stopResponse = result({ kind: "STOPPED" });
    const withTxn = response(99, stopResponse.payload);
    expect(matchTransaction(withTxn, 99, "RESULT")).toEqual({ kind: "match", payload: withTxn.payload });
    const payload = withTxn.payload;
    expect(payload.kind === "RESULT" && isStopResponse(payload.result as HostResponse)).toBe(true);
    // 旧事务号不会解析 STOP 响应
    expect(matchTransaction(withTxn, 42)).toEqual({ kind: "mismatch" });
  });

  it("models the full PREPARE -> PREPARED -> COMMIT -> STARTED -> COMPLETE chain", () => {
    const prepared = result({ kind: "PREPARED", sampleId: "B04a", durationUs: 3000000 });
    expect(matchTransaction(response(5, prepared.payload), 5, "RESULT")).toEqual({
      kind: "match",
      payload: prepared.payload
    });
    const started = result({ kind: "STARTED", deviceStartUs: 12345678 });
    expect(matchTransaction(response(6, started.payload), 6, "RESULT")).toEqual({
      kind: "match",
      payload: started.payload
    });
    const complete = result({ kind: "COMPLETE", sampleId: "B04a", elapsedUs: 3010000 });
    expect(matchTransaction(response(6, complete.payload), 6, "RESULT")).toEqual({
      kind: "match",
      payload: complete.payload
    });
  });

  it("surfaces structured device errors with their names", () => {
    const error = result({ kind: "ERROR", errorCode: 0x06, errorName: "SAMPLE_UNDEFINED", detail: "01" });
    expect(matchTransaction(response(5, error.payload), 5)).toEqual({ kind: "match", payload: error.payload });
  });
});
