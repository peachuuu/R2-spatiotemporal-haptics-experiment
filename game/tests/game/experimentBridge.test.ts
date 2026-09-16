import { describe, expect, it, vi } from "vitest";
import { createExperimentBridge } from "../../app/game/experimentBridge";
import { GAME_PROTOCOL_VERSION } from "../../app/game/integrationProtocol";

const identity = { sessionId: "S-1", runId: "S-1-C1" };

describe("experiment bridge", () => {
  it("ignores START_RUN messages from an untrusted origin", () => {
    const onStart = vi.fn(); const bridge = createExperimentBridge({ parentOrigin: "http://localhost:5173", ...identity, onStart, onStartCue: vi.fn(), emit: vi.fn() });
    bridge.handleMessage({ origin: "https://attacker.example", data: { source: "spirit-ruins", protocolVersion: GAME_PROTOCOL_VERSION, sessionId: "S-1", runId: "S-1-C1", type: "START_RUN" } });
    expect(onStart).not.toHaveBeenCalled();
  });

  it("ignores START_RUN with a mismatched session id", () => {
    const onStart = vi.fn(); const bridge = createExperimentBridge({ parentOrigin: "http://localhost:5173", ...identity, onStart, onStartCue: vi.fn(), emit: vi.fn() });
    bridge.handleMessage({ origin: "http://localhost:5173", data: { source: "spirit-ruins", protocolVersion: GAME_PROTOCOL_VERSION, sessionId: "WRONG", runId: "S-1-C1", type: "START_RUN" } });
    expect(onStart).not.toHaveBeenCalled();
  });

  it("ignores START_RUN with a mismatched run id", () => {
    const onStart = vi.fn(); const bridge = createExperimentBridge({ parentOrigin: "http://localhost:5173", ...identity, onStart, onStartCue: vi.fn(), emit: vi.fn() });
    bridge.handleMessage({ origin: "http://localhost:5173", data: { source: "spirit-ruins", protocolVersion: GAME_PROTOCOL_VERSION, sessionId: "S-1", runId: "WRONG-RUN", type: "START_RUN" } });
    expect(onStart).not.toHaveBeenCalled();
  });

  it("ignores START_RUN without protocol version 1", () => {
    const onStart = vi.fn(); const bridge = createExperimentBridge({ parentOrigin: "http://localhost:5173", ...identity, onStart, onStartCue: vi.fn(), emit: vi.fn() });
    bridge.handleMessage({ origin: "http://localhost:5173", data: { source: "spirit-ruins", sessionId: "S-1", runId: "S-1-C1", type: "START_RUN" } });
    expect(onStart).not.toHaveBeenCalled();
  });

  it("starts a run exactly once even for repeated START_RUN messages", () => {
    const onStart = vi.fn(); const bridge = createExperimentBridge({ parentOrigin: "http://localhost:5173", ...identity, onStart, onStartCue: vi.fn(), emit: vi.fn() });
    const message = { source: "spirit-ruins", protocolVersion: GAME_PROTOCOL_VERSION, sessionId: "S-1", runId: "S-1-C1", type: "START_RUN", payload: {} };
    bridge.handleMessage({ origin: "http://localhost:5173", data: message });
    bridge.handleMessage({ origin: "http://localhost:5173", data: message });
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it("publishes readiness with protocol identity to the configured origin only", () => {
    const emit = vi.fn(); const bridge = createExperimentBridge({ parentOrigin: "http://localhost:5173", ...identity, onStart: vi.fn(), onStartCue: vi.fn(), emit });
    bridge.publishReady();
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({ source: "spirit-ruins", protocolVersion: 1, sessionId: "S-1", runId: "S-1-C1", type: "GAME_READY" }),
      "http://localhost:5173",
    );
  });

  it("publishes events and results with protocol identity", () => {
    const emit = vi.fn(); const bridge = createExperimentBridge({ parentOrigin: "http://localhost:5173", ...identity, onStart: vi.fn(), onStartCue: vi.fn(), emit });
    bridge.publishEvent({ eventId: "boss-landing" } as never);
    bridge.publishResult({ status: "won" } as never);
    expect(emit).toHaveBeenNthCalledWith(1, expect.objectContaining({ type: "GAME_EVENT", sessionId: "S-1", runId: "S-1-C1" }), "http://localhost:5173");
    expect(emit).toHaveBeenNthCalledWith(2, expect.objectContaining({ type: "RUN_COMPLETE", sessionId: "S-1", runId: "S-1-C1" }), "http://localhost:5173");
  });
});


describe("START_CUE routing", () => {
  it("routes an authenticated CUE_FAILURE without throwing", () => {
    const onCueFailure = vi.fn();
    const bridge = createExperimentBridge({ parentOrigin: "http://localhost:5173", ...identity, onStart: vi.fn(), onStartCue: vi.fn(), onCueFailure, emit: vi.fn() });
    bridge.handleMessage({
      origin: "http://localhost:5173",
      data: { source: "spirit-ruins", protocolVersion: GAME_PROTOCOL_VERSION, sessionId: "S-1", runId: "S-1-C1", type: "CUE_FAILURE", payload: { reason: "串口未连接" } }
    });
    expect(onCueFailure).toHaveBeenCalledWith("串口未连接");
  });

  it("routes identity-checked START_CUE commands to the cue callback", () => {
    const onStartCue = vi.fn();
    const bridge = createExperimentBridge({ parentOrigin: "http://localhost:5173", ...identity, onStart: vi.fn(), onStartCue, emit: vi.fn() });
    bridge.handleMessage({
      origin: "http://localhost:5173",
      data: { source: "spirit-ruins", protocolVersion: GAME_PROTOCOL_VERSION, sessionId: "S-1", runId: "S-1-C1", type: "START_CUE", payload: { delayMs: 150 } }
    });
    expect(onStartCue).toHaveBeenCalledWith(150);
  });

  it("ignores START_CUE from wrong run/session or missing payload", () => {
    const onStartCue = vi.fn();
    const bridge = createExperimentBridge({ parentOrigin: "http://localhost:5173", ...identity, onStart: vi.fn(), onStartCue, emit: vi.fn() });
    bridge.handleMessage({ origin: "http://localhost:5173", data: { source: "spirit-ruins", protocolVersion: GAME_PROTOCOL_VERSION, sessionId: "S-1", runId: "OTHER", type: "START_CUE", payload: { cueAt: 1 } } });
    bridge.handleMessage({ origin: "http://localhost:5173", data: { source: "spirit-ruins", protocolVersion: GAME_PROTOCOL_VERSION, sessionId: "S-1", runId: "S-1-C1", type: "START_CUE", payload: {} } });
    expect(onStartCue).not.toHaveBeenCalled();
  });

  it("publishes CUE_REQUEST with the cue payload and identity", () => {
    const emit = vi.fn();
    const bridge = createExperimentBridge({ parentOrigin: "http://localhost:5173", ...identity, onStart: vi.fn(), onStartCue: vi.fn(), emit });
    bridge.publishCueRequest({ cueKey: "projectile", baseSampleId: "07Alf", conditionId: "STH", atMs: 123 });
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: "CUE_REQUEST", sessionId: "S-1", runId: "S-1-C1", payload: { cueKey: "projectile", baseSampleId: "07Alf", conditionId: "STH", atMs: 123 } }),
      "http://localhost:5173"
    );
  });
});
