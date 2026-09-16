import { G05_TIMING, G09_TIMING, type TimelineEvent } from "./eventTimeline";

export type ObjectiveTrialPayload = {
  schemaVersion: "objective-trials.v1";
  trialUid: string;
  trialType: "projectile" | "area" | "chest";
  trialIndex: number;
  timelineEventId: string;
  stage: "A" | "B";
  visualAvailability: "limited" | "full";
  startedAtMs: number;
  endedAtMs: number;
  trialValid: boolean;
  invalidReason: "hardware_failure" | "operator_skip" | "run_interrupted" | "game_error" | null;
  success: 0 | 1 | null;
  parameters: Record<string, string | number | boolean | null>;
  metrics: Record<string, string | number | boolean | null>;
};

type ActiveTrial = {
  event: TimelineEvent;
  startedAtMs: number;
  playerStartX: number;
  center?: number;
  chestX?: number;
  firstJumpAtMs?: number;
  lastAreaSampleAtMs?: number;
  lastInside?: boolean;
  dwellTimeMs: number;
  areaExitAtMs?: number;
};

export class PassiveTrialTracker {
  private active = new Map<string, ActiveTrial>();
  constructor(private readonly runId: string) {}

  start(event: TimelineEvent, atMs: number, playerX: number, center?: number, chestX?: number): void {
    if (!["projectile", "area", "chest-discovery"].includes(event.kind) || this.active.has(event.id)) return;
    const halfWidth = Number(event.parameters.halfWidth ?? 0);
    this.active.set(event.id, { event, startedAtMs: atMs, playerStartX: playerX, center, chestX, dwellTimeMs: 0,
      lastAreaSampleAtMs: event.kind === "area" ? atMs : undefined,
      lastInside: event.kind === "area" && center !== undefined ? Math.abs(playerX - center) < halfWidth : undefined });
  }

  observeJump(atMs: number): void {
    for (const trial of this.active.values()) if (trial.event.kind === "projectile" && trial.firstJumpAtMs === undefined && atMs >= trial.startedAtMs) trial.firstJumpAtMs = atMs;
  }

  sampleArea(eventId: string, atMs: number, playerX: number): void {
    const trial = this.active.get(eventId);
    if (!trial || trial.event.kind !== "area" || trial.center === undefined) return;
    const halfWidth = Number(trial.event.parameters.halfWidth ?? 0);
    const inside = Math.abs(playerX - trial.center) < halfWidth;
    if (trial.lastAreaSampleAtMs !== undefined && trial.lastInside) trial.dwellTimeMs += Math.max(0, atMs - trial.lastAreaSampleAtMs);
    if (trial.lastInside === true && !inside && trial.areaExitAtMs === undefined) trial.areaExitAtMs = atMs;
    trial.lastAreaSampleAtMs = atMs;
    trial.lastInside = inside;
  }

  trialUid(eventId: string): string | undefined {
    return this.active.has(eventId) ? `${this.runId}:${eventId}` : undefined;
  }

  finish(eventId: string, endedAtMs: number, result: { hit: boolean; chestFoundAtMs?: number; invalidReason?: ObjectiveTrialPayload["invalidReason"] }): ObjectiveTrialPayload | undefined {
    const trial = this.active.get(eventId);
    if (!trial) return undefined;
    this.active.delete(eventId);
    const { event } = trial;
    const stage = String(event.parameters.stage ?? (event.id.startsWith("G09") || event.id.startsWith("G10") || event.id.startsWith("G11") || event.id.startsWith("G12") ? "B" : "A")) as "A" | "B";
    const invalidReason = result.invalidReason ?? null;
    return {
      schemaVersion: "objective-trials.v1", trialUid: `${this.runId}:${event.id}`,
      trialType: event.kind === "chest-discovery" ? "chest" : event.kind as "projectile" | "area",
      trialIndex: Number(event.parameters.stageOrdinal ?? event.parameters.chestTrialIndex ?? (event.id === "G05" || event.id === "G09" ? 1 : 0)), timelineEventId: event.id, stage,
      visualAvailability: event.visibility === "full" ? "full" : "limited", startedAtMs: trial.startedAtMs, endedAtMs,
      trialValid: invalidReason === null, invalidReason, success: invalidReason === null ? (result.hit ? 0 : 1) : null,
      parameters: { direction: String(event.parameters.direction ?? ""), speed: String(event.parameters.speed ?? ""), spawnX: finite(event.parameters.spawnX), center: trial.center ?? null, halfWidth: finite(event.parameters.halfWidth), chestX: trial.chestX ?? null, playerStartX: trial.playerStartX, directOpen: event.parameters.directOpen === true, completedAttackCount: finite(event.parameters.completedAttackCount) },
      metrics: {
        firstJumpRtMs: trial.firstJumpAtMs === undefined ? null : trial.firstJumpAtMs - trial.startedAtMs,
        areaExitMs: trial.areaExitAtMs === undefined ? null : trial.areaExitAtMs - trial.startedAtMs,
        dwellTimeMs: event.kind === "area" ? Math.round(trial.dwellTimeMs) : null,
        audioOnsetMs: event.kind === "chest-discovery"
          ? trial.startedAtMs + Number(event.parameters.audioStartMs ?? (event.id === "G05" ? G05_TIMING.audioStartMs : G09_TIMING.audioStartMs))
          : null,
        interactionTimeMs: event.kind === "chest-discovery" ? result.chestFoundAtMs ?? null : null,
        chestFoundAtMs: result.chestFoundAtMs ?? null,
        completionTimeMs: event.kind !== "chest-discovery" || result.chestFoundAtMs === undefined
          ? null
          : result.chestFoundAtMs - (trial.startedAtMs + Number(event.parameters.audioStartMs ?? (event.id === "G05" ? G05_TIMING.audioStartMs : G09_TIMING.audioStartMs)))
      }
    };
  }
}

function finite(value: unknown): number | null { return typeof value === "number" && Number.isFinite(value) ? value : null; }
