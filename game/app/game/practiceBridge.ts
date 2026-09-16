export const PRACTICE_PROTOCOL_VERSION = 1 as const;

export type PracticeMessage = {
  source: "spirit-ruins";
  protocolVersion: typeof PRACTICE_PROTOCOL_VERSION;
  sessionId: string;
  type: "PRACTICE_READY" | "PRACTICE_COMPLETE" | "PRACTICE_ERROR" | "CUE_REQUEST";
  payload?: unknown;
};

export type PracticeCueRequest = {
  cueKey: string;
  baseSampleId: string;
  conditionId: "STH";
  atMs: number;
};

export function createPracticeBridge({
  sessionId,
  parentOrigin,
  emit,
  onStartCue,
}: {
  sessionId: string;
  parentOrigin: string;
  emit: (message: PracticeMessage, targetOrigin: string) => void;
  onStartCue?: (delayMs: number) => void;
}) {
  let readyPublished = false;
  let completePublished = false;
  const base = {
    source: "spirit-ruins" as const,
    protocolVersion: PRACTICE_PROTOCOL_VERSION,
    sessionId,
  };
  return {
    publishReady() {
      if (readyPublished) return false;
      readyPublished = true;
      emit({ ...base, type: "PRACTICE_READY" }, parentOrigin);
      return true;
    },
    publishComplete() {
      if (completePublished) return false;
      completePublished = true;
      emit({ ...base, type: "PRACTICE_COMPLETE" }, parentOrigin);
      return true;
    },
    publishError(reason: string) {
      emit(
        { ...base, type: "PRACTICE_ERROR", payload: { reason } },
        parentOrigin,
      );
    },
    publishCueRequest(payload: Omit<PracticeCueRequest, "conditionId">) {
      emit({ ...base, type: "CUE_REQUEST", payload: { ...payload, conditionId: "STH" } }, parentOrigin);
    },
    handleMessage(event: { origin: string; data: unknown }) {
      if (event.origin !== parentOrigin || typeof event.data !== "object" || event.data === null) return false;
      const data = event.data as Record<string, unknown>;
      const payload = data.payload as Record<string, unknown> | undefined;
      if (
        data.source !== "spirit-ruins" || data.protocolVersion !== PRACTICE_PROTOCOL_VERSION ||
        data.sessionId !== sessionId || data.type !== "START_CUE" ||
        payload === undefined || typeof payload.delayMs !== "number" || payload.delayMs < 0
      ) return false;
      onStartCue?.(payload.delayMs);
      return true;
    },
  };
}
