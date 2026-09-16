import { describe, expect, it } from "vitest";
import {
  GAME_PROTOCOL_VERSION,
  isGameMessage,
  isStartRunMessage,
} from "../../app/game/integrationProtocol";

describe("integration protocol v1", () => {
  const identity = {
    source: "spirit-ruins",
    protocolVersion: GAME_PROTOCOL_VERSION,
    sessionId: "S-1",
    runId: "S-1-C1",
  };

  it("accepts a well-formed GAME_READY message", () => {
    expect(isGameMessage({ ...identity, type: "GAME_READY" }, identity.sessionId, identity.runId)).toBe(true);
  });

  it("accepts an authenticated cue-recovery request", () => {
    expect(
      isGameMessage(
        { ...identity, type: "CUE_RECOVERY_REQUEST", payload: { eventId: "G07-P02", atMs: 1200 } },
        identity.sessionId,
        identity.runId,
      ),
    ).toBe(true);
  });

  it("rejects a missing protocol version", () => {
    expect(
      isGameMessage(
        { source: "spirit-ruins", sessionId: "S-1", runId: "S-1-C1", type: "GAME_READY" },
        "S-1",
        "S-1-C1",
      ),
    ).toBe(false);
  });

  it("rejects an unknown message type", () => {
    expect(isGameMessage({ ...identity, type: "TOTALLY_UNKNOWN" }, "S-1", "S-1-C1")).toBe(false);
  });

  it("rejects a mismatched session id", () => {
    expect(isGameMessage({ ...identity, type: "GAME_EVENT", payload: {} }, "OTHER-SESSION", "S-1-C1")).toBe(false);
  });

  it("rejects a mismatched run id", () => {
    expect(isGameMessage({ ...identity, type: "RUN_COMPLETE", payload: {} }, "S-1", "OTHER-RUN")).toBe(false);
  });

  it("rejects non-object payloads", () => {
    expect(isGameMessage(42, "S-1", "S-1-C1")).toBe(false);
    expect(isGameMessage(null, "S-1", "S-1-C1")).toBe(false);
  });

  it("accepts a START_RUN message with matching identity", () => {
    expect(isStartRunMessage({ ...identity, type: "START_RUN", payload: {} }, "S-1", "S-1-C1")).toBe(true);
  });

  it("rejects START_RUN with a mismatched run id", () => {
    expect(
      isStartRunMessage({ ...identity, runId: "OTHER-RUN", type: "START_RUN" }, "S-1", "S-1-C1"),
    ).toBe(false);
  });
});
