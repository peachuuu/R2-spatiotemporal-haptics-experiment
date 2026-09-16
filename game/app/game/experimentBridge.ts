import { isCueFailureMessage, isCueRecoveryResultMessage, isStartCueMessage, isStartRunMessage, isTrustedOrigin, GAME_PROTOCOL_VERSION } from "./integrationProtocol";
import type { CueRecoveryRequestPayload, CueRequestPayload } from "./integrationProtocol";
import type { GameEventRecord, GameRunResult } from "./types";
import type { ObjectiveTrialPayload } from "./objectiveTrials";

export type BridgeEmit = (message: unknown, targetOrigin: string) => void;

export function createExperimentBridge({
  parentOrigin,
  sessionId,
  runId,
  onStart,
  onStartCue,
  onCueFailure,
  onCueRecoveryResult,
  onPauseAfterEvent,
  emit,
}: {
  parentOrigin: string;
  sessionId: string;
  runId: string;
  onStart: (payload: unknown) => void;
  /** 父页面下发的相对共同起播延迟；游戏在本页时钟中保持 cue 边界。 */
  onStartCue: (delayMs: number) => void;
  onCueFailure?: (reason: string) => void;
  onCueRecoveryResult?: (result: { ok: boolean; reason?: string }) => void;
  onPauseAfterEvent?: () => void;
  emit: BridgeEmit;
}) {
  let started = false;
  const base = {
    source: "spirit-ruins" as const,
    protocolVersion: GAME_PROTOCOL_VERSION,
    sessionId,
    runId,
  };
  const handleMessage = (event: { origin: string; data: unknown }) => {
    if (!isTrustedOrigin(event, parentOrigin)) return;
    if (isStartRunMessage(event.data, sessionId, runId)) {
      if (started) return;
      started = true;
      onStart(event.data.payload);
      return;
    }
    if (isStartCueMessage(event.data, sessionId, runId)) {
      onStartCue(event.data.payload.delayMs);
      return;
    }
    if (isCueFailureMessage(event.data, sessionId, runId)) {
      onCueFailure?.(event.data.payload.reason);
      return;
    }
    if (isCueRecoveryResultMessage(event.data, sessionId, runId)) {
      onCueRecoveryResult?.(event.data.payload);
      return;
    }
    const data = event.data as { type?: string; sessionId?: string; runId?: string } | null;
    if (data?.type === "PAUSE_AFTER_EVENT" && data.sessionId === sessionId && data.runId === runId) onPauseAfterEvent?.();
  };
  // DOM listener wraps the typed handle so unit tests can call handleMessage
  // with a MessageLike shape directly.
  const domListener = (event: Event) => {
    const message = event as MessageEvent;
    handleMessage({ origin: message.origin, data: message.data });
  };
  return {
    handleMessage,
    attach() { window.addEventListener("message", domListener); },
    detach() { window.removeEventListener("message", domListener); },
    publishReady() { emit({ ...base, type: "GAME_READY" }, parentOrigin); },
    publishEvent(payload: GameEventRecord) { emit({ ...base, type: "GAME_EVENT", payload }, parentOrigin); },
    publishObjectiveTrial(payload: ObjectiveTrialPayload) { emit({ ...base, type: "OBJECTIVE_TRIAL", payload }, parentOrigin); },
    publishResult(payload: GameRunResult) { emit({ ...base, type: "RUN_COMPLETE", payload }, parentOrigin); },
    publishError(reason: string) { emit({ ...base, type: "RUN_ERROR", payload: { reason } }, parentOrigin); },
    publishCueRequest(payload: CueRequestPayload) { emit({ ...base, type: "CUE_REQUEST", payload }, parentOrigin); },
    publishCueRecoveryRequest(payload: CueRecoveryRequestPayload) { emit({ ...base, type: "CUE_RECOVERY_REQUEST", payload }, parentOrigin); },
  };
}
