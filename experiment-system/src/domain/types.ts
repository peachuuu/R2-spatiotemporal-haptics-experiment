import type { ObjectiveTrialRecord } from "./objective";

/**
 * Core data contracts for the study workflow system.
 * See experiment-workflow-system.md §4 "Data Contract".
 *
 * Timestamps are ISO 8601 UTC strings, except cue timings which are monotonic
 * milliseconds from the browser performance clock and are named `*Ms`.
 */

export type StudyMode = "dry-run" | "production";
export type SessionStatus = "in-progress" | "complete" | "abandoned";
export type ConditionId = "baseline" | "spatiotemporal";
export type DisplayCondition = "A" | "B";

/** Game-side condition identifiers; participants only ever see A/B labels. */
export type GameConditionId = "BH" | "STH";
export type ProjectileSequenceId = "S1" | "S2" | "S3" | "S4" | "S5" | "S6";
export type AreaSequenceId = "A1" | "A2" | "A3" | "A4";

/** Balanced block-of-two randomization provenance, recorded once per session. */
export type AllocationMetadata = {
  methodVersion: "balanced-block-v1";
  blockId: number;
  position: 0 | 1;
};

/** Shared game parameters; identical across both conditions of one session. */
export type GameAssignment = {
  timelineSeed: string;
  projectileSequenceId: ProjectileSequenceId;
  areaSequenceId: AreaSequenceId;
};

export type StepId =
  | "basic-info"
  | "consent"
  | "calibration"
  | "instruction"
  | "condition-1"
  | "assessment-1"
  | "condition-2"
  | "assessment-2"
  | "comparison"
  | "final"
  | "interview"
  | "completion";

export type FingerId =
  | "left-palm"
  | "left-thumb-index"
  | "left-middle-ring"
  | "left-little"
  | "right-palm"
  | "right-thumb-index"
  | "right-middle-ring"
  | "right-little";

export type MockTrialOutcome = "felt" | "not-felt" | "uncomfortable" | "not-run";

export type CalibrationRecord = {
  fingerId: FingerId;
  /** 校准确认的电压（点"确定"时写入）。 */
  thresholdVoltage: number;
  /** 施加的电压——当前流程与确认电压一致（保留字段以兼容既有导出 schema）。 */
  selectedVoltage: number;
  /** 本流程无模拟结果选项，恒为 "not-run"。 */
  mockTrialOutcome: MockTrialOutcome;
  recordedAt: string;
};

/** 基本信息收集的参与者档案（昵称为不透明别名，不含直接身份信息）。 */
export type ParticipantProfile = {
  nickname: string;
  age: number;
  gender: string;
  hapticExperience: string;
};

export const GENDER_OPTIONS = [
  { value: "male", label: "男" },
  { value: "female", label: "女" },
  { value: "other", label: "其他" },
  { value: "prefer-not", label: "不愿透露" }
] as const;

export const HAPTIC_EXPERIENCE_OPTIONS = [
  { value: "never", label: "从未" },
  { value: "once", label: "体验过一次" },
  { value: "multiple", label: "多次体验" }
] as const;

export type AnswerValue = string | number | boolean | string[];
export type ResponseSet = Record<string, AnswerValue>;

/**
 * 盲态事件级样本对比的单事件记录：样本 A/B 随机映射到 STH/BH（order），
 * 评分与偏好按真实触觉条件（解析后的样本 ID）存储，与呈现槽位无关。
 */
export type ComparisonEventRecord = {
  eventId: string;
  /** STH 基础样本 ID（如 sth.g03.fire）；BH 由前缀替换派生。 */
  baseSampleId: string;
  /** 盲态槽位映射：样本 A / B 各自播放的真实条件样本。 */
  order: { a: "sth" | "bh"; b: "sth" | "bh" };
  /** 按解析后样本 ID（sth.g03.fire / bh.g03.fire）存储的 0–5 适宜程度评分。 */
  ratings: Partial<Record<string, number>>;
  /** 选中的解析后样本 ID；"none" 表示无偏好；未作答为 null。 */
  preference: string | null;
  reason?: string;
};

export type AuditEventType =
  | "SessionStarted"
  | "ConsentGranted"
  | "StepEntered"
  | "StepCompleted"
  | "StepSkipped"
  | "AdapterStatus"
  | "AdapterAction"
  | "Exported";

export type AuditEvent = {
  id: string;
  at: string;
  type: AuditEventType;
  stepId?: StepId;
  detail: Record<string, AnswerValue>;
};

export type GameEventRecord = {
  sessionId: string;
  runId: string;
  conditionId: GameConditionId;
  projectileSequenceId: ProjectileSequenceId;
  areaSequenceId: AreaSequenceId;
  eventId: string;
  outcome: string;
  atMs: number;
  phase: string;
  trialIndex?: number;
  sourceEventId?: string;
  reactionTimeMs?: number;
  /** Haptic cue diagnostics from the game telemetry. */
  hapticMode?: "sth" | "bh" | "none";
  hapticDisabled?: boolean;
  hapticOutcome?: "prepared" | "skipped" | "unavailable";
  hapticBaseSampleId?: string;
  hapticResolvedSampleId?: string;
  hapticCueKey?: string;
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

export type ConditionAttemptStatus = "running" | "won" | "aborted" | "interrupted" | "error";

/** One game run attempt; retries append a new attempt and never overwrite history. */
export type ConditionAttempt = {
  attemptId: string;
  runId: string;
  status: ConditionAttemptStatus;
  startedAt: string;
  endedAt?: string;
  timelineSeed: string;
  projectileSequenceId: ProjectileSequenceId;
  areaSequenceId: AreaSequenceId;
  gameEvents: GameEventRecord[];
  realizedStageOrder: string[];
  timelineEvents: TimelineEventRecord[];
  elapsedMs?: number;
  inputMethods: string[];
  /** Aggregate over the attempt's objective events (hits, evades, mean reaction time…). */
  summary?: Record<string, string | number>;
  /** Human-readable diagnostic for interrupted/error attempts. */
  diagnostic?: string;
  /** 逐 cue 同步日志（设计规格 §10）。 */
  hapticCues: HapticCueLog[];
  /** Passive functional-trial records; never read by gameplay control. */
  objectiveTrials?: ObjectiveTrialRecord[];
  qualityFlags?: string[];
};

/** 单个触觉 cue 的完整同步记录；时间戳为浏览器 performance.now 基准（ms）。 */
export type HapticCueLog = {
  cueKey: string;
  baseSampleId: string | null;
  resolvedSampleId: string | null;
  requestedAtMs: number;
  prepareSentAtMs?: number;
  preparedAtMs?: number;
  commitSentAtMs?: number;
  mediaScheduledAtMs?: number;
  deviceStartedAtMs?: number;
  deviceStartUs?: number;
  completeAtMs?: number;
  leadMs?: number;
  /** 估算起播偏差（媒体起播相对 cueAt）。 */
  estimatedSkewMs?: number;
  outcome: "ok" | "prepare-error" | "device-error" | "stopped" | "timeout";
  errorDetail?: string;
  /** Functional trial that scheduled this cue, when the cue belongs to one. */
  trialUid?: string;
  at: string;
};

export type ConditionRun = {
  displayCondition: DisplayCondition;
  /** Hidden R2 condition id; game-side id lives on attempts/events. */
  conditionId: ConditionId;
  startedAt: string;
  endedAt?: string;
  /** Legacy timeline of event ids (kept for the pre-integration export schema). */
  events: string[];
  /** Status of the latest attempt; won only after a validated RUN_COMPLETE. */
  status: ConditionAttemptStatus;
  timelineSeed: string;
  projectileSequenceId: ProjectileSequenceId;
  areaSequenceId: AreaSequenceId;
  attempts: ConditionAttempt[];
};

export type StudySession = {
  schemaVersion: 3;
  id: string;
  participantCode: string;
  studyMode: StudyMode;
  counterbalanceCell: "AB" | "BA";
  /** Randomization provenance; absent only on never-persisted navigation drafts. */
  allocationMetadata?: AllocationMetadata;
  /** Shared game parameters; identical across both conditions of this session. */
  gameAssignment: GameAssignment;
  /** Hidden execution order; participants only ever see display labels A/B. */
  conditionOrder: ConditionId[];
  currentStepId: StepId;
  status: SessionStatus;
  participantProfile: ParticipantProfile;
  consent?: { version: string; initials?: string; grantedAt: string };
  calibration: CalibrationRecord[];
  /** 真实硬件校准快照：确认后的 per-region 输出等级与固件/样本表版本。 */
  hapticCalibration?: {
    confirmed: Partial<Record<FingerId, number>>;
    firmware: { fwMajor: number; fwMinor: number; sampleTableVersion: number } | null;
    appliedAt: string;
  };
  instructionResponses: ResponseSet;
  conditionRuns: Partial<Record<ConditionId, ConditionRun>>;
  conditionResponses: Partial<Record<ConditionId, ResponseSet>>;
  /** HXI 20 题的呈现顺序（题号 id，每条件首次进入问卷时随机生成一次并持久化）；
   *  保存退出后恢复仍用同一顺序，回答始终按题号 id 存储。缺失时按配置原序呈现。 */
  questionOrders?: Partial<Record<ConditionId, string[]>>;
  /** PXI 节选 6 题的呈现顺序（同维度题项不相邻；持久化规则同 questionOrders）。 */
  pxiQuestionOrders?: Partial<Record<ConditionId, string[]>>;
  comparisonResponses: Record<string, ComparisonEventRecord>;
  finalResponses: ResponseSet;
  interviewResponses: ResponseSet;
  skippedSteps: Array<{ stepId: StepId; reason: string; note?: string; skippedAt: string }>;
  auditLog: AuditEvent[];
  createdAt: string;
  updatedAt: string;
};

export const SKIP_REASONS = [
  "hardware unavailable",
  "game unavailable",
  "sample unavailable",
  "operator demonstration",
  "other"
] as const;

export type SkipReason = (typeof SKIP_REASONS)[number];
export type RecordedSkipReason = SkipReason | "not specified";

/** 面向操作员的显示标签；存储值保持英文枚举（数据契约）。 */
export const SKIP_REASON_LABELS: Record<SkipReason, string> = {
  "hardware unavailable": "硬件不可用",
  "game unavailable": "游戏不可用",
  "sample unavailable": "样本不可用",
  "operator demonstration": "操作员演示",
  "other": "其他"
};

export function skipReasonLabel(reason: string): string {
  if (reason === "not specified") return "未填写";
  return SKIP_REASON_LABELS[reason as SkipReason] ?? reason;
}

export type SkipInput = {
  /** Optional in dry-run: an unclassified skip is recorded as "not specified". */
  reason?: SkipReason;
  /** Required only when an explicitly selected reason is "other" (1–280 characters). */
  note?: string;
};
