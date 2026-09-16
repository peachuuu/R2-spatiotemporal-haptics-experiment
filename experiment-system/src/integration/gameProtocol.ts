/**
 * Parent-side versioned message contract for the Spirit Ruins game iframes.
 * Mirrors the game's `integrationProtocol.ts`; both sides validate origin,
 * source, protocol version and session/run identity before acting.
 */

import { conditionAt } from "../domain/session";
import { eventKey, inputMethodsOf, summarizeAttempt } from "../domain/objective";
import type {
  AreaSequenceId,
  ConditionId,
  GameConditionId,
  ProjectileSequenceId,
  StudySession
} from "../domain/types";

export { eventKey, inputMethodsOf, summarizeAttempt };

export const GAME_PROTOCOL_VERSION = 1 as const;
export const GAME_SOURCE = "spirit-ruins" as const;

/** Fixed game origin; override with VITE_GAME_ORIGIN for alternate ports. */
export const GAME_ORIGIN: string =
  import.meta.env.VITE_GAME_ORIGIN ?? "http://localhost:3001";

export function toGameCondition(id: ConditionId): GameConditionId {
  return id === "baseline" ? "BH" : "STH";
}

export type GameLaunchPayload = {
  protocolVersion: typeof GAME_PROTOCOL_VERSION;
  sessionId: string;
  runId: string;
  conditionId: GameConditionId;
  timelineSeed: string;
  projectileSequenceId: ProjectileSequenceId;
  areaSequenceId: AreaSequenceId;
  parentOrigin: string;
  /** 干跑会话传 false：游戏跳过硬件门控（无硬件演示）。 */
  gate?: boolean;
};

/**
 * Launch for one formal condition. Both conditions of a session share
 * timelineSeed/projectile/area sequences but get distinct runIds.
 */
export function createConditionLaunch(
  session: StudySession,
  index: 0 | 1,
  parentOrigin: string
): GameLaunchPayload {
  const hidden = conditionAt(session, index);
  return {
    protocolVersion: GAME_PROTOCOL_VERSION,
    sessionId: session.id,
    runId: `${session.id}-C${index + 1}`,
    conditionId: toGameCondition(hidden),
    timelineSeed: session.gameAssignment.timelineSeed,
    projectileSequenceId: session.gameAssignment.projectileSequenceId,
    areaSequenceId: session.gameAssignment.areaSequenceId,
    parentOrigin,
    // 仅生产会话启用硬件门控；干跑为无硬件演示模式（gate=0）
    gate: session.studyMode === "production"
  };
}

/** Embedded practice URL; the session id is generated and persisted by R2. */
export function createPracticeUrl(sessionId: string, parentOrigin: string): string {
  const params = new URLSearchParams({
    mode: "practice",
    embedded: "1",
    sessionId,
    parentOrigin
  });
  return `${GAME_ORIGIN}/?${params.toString()}`;
}

/** Embedded formal game URL carrying the full launch identity. */
export function createConditionUrl(launch: GameLaunchPayload): string {
  const params = new URLSearchParams({
    mode: "experiment",
    sessionId: launch.sessionId,
    runId: launch.runId,
    condition: launch.conditionId,
    projectileSequence: launch.projectileSequenceId,
    areaSequence: launch.areaSequenceId,
    timelineSeed: launch.timelineSeed,
    parentOrigin: launch.parentOrigin,
    gate: launch.gate === false ? "0" : "1"
  });
  return `${GAME_ORIGIN}/?${params.toString()}`;
}

export type PracticeMessageType = "PRACTICE_READY" | "PRACTICE_COMPLETE" | "PRACTICE_ERROR" | "CUE_REQUEST";

export type PracticeMessage = {
  source: typeof GAME_SOURCE;
  protocolVersion: typeof GAME_PROTOCOL_VERSION;
  sessionId: string;
  type: PracticeMessageType;
  payload?: unknown;
};

export type GameMessageType = "GAME_READY" | "GAME_EVENT" | "OBJECTIVE_TRIAL" | "RUN_COMPLETE" | "RUN_ERROR" | "CUE_REQUEST" | "CUE_RECOVERY_REQUEST";

export type GameMessage = {
  source: typeof GAME_SOURCE;
  protocolVersion: typeof GAME_PROTOCOL_VERSION;
  sessionId: string;
  runId: string;
  type: GameMessageType;
  payload?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Accepts only authenticated practice messages for the current session. */
export function isPracticeMessage(data: unknown, sessionId: string): data is PracticeMessage {
  if (!isRecord(data)) return false;
  if (
    data.source !== GAME_SOURCE ||
    data.protocolVersion !== GAME_PROTOCOL_VERSION ||
    data.sessionId !== sessionId
  )
    return false;
  return ["PRACTICE_READY", "PRACTICE_COMPLETE", "PRACTICE_ERROR", "CUE_REQUEST"].includes(String(data.type));
}

/** Accepts only authenticated formal-game messages for the current session/run. */
export function isGameMessage(data: unknown, sessionId: string, runId: string): data is GameMessage {
  if (!isRecord(data)) return false;
  if (
    data.source !== GAME_SOURCE ||
    data.protocolVersion !== GAME_PROTOCOL_VERSION ||
    data.sessionId !== sessionId ||
    data.runId !== runId
  )
    return false;
  return ["GAME_READY", "GAME_EVENT", "OBJECTIVE_TRIAL", "RUN_COMPLETE", "RUN_ERROR", "CUE_REQUEST", "CUE_RECOVERY_REQUEST"].includes(String(data.type));
}

/** Validates a RUN_COMPLETE payload against the launch identity before accepting it. */
export function isValidRunCompletePayload(
  data: GameMessage,
  launch: GameLaunchPayload
): data is GameMessage & { type: "RUN_COMPLETE"; payload: Record<string, unknown> } {
  const payload = data.payload;
  if (!isRecord(payload)) return false;
  if (
    payload.sessionId !== launch.sessionId ||
    payload.runId !== launch.runId ||
    payload.conditionId !== launch.conditionId ||
    payload.projectileSequenceId !== launch.projectileSequenceId ||
    payload.areaSequenceId !== launch.areaSequenceId ||
    payload.timelineSeed !== launch.timelineSeed ||
    payload.status !== "won"
  )
    return false;
  return true;
}

/** START_RUN command sent exactly once by the parent after GAME_READY. */
export function createStartRunMessage(launch: GameLaunchPayload) {
  return {
    source: GAME_SOURCE,
    protocolVersion: GAME_PROTOCOL_VERSION,
    sessionId: launch.sessionId,
    runId: launch.runId,
    type: "START_RUN" as const,
    payload: launch
  };
}
