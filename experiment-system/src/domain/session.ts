import type {
  AllocationMetadata,
  AnswerValue,
  AreaSequenceId,
  AuditEventType,
  CalibrationRecord,
  ConditionId,
  DisplayCondition,
  FingerId,
  GameAssignment,
  GameEventRecord,
  HapticCueLog,
  ParticipantProfile,
  ProjectileSequenceId,
  StepId,
  StudyMode,
  StudySession,
  TimelineEventRecord
} from "./types";
import { eventKey, inputMethodsOf, objectiveTrialKey, summarizeAttempt, type ObjectiveTrialRecord } from "./objective";

export const FINGER_IDS: readonly FingerId[] = [
  "left-palm",
  "left-thumb-index",
  "left-middle-ring",
  "left-little",
  "right-palm",
  "right-thumb-index",
  "right-middle-ring",
  "right-little"
];

export const FINGER_LABELS: Record<FingerId, string> = {
  "left-palm": "电压（左手掌）",
  "left-thumb-index": "电压（左手拇指食指）",
  "left-middle-ring": "电压（左手中指无名指）",
  "left-little": "电压（左手小指）",
  "right-palm": "电压（右手掌）",
  "right-thumb-index": "电压（右手拇指食指）",
  "right-middle-ring": "电压（右手中指无名指）",
  "right-little": "电压（右手小指）"
};

export type NewSessionInput = {
  participantCode: string;
  studyMode: StudyMode;
  /** Randomized block-of-two cell assigned exactly once by the repository. */
  allocation: { counterbalanceCell: "AB" | "BA"; metadata: AllocationMetadata };
  /** Shared across both conditions of this session. */
  gameAssignment: GameAssignment;
  profile: ParticipantProfile;
};

export const PROJECTILE_SEQUENCE_IDS = ["S1", "S2", "S3", "S4", "S5", "S6"] as const;
export const AREA_SEQUENCE_IDS = ["A1", "A2", "A3", "A4"] as const;

/** Game parameters shared by both conditions; only the haptic policy may differ. */
export function createGameAssignment(
  randomBytes: (length: number) => Uint8Array = length =>
    crypto.getRandomValues(new Uint8Array(length))
): GameAssignment {
  const bytes = randomBytes(2);
  return {
    timelineSeed: crypto.randomUUID(),
    projectileSequenceId: PROJECTILE_SEQUENCE_IDS[
      (bytes[0] ?? 0) % PROJECTILE_SEQUENCE_IDS.length
    ] as ProjectileSequenceId,
    areaSequenceId: AREA_SEQUENCE_IDS[
      (bytes[1] ?? 0) % AREA_SEQUENCE_IDS.length
    ] as AreaSequenceId
  };
}

/** 参与者编号不再限制字符与长度——仅要求非空（导出文件名会在下载时做安全清洗）。 */
export function isValidParticipantCode(code: string): boolean {
  return code.trim() !== "";
}

/** Voltage bounds from the protocol: 0–200 V, selected >= threshold. */
export function isValidCalibrationRecord(record: CalibrationRecord): boolean {
  return (
    Number.isFinite(record.thresholdVoltage) &&
    Number.isFinite(record.selectedVoltage) &&
    record.thresholdVoltage >= 0 &&
    record.thresholdVoltage <= 200 &&
    record.selectedVoltage >= 0 &&
    record.selectedVoltage <= 200 &&
    record.selectedVoltage >= record.thresholdVoltage
  );
}

export function isAnswered(value: AnswerValue | undefined): boolean {
  return value !== undefined && value !== "" && !(Array.isArray(value) && value.length === 0);
}

export function newId(): string {
  return crypto.randomUUID();
}

export function createStudySession(input: NewSessionInput, now: string = new Date().toISOString()): StudySession {
  const { counterbalanceCell } = input.allocation;
  const conditionOrder: ConditionId[] =
    counterbalanceCell === "AB" ? ["baseline", "spatiotemporal"] : ["spatiotemporal", "baseline"];
  const session: StudySession = {
    schemaVersion: 3,
    id: newId(),
    participantCode: input.participantCode,
    studyMode: input.studyMode,
    counterbalanceCell,
    allocationMetadata: input.allocation.metadata,
    gameAssignment: input.gameAssignment,
    conditionOrder,
    currentStepId: "basic-info",
    status: "in-progress",
    participantProfile: input.profile,
    calibration: [],
    instructionResponses: {},
    conditionRuns: {},
    conditionResponses: {},
    questionOrders: {},
    pxiQuestionOrders: {},
    comparisonResponses: {},
    finalResponses: {},
    interviewResponses: {},
    skippedSteps: [],
    auditLog: [],
    createdAt: now,
    updatedAt: now
  };
  return appendAuditEvent(
    session,
    {
      type: "SessionStarted",
      detail: {
        participantCode: input.participantCode,
        studyMode: input.studyMode,
        counterbalanceCell,
        allocationMethodVersion: input.allocation.metadata.methodVersion,
        allocationBlockId: input.allocation.metadata.blockId,
        allocationPosition: input.allocation.metadata.position,
        timelineSeed: input.gameAssignment.timelineSeed,
        projectileSequenceId: input.gameAssignment.projectileSequenceId,
        areaSequenceId: input.gameAssignment.areaSequenceId
      }
    },
    now
  );
}

/** Participant-facing label: the condition that runs first is "A". */
export function getDisplayCondition(session: StudySession, conditionId: ConditionId): DisplayCondition {
  return session.conditionOrder[0] === conditionId ? "A" : "B";
}

/**
 * 条件页标题后的操作员标记：区分隐藏的真实条件，参与者无法解读。
 * baseline（BH 基础触觉）→ "○"；spatiotemporal（STH 时空触觉）→ "✦"。
 * 仅用于页面标题显示，不写入任何数据表。
 */
export function conditionMarker(conditionId: ConditionId): string {
  return conditionId === "baseline" ? "○" : "✦";
}

/** Condition at execution position 0 (first) or 1 (second). */
export function conditionAt(session: StudySession, index: 0 | 1): ConditionId {
  const id = session.conditionOrder[index];
  if (id === undefined) throw new Error("condition order is incomplete");
  return id;
}

export function appendAuditEvent(
  session: StudySession,
  event: { type: AuditEventType; stepId?: StepId; detail?: Record<string, AnswerValue> },
  at: string
): StudySession {
  return {
    ...session,
    auditLog: [
      ...session.auditLog,
      { id: newId(), at, type: event.type, stepId: event.stepId, detail: event.detail ?? {} }
    ]
  };
}

/**
 * Starts (or restarts after an interruption) a condition run. A stale
 * "running" attempt from a lost session is first marked interrupted so
 * attempt history is never silently overwritten.
 */
export function beginConditionAttempt(
  session: StudySession,
  conditionId: ConditionId,
  launch: {
    runId: string;
    timelineSeed: string;
    projectileSequenceId: ProjectileSequenceId;
    areaSequenceId: AreaSequenceId;
  },
  now: string = new Date().toISOString()
): StudySession {
  const existing = session.conditionRuns[conditionId];
  const attempts = (existing?.attempts ?? []).map(attempt =>
    attempt.status === "running"
      ? {
          ...attempt,
          status: "interrupted" as const,
          endedAt: now,
          diagnostic: "stale running attempt interrupted on recovery or restart"
        }
      : attempt
  );
  const run = {
    displayCondition: getDisplayCondition(session, conditionId),
    conditionId,
    startedAt: existing?.startedAt ?? now,
    events: existing?.events ?? [],
    status: "running" as const,
    timelineSeed: launch.timelineSeed,
    projectileSequenceId: launch.projectileSequenceId,
    areaSequenceId: launch.areaSequenceId,
    attempts: [
      ...attempts,
      {
        attemptId: newId(),
        runId: launch.runId,
        status: "running" as const,
        startedAt: now,
        timelineSeed: launch.timelineSeed,
        projectileSequenceId: launch.projectileSequenceId,
        areaSequenceId: launch.areaSequenceId,
        gameEvents: [],
        realizedStageOrder: [],
        timelineEvents: [],
        inputMethods: [],
        hapticCues: [],
        objectiveTrials: []
      }
    ]
  };
  return {
    ...session,
    conditionRuns: { ...session.conditionRuns, [conditionId]: run }
  };
}

/** Appends a deduplicated game event to the active attempt of a condition. */
export function appendConditionEvent(
  session: StudySession,
  conditionId: ConditionId,
  record: GameEventRecord
): StudySession {
  const run = session.conditionRuns[conditionId];
  const attempt = run?.attempts.at(-1);
  if (run === undefined || attempt === undefined || attempt.status !== "running") return session;
  if (attempt.gameEvents.some(existing => eventKey(existing) === eventKey(record))) return session;
  const qualityFlags =
    record.eventId === "timeline-event-skipped" && record.outcome === "operator-emergency-skip"
      ? [...new Set([...(attempt.qualityFlags ?? []), "operator-emergency-skip"])]
      : attempt.qualityFlags;
  const trial = objectiveTrialFromEvent(record);
  const objectiveTrials = trial === undefined || (attempt.objectiveTrials ?? []).some(item => objectiveTrialKey(item) === objectiveTrialKey(trial))
    ? attempt.objectiveTrials
    : [...(attempt.objectiveTrials ?? []), trial];
  return {
    ...session,
    conditionRuns: {
      ...session.conditionRuns,
      [conditionId]: {
        ...run,
        attempts: [
          ...run.attempts.slice(0, -1),
          { ...attempt, gameEvents: [...attempt.gameEvents, record], objectiveTrials, qualityFlags }
        ]
      }
    }
  };
}

function objectiveTrialFromEvent(record: GameEventRecord): ObjectiveTrialRecord | undefined {
  if (record.eventId !== "objective-trial" || record.details === undefined) return undefined;
  const d = record.details;
  const type = d.trial_type;
  const stage = d.stage;
  if ((type !== "projectile" && type !== "area" && type !== "chest") || (stage !== "A" && stage !== "B") || typeof d.trial_uid !== "string") return undefined;
  const n = (value: string | number | boolean | undefined) => typeof value === "number" && Number.isFinite(value) ? value : 0;
  const parsed = (value: unknown): Record<string, string | number | boolean | null> => {
    if (typeof value !== "string") return {};
    try { const result = JSON.parse(value); return typeof result === "object" && result !== null ? result : {}; } catch { return {}; }
  };
  const parameters = parsed(d.parameters_json);
  const metrics = parsed(d.metrics_json);
  const trialValid = d.trial_valid === true || d.trial_valid === 1 || d.trial_valid === "1"
    ? true
    : d.trial_valid === false || d.trial_valid === 0 || d.trial_valid === "0"
      ? false
      : d.success !== -1;
  const invalidReason = typeof d.invalid_reason === "string" && ["hardware_failure", "operator_skip", "run_interrupted", "game_error"].includes(d.invalid_reason)
    ? d.invalid_reason as ObjectiveTrialRecord["invalidReason"]
    : trialValid ? null : "game_error";
  return {
    schemaVersion: "objective-trials.v1", trialUid: d.trial_uid, trialType: type, trialIndex: record.trialIndex ?? 0,
    timelineEventId: record.timelineEventId ?? "", stage, visualAvailability: record.visualAvailability === "full" ? "full" : "limited",
    startedAtMs: n(d.started_at_ms), endedAtMs: n(d.ended_at_ms), trialValid, invalidReason,
    success: trialValid ? (d.success === 0 ? 0 : 1) : null, parameters, metrics
  };
}

/** Appends one passive functional-trial record; duplicate records never replace a restart. */
export function appendObjectiveTrial(
  session: StudySession,
  conditionId: ConditionId,
  record: ObjectiveTrialRecord
): StudySession {
  const run = session.conditionRuns[conditionId];
  const attempt = run?.attempts.at(-1);
  if (run === undefined || attempt === undefined || attempt.status !== "running") return session;
  const existing = attempt.objectiveTrials ?? [];
  if (existing.some(item => objectiveTrialKey(item) === objectiveTrialKey(record))) return session;
  return {
    ...session,
    conditionRuns: {
      ...session.conditionRuns,
      [conditionId]: { ...run, attempts: [...run.attempts.slice(0, -1), { ...attempt, objectiveTrials: [...existing, record] }] }
    }
  };
}

/** 追加/更新一条 cue 同步日志到当前尝试。
 * 仅当同 cueKey 且同 outcome 时才覆盖（成功记录的媒体/设备双写合并）；
 * 失败与成功的记录互不覆盖，保留完整历史。 */
export function appendHapticCue(
  session: StudySession,
  conditionId: ConditionId,
  cue: HapticCueLog
): StudySession {
  const run = session.conditionRuns[conditionId];
  const attempt = run?.attempts.at(-1);
  if (run === undefined || attempt === undefined || attempt.status !== "running") return session;
  const cues = attempt.hapticCues.filter(existing => existing.cueKey !== cue.cueKey || existing.outcome !== cue.outcome);
  return {
    ...session,
    conditionRuns: {
      ...session.conditionRuns,
      [conditionId]: {
        ...run,
        attempts: [...run.attempts.slice(0, -1), { ...attempt, hapticCues: [...cues, cue] }]
      }
    }
  };
}

/** Closes the active attempt with a validated terminal result. */
export function completeConditionAttempt(
  session: StudySession,
  conditionId: ConditionId,
  result: {
    status: "won";
    elapsedMs: number;
    realizedStageOrder?: string[];
    timelineEvents?: TimelineEventRecord[];
  },
  now: string = new Date().toISOString()
): StudySession {
  const run = session.conditionRuns[conditionId];
  const attempt = run?.attempts.at(-1);
  if (run === undefined || attempt === undefined || attempt.status !== "running") return session;
  const completed = {
    ...attempt,
    status: "won" as const,
    endedAt: now,
    elapsedMs: result.elapsedMs,
    realizedStageOrder: result.realizedStageOrder ?? [],
    timelineEvents: result.timelineEvents ?? [],
    inputMethods: inputMethodsOf(attempt.gameEvents),
    summary: summarizeAttempt(attempt.gameEvents)
  };
  return {
    ...session,
    conditionRuns: {
      ...session.conditionRuns,
      [conditionId]: {
        ...run,
        status: "won" as const,
        endedAt: now,
        attempts: [...run.attempts.slice(0, -1), completed]
      }
    }
  };
}

/** Marks the active attempt interrupted without advancing the workflow. */
export function interruptConditionAttempt(
  session: StudySession,
  conditionId: ConditionId,
  reason: string,
  now: string = new Date().toISOString()
): StudySession {
  const run = session.conditionRuns[conditionId];
  const attempt = run?.attempts.at(-1);
  if (run === undefined || attempt === undefined || attempt.status !== "running") return session;
  return {
    ...session,
    conditionRuns: {
      ...session.conditionRuns,
      [conditionId]: {
        ...run,
        status: "interrupted" as const,
        attempts: [
          ...run.attempts.slice(0, -1),
          { ...attempt, status: "interrupted" as const, endedAt: now, diagnostic: reason }
        ]
      }
    }
  };
}

/**
 * Produces a durable partial-session snapshot for a deliberate debugging exit.
 * A running condition is explicitly invalidated, while all captured events and
 * cue diagnostics remain available in the exported raw files.
 */
export function prepareDebugExportExit(
  session: StudySession,
  now: string = new Date().toISOString()
): StudySession {
  const conditionIndex = session.currentStepId === "condition-1" ? 0 : session.currentStepId === "condition-2" ? 1 : null;
  const withInterruptedAttempt = conditionIndex === null
    ? session
    : interruptConditionAttempt(session, session.conditionOrder[conditionIndex]!, "debug_export_exit", now);
  return appendAuditEvent(
    withInterruptedAttempt,
    {
      type: "Exported",
      stepId: session.currentStepId,
      detail: { kind: "debug_partial_exit", complete: false }
    },
    now
  );
}
