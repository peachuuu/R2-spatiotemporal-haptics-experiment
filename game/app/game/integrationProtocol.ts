import type { GameEventRecord, GameRunResult } from "./types";
import type { ObjectiveTrialPayload } from "./objectiveTrials";

export const GAME_PROTOCOL_VERSION = 1 as const;

/**
 * Versioned message contract between the R2 experiment parent page and the
 * embedded formal game. Every message carries the protocol version and the
 * session/run identity so both sides can reject stale or foreign runs.
 */
export type GameMessageType =
  | "GAME_READY"
  | "GAME_EVENT"
  | "OBJECTIVE_TRIAL"
  | "RUN_COMPLETE"
  | "RUN_ERROR"
  | "CUE_REQUEST"
  | "CUE_RECOVERY_REQUEST";

export type GameMessage = {
  source: "spirit-ruins";
  protocolVersion: typeof GAME_PROTOCOL_VERSION;
  sessionId: string;
  runId: string;
  type: GameMessageType;
  payload?: GameEventRecord | ObjectiveTrialPayload | GameRunResult | { reason: string } | CueRequestPayload | CueRecoveryRequestPayload;
};

/** 游戏在 cue 边界发出的请求：R2 解析最终样本 ID 并协调 prepare/commit。 */
export type CueRequestPayload = {
  cueKey: string;
  trialUid?: string;
  baseSampleId: string | null;
  resolvedSampleId?: string;
  conditionId: string;
  atMs: number;
};

/** Operator asks R2 to verify the hardware before skipping a failed cue. */
export type CueRecoveryRequestPayload = {
  eventId: string;
  atMs: number;
};

export type StartRunMessage = {
  source: "spirit-ruins";
  protocolVersion: typeof GAME_PROTOCOL_VERSION;
  sessionId: string;
  runId: string;
  type: "START_RUN";
  payload?: unknown;
};

export type StartCueMessage = {
  source: "spirit-ruins";
  protocolVersion: typeof GAME_PROTOCOL_VERSION;
  sessionId: string;
  runId: string;
  type: "START_CUE";
  /** Relative delay measured by the sender immediately before postMessage. */
  payload: { delayMs: number };
};

export type CueFailureMessage = {
  source: "spirit-ruins";
  protocolVersion: typeof GAME_PROTOCOL_VERSION;
  sessionId: string;
  runId: string;
  type: "CUE_FAILURE";
  payload: { reason: string };
};

export type CueRecoveryResultMessage = {
  source: "spirit-ruins";
  protocolVersion: typeof GAME_PROTOCOL_VERSION;
  sessionId: string;
  runId: string;
  type: "CUE_RECOVERY_RESULT";
  payload: { ok: boolean; reason?: string };
};

type MessageLike = { origin: string; data: unknown };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function hasIdentity(
  value: Record<string, unknown>,
  sessionId: string,
  runId: string,
): boolean {
  return (
    value.source === "spirit-ruins" &&
    value.protocolVersion === GAME_PROTOCOL_VERSION &&
    value.sessionId === sessionId &&
    value.runId === runId
  );
}

/** Runtime guard for messages emitted by the game for the current session/run. */
export function isGameMessage(
  data: unknown,
  sessionId: string,
  runId: string,
): data is GameMessage {
  if (!isRecord(data)) return false;
  if (!hasIdentity(data, sessionId, runId)) return false;
  return ["GAME_READY", "GAME_EVENT", "OBJECTIVE_TRIAL", "RUN_COMPLETE", "RUN_ERROR", "CUE_REQUEST", "CUE_RECOVERY_REQUEST"].includes(
    String(data.type),
  );
}

export function isCueFailureMessage(data: unknown, sessionId: string, runId: string): data is CueFailureMessage {
  if (!isRecord(data) || !hasIdentity(data, sessionId, runId) || data.type !== "CUE_FAILURE" || !isRecord(data.payload)) return false;
  return typeof data.payload.reason === "string";
}

export function isCueRecoveryResultMessage(data: unknown, sessionId: string, runId: string): data is CueRecoveryResultMessage {
  if (!isRecord(data) || !hasIdentity(data, sessionId, runId) || data.type !== "CUE_RECOVERY_RESULT" || !isRecord(data.payload)) return false;
  return typeof data.payload.ok === "boolean" && (data.payload.reason === undefined || typeof data.payload.reason === "string");
}

/** Runtime guard for START_RUN commands issued by the authenticated parent. */
export function isStartRunMessage(
  data: unknown,
  sessionId: string,
  runId: string,
): data is StartRunMessage {
  if (!isRecord(data)) return false;
  if (!hasIdentity(data, sessionId, runId)) return false;
  return data.type === "START_RUN";
}

/** Runtime guard for START_CUE commands issued by the authenticated parent. */
export function isStartCueMessage(
  data: unknown,
  sessionId: string,
  runId: string,
): data is StartCueMessage {
  if (!isRecord(data)) return false;
  if (!hasIdentity(data, sessionId, runId)) return false;
  if (data.type !== "START_CUE") return false;
  if (!isRecord(data.payload)) return false;
  return typeof data.payload.delayMs === "number" && data.payload.delayMs >= 0;
}

/** Validates the message envelope origin against the trusted parent origin. */
export function isTrustedOrigin(event: MessageLike, parentOrigin: string): boolean {
  return event.origin === parentOrigin;
}
