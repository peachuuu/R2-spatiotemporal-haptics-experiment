import type { GameEventRecord, GameRunResult, GameTerminalStatus, LaunchConfig, TimelineEventRecord } from "./types";

export class GameTelemetry {
  readonly events: GameEventRecord[] = [];
  private timelineSeed?: string; private realizedStageOrder?: string[]; private timelineEvents?: TimelineEventRecord[];
  constructor(private readonly config: LaunchConfig) {}
  record(record: Omit<GameEventRecord, "sessionId" | "runId" | "conditionId" | "projectileSequenceId" | "areaSequenceId">) { const event = { ...this.config, ...record }; this.events.push(event); return event; }
  setTimelineMetadata(metadata: { seed: string; order: string[]; records: TimelineEventRecord[] }) { this.timelineSeed = metadata.seed; this.realizedStageOrder = [...metadata.order]; this.timelineEvents = [...metadata.records]; }
  complete(status: GameTerminalStatus, elapsedMs: number): GameRunResult {
    const hapticMode = this.config.conditionId === "NH" ? "none" : this.config.conditionId === "STH" ? "sth" : "bh";
    return { status, elapsedMs, events: [...this.events], sessionId: this.config.sessionId, runId: this.config.runId, conditionId: this.config.conditionId, projectileSequenceId: this.config.projectileSequenceId, areaSequenceId: this.config.areaSequenceId, timelineSeed: this.timelineSeed, realizedStageOrder: this.realizedStageOrder, timelineEvents: this.timelineEvents, hapticMode, hapticDisabled: hapticMode === "none" };
  }
}
