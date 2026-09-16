export type ConditionId = "NH" | "BH" | "STH";
export type RunMode = "practice" | "experiment" | "developer";
export type GameTerminalStatus = "won" | "lost" | "aborted" | "timeout";
export type ProjectileSequenceId = "S1" | "S2" | "S3" | "S4" | "S5" | "S6";
export type AreaSequenceId = "A1" | "A2" | "A3" | "A4";

export type LaunchConfig = {
  mode: RunMode;
  sessionId: string;
  runId: string;
  conditionId: ConditionId;
  projectileSequenceId: ProjectileSequenceId;
  areaSequenceId: AreaSequenceId;
  /** Shared across both conditions of one session; the timeline engine seeds on it, not on runId. */
  timelineSeed?: string;
  embedded?: boolean;
  parentOrigin?: string;
  /** 正式硬件门控（PREPARE 前冻结 cue）；R2 干跑会话传 gate=0 以便无硬件演示。 */
  hapticGate?: boolean;
};
export type HapticVariant = "none" | "basic" | "spatiotemporal";
export type SensoryPolicy = {
  conditionId: ConditionId;
  hapticDelivery: "disabled" | "adapter-reserved";
  hapticVariant: HapticVariant;
  futurePatternKey: "none" | "body-generic" | "spatiotemporal";
};
export type HapticBinding = {
  conditionId: ConditionId;
  variant: HapticVariant;
  sampleKey: string;
  adapterKey: string;
  enabled: false;
};
export type GameEventId =
  | "boss-landing"
  | "boss-casting"
  | "fire-wall"
  | "ghost-pass"
  | "chest-cue"
  | "chest-opened"
  | "chest-found"
  | "projectile-left-low"
  | "projectile-right-low"
  | "projectile-left-middle"
  | "projectile-right-middle"
  | "projectile-left-high"
  | "projectile-right-high"
  | "area-rune"
  | "player-hit"
  | "projectile-evaded"
  | "area-escaped"
  | "counter-window"
  | "counter-hit"
  | "boss-defeated"
  | "run-paused"
  | "run-resumed"
  | "run-aborted"
  | "run-timeout"
  | "input-keyboard"
  | "input-gamepad"
  | "haptic-cue-prepared"
  | "haptic-cue-skipped"
  | "haptic-cue-unavailable"
  | "timeline-event-started"
  | "timeline-event-completed"
  | "timeline-event-skipped"
  | "objective-trial"
  | "player-move-start"
  | "player-move-stop"
  | "player-jump"
  | "player-interact";
export type GameEventRecord = {
  sessionId: string;
  runId: string;
  conditionId: ConditionId;
  projectileSequenceId: ProjectileSequenceId;
  areaSequenceId: AreaSequenceId;
  eventId: GameEventId;
  outcome: string;
  atMs: number;
  phase: string;
  trialIndex?: number;
  sourceEventId?: GameEventId;
  reactionTimeMs?: number;
  /** Haptic cue diagnostics (NONE mode logs skipped cues here). */
  hapticMode?: "sth" | "bh" | "none";
  hapticDisabled?: boolean;
  hapticOutcome?: "prepared" | "skipped" | "unavailable";
  hapticBaseSampleId?: string;
  hapticResolvedSampleId?: string;
  hapticCueKey?: string;
  /** 共同起播点（浏览器 performance.now 基准）与媒体实际开始时刻。 */
  hapticCueAtMs?: number;
  recordedAt?: string;
  timelineEventId?: string;
  visualAvailability?: "full" | "limited" | "restore";
  playerX?: number;
  playerY?: number;
  action?: string;
  details?: Record<string, string | number | boolean>;
};
export type TimelineEventRecord = {
  timelineEventId: string;
  timelineOrder: number;
  outcome: "started" | "completed" | "skipped";
  atMs: number;
};
export type GameRunResult = {
  status: GameTerminalStatus;
  elapsedMs: number;
  events: GameEventRecord[];
  sessionId: string;
  runId: string;
  conditionId: ConditionId;
  projectileSequenceId: ProjectileSequenceId;
  areaSequenceId: AreaSequenceId;
  timelineSeed?: string;
  realizedStageOrder?: string[];
  timelineEvents?: TimelineEventRecord[];
  /** NONE runs record hapticMode "none" and hapticDisabled true; they never
   *  enter formal STH/BH experiment exports. */
  hapticMode?: "sth" | "bh" | "none";
  hapticDisabled?: boolean;
};
