/**
 * Pure objective-data utilities shared by the protocol layer and the session
 * domain. Kept dependency-free so both sides can import without cycles.
 */

import type { GameEventRecord } from "./types";

export type ObjectiveTrialType = "projectile" | "area" | "chest";
export type ObjectiveTrialStage = "A" | "B";
export type ObjectiveTrialVisualAvailability = "limited" | "full";
export type ObjectiveTrialInvalidReason =
  | "hardware_failure"
  | "operator_skip"
  | "run_interrupted"
  | "game_error";

/**
 * Passive record emitted by the game after one functional trial. It describes
 * what happened; gameplay never reads this object back to make a decision.
 */
export type ObjectiveTrialRecord = {
  schemaVersion: "objective-trials.v1";
  trialUid: string;
  trialType: ObjectiveTrialType;
  trialIndex: number;
  timelineEventId: string;
  stage: ObjectiveTrialStage;
  visualAvailability: ObjectiveTrialVisualAvailability;
  startedAtMs: number;
  endedAtMs: number;
  trialValid: boolean;
  invalidReason: ObjectiveTrialInvalidReason | null;
  /** 1/0 only for valid trials; null is an invalid technical attempt. */
  success: 0 | 1 | null;
  parameters: Record<string, string | number | boolean | null>;
  metrics: Record<string, string | number | boolean | null>;
};

export type DataQualityRow = {
  stage: ObjectiveTrialStage;
  visualAvailability: ObjectiveTrialVisualAvailability;
  trialType: ObjectiveTrialType;
  planned: number;
  valid: number;
  invalid: number;
  missing: number;
};

const PLANNED_TRIALS: Record<ObjectiveTrialType, number> = {
  projectile: 16,
  area: 8,
  chest: 4
};

export function objectiveTrialKey(record: ObjectiveTrialRecord): string {
  return record.trialUid;
}

/** One diagnostic row per (stage × visual availability × trial type) observed. */
export function dataQualityRows(records: ObjectiveTrialRecord[]): DataQualityRow[] {
  const keys = new Map<string, DataQualityRow>();
  for (const stage of ["A", "B"] as const) for (const visualAvailability of ["limited", "full"] as const) for (const trialType of ["projectile", "area", "chest"] as const) {
    const key = `${stage}:${visualAvailability}:${trialType}`;
    keys.set(key, { stage, visualAvailability, trialType, planned: PLANNED_TRIALS[trialType], valid: 0, invalid: 0, missing: PLANNED_TRIALS[trialType] });
  }
  for (const record of records) {
    const key = `${record.stage}:${record.visualAvailability}:${record.trialType}`;
    const row = keys.get(key) ?? {
      stage: record.stage,
      visualAvailability: record.visualAvailability,
      trialType: record.trialType,
      planned: PLANNED_TRIALS[record.trialType],
      valid: 0,
      invalid: 0,
      missing: 0
    };
    if (record.trialValid) row.valid++;
    else row.invalid++;
    row.missing = Math.max(0, row.planned - row.valid);
    keys.set(key, row);
  }
  return [...keys.values()];
}

/** Stable dedup key for GAME_EVENT records; identical replays map to one key. */
export function eventKey(record: GameEventRecord): string {
  return `${record.eventId}:${record.atMs}:${record.trialIndex ?? ""}:${record.outcome}`;
}

/** Aggregates objective events into attempt summary fields. */
export function summarizeAttempt(
  events: GameEventRecord[]
): Record<string, string | number> {
  const reactionTimes = events
    .map(event => event.reactionTimeMs)
    .filter((value): value is number => value !== undefined);
  const meanReactionTimeMs =
    reactionTimes.length > 0
      ? Math.round(reactionTimes.reduce((a, b) => a + b, 0) / reactionTimes.length)
      : 0;
  const chestSearchTimes = events
    .filter(event => event.eventId === "chest-found")
    .map(event => event.reactionTimeMs)
    .filter((value): value is number => value !== undefined);
  const meanChestSearchTimeMs = chestSearchTimes.length > 0
    ? Math.round(chestSearchTimes.reduce((a, b) => a + b, 0) / chestSearchTimes.length)
    : "";
  return {
    totalEvents: events.length,
    projectileHits: events.filter(
      event => event.eventId === "player-hit" && event.sourceEventId?.startsWith("projectile")
    ).length,
    projectileEvades: events.filter(event => event.eventId === "projectile-evaded").length,
    areaHits: events.filter(
      event => event.eventId === "player-hit" && event.sourceEventId === "area-rune"
    ).length,
    areaEscapes: events.filter(event => event.eventId === "area-escaped").length,
    meanAvailableReactionTimeMs: meanReactionTimeMs,
    chestTrialsCompleted: chestSearchTimes.length,
    meanChestSearchTimeMs,
    // Backward-compatible alias: old exports exposed one chest duration here.
    chestCueToInteractMs: meanChestSearchTimeMs,
    emergencySkips: events.filter(event => event.eventId === "timeline-event-skipped" && event.outcome === "operator-emergency-skip").length
  };
}

/** Input devices observed during a run, derived from input-method events. */
export function inputMethodsOf(events: GameEventRecord[]): string[] {
  return [...new Set(
    events
      .filter(event => event.eventId === "input-keyboard" || event.eventId === "input-gamepad")
      .map(event => (event.eventId === "input-keyboard" ? "keyboard" : "gamepad"))
  )];
}
