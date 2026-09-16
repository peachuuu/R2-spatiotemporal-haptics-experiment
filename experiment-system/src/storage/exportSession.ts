import JSZip from "jszip";
import * as XLSX from "xlsx";
import type { AnswerValue, ResponseSet, StudySession } from "../domain/types";
import { CONDITION_EVENT_IDS, EVENT_LABELS, resolvedSampleIdFor } from "../protocol/conditions.v1";
import {
  HXI_FACTOR_COLUMNS,
  HXI_QUESTION_OF_COLUMN,
  hxiKeyRows,
  PXI_FACTOR_COLUMNS,
  PXI_QUESTION_OF_COLUMN,
  pxiKeyRows,
  FINAL_QUESTIONS,
  INTERVIEW_QUESTIONS
} from "../protocol/questions.v1";
import { dataQualityRows, type ObjectiveTrialRecord } from "../domain/objective";

/**
 * Pure serializers return strings for testability; a Blob is created only at
 * download time. Exported filenames use participantCode + id only. The full
 * JSON is the primary record; four analysis-friendly flat CSVs accompany it.
 */

export function exportSessionJson(session: StudySession): string {
  return JSON.stringify(session, null, 2);
}

/** RFC-4180-safe quoting for values containing comma, quote, or newline. */
export function csvEscape(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

function formatValue(value: AnswerValue | undefined): string {
  if (value === undefined) return "";
  if (Array.isArray(value)) return value.join(";");
  return String(value);
}

function jsonValue(value: unknown): string {
  return JSON.stringify(value ?? null);
}

/**
 * 参与者编号已无字符限制，导出文件名需做安全清洗：
 * 保留 Unicode 字母/数字/下划线/连字符，其余字符替换为连字符。
 */
function sanitizeForFilename(value: string): string {
  const sanitized = value.trim().replace(/[^\p{L}\p{N}_-]+/gu, "-").replace(/^-+|-+$/g, "");
  return sanitized === "" ? "participant" : sanitized;
}

/** 本地日期 YYYYMMDD（导出文件名的日期后缀；可注入固定值供测试）。 */
export function exportDateStamp(now: Date = new Date()): string {
  const y = String(now.getFullYear());
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

/**
 * 导出文件名：`被试编号-表内容-YYYYMMDD.ext`（表内容为英文表名）。
 * 同日同编号重复导出重名时，由浏览器下载目录自动追加序号（如 ` (1)`），
 * 主记录以最新一次导出为准，每次导出均写入审计日志。
 * `json` 对应完整会话主记录（session），`csv` 对应主观问卷长表（subjective）。
 */
export function exportFileName(session: StudySession, extension: "json" | "csv", now: Date = new Date()): string {
  const suffix = extension === "json" ? "session" : "subjective";
  return `${sanitizeForFilename(session.participantCode)}-${suffix}-${exportDateStamp(now)}.${extension}`;
}

export function exportFileNameSuffix(session: StudySession, suffix: string, extension: "json" | "csv", now: Date = new Date()): string {
  return `${sanitizeForFilename(session.participantCode)}-${suffix}-${exportDateStamp(now)}.${extension}`;
}

export function toCsv(header: readonly string[], rows: string[][]): string {
  return [...[header.join(",")], ...rows.map(row => row.map(csvEscape).join(","))].join("\n") + "\n";
}

export const SUBJECTIVE_COLUMNS = [
  "session_id",
  "participant_code",
  "condition_id",
  "display_condition",
  "game_condition_id",
  "step_id",
  "question_id",
  "value",
  "recorded_at"
] as const;

function conditionContext(session: StudySession, conditionId: string) {
  const run = conditionId === "" ? undefined : session.conditionRuns[conditionId as keyof StudySession["conditionRuns"]];
  const latestAttempt = [...(run?.attempts ?? [])].reverse().find(attempt => attempt.status === "won") ?? run?.attempts.at(-1);
  const gameConditionId = latestAttempt?.gameEvents[0]?.conditionId ?? "";
  return { display: run?.displayCondition ?? "", game: gameConditionId };
}

function completedAttemptForGame(session: StudySession, gameConditionId: "BH" | "STH") {
  for (const conditionId of session.conditionOrder) {
    const run = session.conditionRuns[conditionId];
    const attempt = [...(run?.attempts ?? [])].reverse().find(candidate =>
      candidate.status === "won" && candidate.gameEvents[0]?.conditionId === gameConditionId,
    );
    if (attempt) return { conditionId, run: run!, attempt };
  }
  return undefined;
}

function answerRows(session: StudySession, stepId: string, conditionId: string, responses: ResponseSet): string[][] {
  const context = conditionContext(session, conditionId);
  return Object.keys(responses)
    .sort()
    .map(questionId => [
      session.id,
      session.participantCode,
      conditionId,
      context.display,
      context.game,
      stepId,
      questionId,
      formatValue(responses[questionId]),
      session.updatedAt
    ]);
}

function profileRows(session: StudySession): string[][] {
  const { nickname, age, gender, hapticExperience } = session.participantProfile;
  return [
    [session.id, session.participantCode, "", "", "", "basic-info", "nickname", nickname, session.updatedAt],
    [session.id, session.participantCode, "", "", "", "basic-info", "age", String(age), session.updatedAt],
    [session.id, session.participantCode, "", "", "", "basic-info", "gender", gender, session.updatedAt],
    [session.id, session.participantCode, "", "", "", "basic-info", "haptic_experience", hapticExperience, session.updatedAt]
  ];
}

/**
 * 样本对比逐事件条件键行：评分按解析后样本 ID 存储（sth.g03.fire → 5、
 * bh.g03.fire → 3），偏好行记录选中的解析后样本 ID（或 none），并附盲态
 * 槽位映射（a-sample / b-sample），分析时可按真实条件还原。
 */
function comparisonRows(session: StudySession): string[][] {
  const rows: string[][] = [];
  for (const eventId of CONDITION_EVENT_IDS) {
    const record = session.comparisonResponses[eventId];
    if (record === undefined) continue;
    const sthId = record.baseSampleId;
    const bhId = resolvedSampleIdFor(sthId, "bh");
    const push = (questionId: string, value: AnswerValue | undefined) =>
      rows.push([session.id, session.participantCode, "", "", "", "comparison", questionId, formatValue(value), session.updatedAt]);
    push(sthId, record.ratings[sthId]);
    push(bhId, record.ratings[bhId]);
    push(`${eventId}-preference`, record.preference ?? "");
    push(`${eventId}-reason`, record.reason);
    push(`${eventId}-a-sample`, record.order.a);
    push(`${eventId}-b-sample`, record.order.b);
  }
  return rows;
}

/** 问卷和访谈逐题长表（含隐藏条件 ID、显示标签与游戏条件 ID）。 */
export function toSubjectiveCsv(session: StudySession): string {
  const rows: string[][] = [
    ...profileRows(session),
    ...answerRows(session, "instruction", "", session.instructionResponses),
    ...session.conditionOrder.flatMap(conditionId =>
      answerRows(session, "condition-assessment", conditionId, session.conditionResponses[conditionId] ?? {})
    ),
    ...comparisonRows(session),
    ...answerRows(session, "final", "", session.finalResponses),
    ...answerRows(session, "interview", "", session.interviewResponses)
  ];
  return toCsv(SUBJECTIVE_COLUMNS, rows);
}

/** 保留旧名：完成页与既有测试仍引用主观 CSV。 */
export function exportSessionCsv(session: StudySession): string {
  return toSubjectiveCsv(session);
}

/**
 * HXI 因子宽表：每条件一行，HXI 20 题按因子列保存原始 1–7 分（不做反向计分），
 * 两道电刺激题固定排在因子列之后；呈现顺序无关，落列位置由题号 ↔ 因子映射决定。
 */
export const HXI_COLUMNS = [
  "session_id",
  "participant_id",
  "condition",
  "condition_id",
  "game_condition_id",
  ...HXI_FACTOR_COLUMNS,
  "comfort_electro",
  "pain_electro"
] as const;

export function toHxiCsv(session: StudySession): string {
  const rows: string[][] = [];
  for (const conditionId of session.conditionOrder) {
    const responses = session.conditionResponses[conditionId];
    if (responses === undefined) continue;
    const context = conditionContext(session, conditionId);
    rows.push([
      session.id,
      session.participantCode,
      context.display,
      conditionId,
      context.game,
      ...HXI_FACTOR_COLUMNS.map(column => formatValue(responses[HXI_QUESTION_OF_COLUMN[column]!])),
      formatValue(responses.comfort_electro),
      formatValue(responses.pain_electro)
    ]);
  }
  return toCsv(HXI_COLUMNS, rows);
}

/** hxi-key.csv：HXI 因子 ↔ 题项对照表（静态，含官方英文原文，供数据分析按列取因子分）。 */
export const HXI_KEY_COLUMNS = [
  "column",
  "factor",
  "factor_name",
  "item",
  "direction",
  "question_id",
  "item_text",
  "item_text_en",
  "scoring"
] as const;

export function toHxiKeyCsv(): string {
  return toCsv(HXI_KEY_COLUMNS, hxiKeyRows());
}

/**
 * PXI 节选因子宽表：每条件一行，6 题按因子列保存原始 −3–3 分；
 * 落列位置由题号 ↔ 因子映射决定，与呈现顺序无关。
 */
export const PXI_COLUMNS = [
  "session_id",
  "participant_id",
  "condition",
  "condition_id",
  "game_condition_id",
  ...PXI_FACTOR_COLUMNS
] as const;

export function toPxiCsv(session: StudySession): string {
  const rows: string[][] = [];
  for (const conditionId of session.conditionOrder) {
    const responses = session.conditionResponses[conditionId];
    if (responses === undefined) continue;
    const context = conditionContext(session, conditionId);
    rows.push([
      session.id,
      session.participantCode,
      context.display,
      conditionId,
      context.game,
      ...PXI_FACTOR_COLUMNS.map(column => formatValue(responses[PXI_QUESTION_OF_COLUMN[column]!]))
    ]);
  }
  return toCsv(PXI_COLUMNS, rows);
}

/** pxi-key.csv：PXI 因子 ↔ 题项对照表（静态，含官方英文原题，供数据分析按列取因子分）。 */
export const PXI_KEY_COLUMNS = [
  "column",
  "factor",
  "factor_name",
  "item",
  "direction",
  "question_id",
  "item_text",
  "item_text_en",
  "scoring"
] as const;

export function toPxiKeyCsv(): string {
  return toCsv(PXI_KEY_COLUMNS, pxiKeyRows());
}

export const GAME_EVENT_COLUMNS = [
  "session_id",
  "participant_code",
  "condition_id",
  "display_condition",
  "game_condition_id",
  "run_id",
  "attempt_id",
  "trial_uid",
  "event_id",
  "outcome",
  "at_ms",
  "phase",
  "trial_index",
  "source_event_id",
  "reaction_time_ms",
  "haptic_mode",
  "haptic_disabled",
  "haptic_outcome",
  "haptic_base_sample_id",
  "haptic_cue_key",
  "haptic_cue_at_ms",
  "recorded_at",
  "timeline_event_id",
  "visual_availability",
  "player_x",
  "player_y",
  "action",
  "details_json"
] as const;

/** 游戏客观事件逐事件长表（按尝试分组）。 */
export function toGameEventsCsv(session: StudySession): string {
  const rows: string[][] = [];
  for (const conditionId of session.conditionOrder) {
    const run = session.conditionRuns[conditionId];
    if (run === undefined) continue;
    for (const attempt of run.attempts) {
      for (const event of attempt.gameEvents) {
        rows.push([
          session.id,
          session.participantCode,
          conditionId,
          run.displayCondition,
          event.conditionId,
          event.runId,
          attempt.attemptId,
          typeof event.details?.trial_uid === "string" ? event.details.trial_uid : "",
          event.eventId,
          event.outcome,
          String(event.atMs),
          event.phase,
          event.trialIndex === undefined ? "" : String(event.trialIndex),
          event.sourceEventId ?? "",
          event.reactionTimeMs === undefined ? "" : String(event.reactionTimeMs),
          event.hapticMode ?? "",
          event.hapticDisabled === undefined ? "" : String(event.hapticDisabled),
          event.hapticOutcome ?? "",
          event.hapticBaseSampleId ?? "",
          event.hapticCueKey ?? "",
          event.hapticCueAtMs === undefined ? "" : String(event.hapticCueAtMs),
          event.recordedAt ?? "",
          event.timelineEventId ?? "",
          event.visualAvailability ?? "",
          event.playerX === undefined ? "" : String(event.playerX),
          event.playerY === undefined ? "" : String(event.playerY),
          event.action ?? "",
          jsonValue(event.details)
        ]);
      }
    }
  }
  return toCsv(GAME_EVENT_COLUMNS, rows);
}

export const OBJECTIVE_TRIAL_COLUMNS = [
  "session_id", "participant_code", "condition_id", "display_condition", "game_condition_id", "run_id", "attempt_id",
  "trial_uid", "trial_type", "trial_index", "timeline_event_id", "stage", "visual_availability", "started_at_ms", "ended_at_ms",
  "trial_valid", "invalid_reason", "success", "audio_onset_ms", "interaction_time_ms", "completion_time_ms", "parameters_json", "metrics_json"
] as const;

function objectiveTrialRows(session: StudySession): Array<{ conditionId: string; display: string; game: string; runId: string; attemptId: string; trial: ObjectiveTrialRecord }> {
  const rows: Array<{ conditionId: string; display: string; game: string; runId: string; attemptId: string; trial: ObjectiveTrialRecord }> = [];
  for (const conditionId of session.conditionOrder) {
    const run = session.conditionRuns[conditionId];
    if (run === undefined) continue;
    for (const attempt of run.attempts) for (const trial of attempt.objectiveTrials ?? []) {
      rows.push({ conditionId, display: run.displayCondition, game: attempt.gameEvents[0]?.conditionId ?? "", runId: attempt.runId, attemptId: attempt.attemptId, trial });
    }
  }
  return rows;
}

/** One passive row per functional trial; technical invalidity keeps success blank. */
export function toObjectiveTrialsCsv(session: StudySession): string {
  return toCsv(OBJECTIVE_TRIAL_COLUMNS, objectiveTrialRows(session).map(({ conditionId, display, game, runId, attemptId, trial }) => [
    session.id, session.participantCode, conditionId, display, game, runId, attemptId, trial.trialUid, trial.trialType,
    String(trial.trialIndex), trial.timelineEventId, trial.stage, trial.visualAvailability, String(trial.startedAtMs), String(trial.endedAtMs),
    trial.trialValid ? "1" : "0", trial.invalidReason ?? "", trial.success === null ? "" : String(trial.success),
    summaryNumber(numericMetric(trial, "audioOnsetMs")), summaryNumber(numericMetric(trial, "interactionTimeMs")), summaryNumber(numericMetric(trial, "completionTimeMs")),
    jsonValue(trial.parameters), jsonValue(trial.metrics)
  ]));
}

export const DATA_QUALITY_COLUMNS = [
  "session_id", "participant_code", "condition_id", "display_condition", "game_condition_id",
  "stage", "visual_availability", "trial_type", "planned", "valid", "invalid", "missing"
] as const;

export function toDataQualityCsv(session: StudySession): string {
  const rows: string[][] = [];
  for (const conditionId of session.conditionOrder) {
    const run = session.conditionRuns[conditionId];
    if (run === undefined) continue;
    const game = run.attempts.flatMap(attempt => attempt.gameEvents).at(0)?.conditionId ?? "";
    const trials = run.attempts.flatMap(attempt => attempt.objectiveTrials ?? []);
    for (const row of dataQualityRows(trials)) rows.push([
      session.id, session.participantCode, conditionId, run.displayCondition, game,
      row.stage, row.visualAvailability, row.trialType, String(row.planned), String(row.valid), String(row.invalid), String(row.missing)
    ]);
  }
  return toCsv(DATA_QUALITY_COLUMNS, rows);
}

export const GAME_SUMMARY_COLUMNS = [
  "session_id",
  "participant_code",
  "condition_id",
  "display_condition",
  "game_condition_id",
  "run_id",
  "attempt_id",
  "status",
  "started_at",
  "ended_at",
  "elapsed_ms",
  "timeline_seed",
  "projectile_sequence_id",
  "area_sequence_id",
  "realized_stage_order",
  "timeline_events",
  "total_events",
  "projectile_hits",
  "projectile_evades",
  "area_hits",
  "area_escapes",
  "mean_available_reaction_time_ms",
  "chest_trials_completed",
  "mean_chest_search_time_ms",
  "input_methods",
  "quality_flags",
  "diagnostic"
] as const;

/** 会话-条件-尝试级汇总（含共享 seed、序列与客观指标）。 */
export function toGameSummaryCsv(session: StudySession): string {
  const rows: string[][] = [];
  for (const conditionId of session.conditionOrder) {
    const run = session.conditionRuns[conditionId];
    if (run === undefined) continue;
    for (const attempt of run.attempts) {
      const summary = attempt.summary ?? {};
      rows.push([
        session.id,
        session.participantCode,
        conditionId,
        run.displayCondition,
        attempt.gameEvents[0]?.conditionId ?? "",
        attempt.runId,
        attempt.attemptId,
        attempt.status,
        attempt.startedAt,
        attempt.endedAt ?? "",
        attempt.elapsedMs === undefined ? "" : String(attempt.elapsedMs),
        attempt.timelineSeed,
        attempt.projectileSequenceId,
        attempt.areaSequenceId,
        jsonValue(attempt.realizedStageOrder),
        jsonValue(attempt.timelineEvents),
        String(summary.totalEvents ?? 0),
        String(summary.projectileHits ?? ""),
        String(summary.projectileEvades ?? ""),
        String(summary.areaHits ?? ""),
        String(summary.areaEscapes ?? ""),
        String(summary.meanAvailableReactionTimeMs ?? ""),
        String(summary.chestTrialsCompleted ?? ""),
        String(summary.meanChestSearchTimeMs ?? ""),
        jsonValue(attempt.inputMethods),
        jsonValue(attempt.qualityFlags),
        attempt.diagnostic ?? ""
      ]);
    }
  }
  return toCsv(GAME_SUMMARY_COLUMNS, rows);
}


export const HAPTIC_CUE_COLUMNS = [
  "session_id",
  "participant_code",
  "condition_id",
  "display_condition",
  "run_id",
  "attempt_id",
  "trial_uid",
  "cue_key",
  "base_sample_id",
  "resolved_sample_id",
  "requested_at_ms",
  "prepare_sent_at_ms",
  "prepared_at_ms",
  "commit_sent_at_ms",
  "media_scheduled_at_ms",
  "device_started_at_ms",
  "device_start_us",
  "lead_ms",
  "estimated_skew_ms",
  "outcome",
  "error_detail",
  "at"
] as const;

/** 逐 cue 同步日志长表（设计规格 §10 / Phase 6）。 */
export function toHapticCuesCsv(session: StudySession): string {
  const rows: string[][] = [];
  for (const conditionId of session.conditionOrder) {
    const run = session.conditionRuns[conditionId];
    if (run === undefined) continue;
    for (const attempt of run.attempts) {
      for (const cue of attempt.hapticCues) {
        rows.push([
          session.id,
          session.participantCode,
          conditionId,
          run.displayCondition,
          attempt.runId,
          attempt.attemptId,
          cue.trialUid ?? "",
          cue.cueKey,
          cue.baseSampleId ?? "",
          cue.resolvedSampleId ?? "",
          String(cue.requestedAtMs),
          cue.prepareSentAtMs === undefined ? "" : String(cue.prepareSentAtMs),
          cue.preparedAtMs === undefined ? "" : String(cue.preparedAtMs),
          cue.commitSentAtMs === undefined ? "" : String(cue.commitSentAtMs),
          cue.mediaScheduledAtMs === undefined ? "" : String(cue.mediaScheduledAtMs),
          cue.deviceStartedAtMs === undefined ? "" : String(cue.deviceStartedAtMs),
          cue.deviceStartUs === undefined ? "" : String(cue.deviceStartUs),
          cue.leadMs === undefined ? "" : String(cue.leadMs),
          cue.estimatedSkewMs === undefined ? "" : String(cue.estimatedSkewMs),
          cue.outcome,
          cue.errorDetail ?? "",
          cue.at
        ]);
      }
    }
  }
  return toCsv(HAPTIC_CUE_COLUMNS, rows);
}

export const AUDIT_COLUMNS = [
  "session_id",
  "participant_code",
  "at",
  "type",
  "step_id",
  "detail"
] as const;

/** 流程操作、中断、重试与导出记录。 */
export function toAuditCsv(session: StudySession): string {
  const rows = session.auditLog.map(event => [
    session.id,
    session.participantCode,
    event.at,
    event.type,
    event.stepId ?? "",
    jsonValue(event.detail)
  ]);
  return toCsv(AUDIT_COLUMNS, rows);
}

/** Creates the download Blob here so serializers stay pure. CSV gets a UTF-8 BOM. */
export function downloadTextFile(filename: string, content: string, mimeType: string, withBom = false): void {
  const blob = new Blob([withBom ? "﻿" : "", content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** 实验开始时间（SessionStarted 审计时刻转本地时区，缺失时用会话创建时间）→ `YYYYMMDD-HHmm`。 */
export function exportSessionStartStamp(session: StudySession, now: Date = new Date()): string {
  const started = session.auditLog.find(event => event.type === "SessionStarted")?.at ?? session.createdAt;
  const parsed = new Date(started);
  const date = Number.isNaN(parsed.getTime()) ? now : parsed;
  const y = String(date.getFullYear());
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${y}${m}${d}-${hh}${mm}`;
}

/** 压缩包名：只含被试编号与实验时间，不包含昵称。 */
export function exportSessionZipName(session: StudySession, now: Date = new Date()): string {
  const code = sanitizeForFilename(session.participantCode);
  return `${code}_${exportSessionStartStamp(session, now)}.zip`;
}

export const OBJECTIVE_SUMMARY_COLUMNS = [
  "participant_code", "session_id", "game_condition_id", "visual_availability", "condition_order_position",
  "projectile_total", "projectile_success", "projectile_failed", "projectile_success_rate",
  "area_total", "area_success", "area_failed", "area_success_rate", "chest_total", "chest_success",
  "chest_1_completion_ms", "chest_2_completion_ms", "chest_3_completion_ms", "chest_4_completion_ms",
  "chest_mean_completion_ms", "chest_median_completion_ms"
] as const;

function numericMetric(trial: ObjectiveTrialRecord, key: string): number | undefined {
  const value = trial.metrics[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function summaryNumber(value: number | undefined): string {
  return value === undefined ? "" : String(value);
}

/** Formal-result aggregate: exactly BH/STH × limited/full, sourced from completed attempts only. */
export function toObjectiveSummaryCsv(session: StudySession): string {
  const rows: string[][] = [];
  for (const gameConditionId of ["BH", "STH"] as const) {
    const source = completedAttemptForGame(session, gameConditionId);
    for (const visualAvailability of ["limited", "full"] as const) {
      const trials = (source?.attempt.objectiveTrials ?? []).filter(trial => trial.visualAvailability === visualAvailability && trial.trialValid);
      const byType = (trialType: ObjectiveTrialRecord["trialType"]) => trials.filter(trial => trial.trialType === trialType);
      const count = (trialType: ObjectiveTrialRecord["trialType"], success: 0 | 1) => byType(trialType).filter(trial => trial.success === success).length;
      const projectileTotal = byType("projectile").length;
      const areaTotal = byType("area").length;
      const chest = byType("chest").filter(trial => trial.success === 1);
      const completions = [1, 2, 3, 4].map(index => numericMetric(chest.find(trial => trial.trialIndex === index) ?? { metrics: {} } as ObjectiveTrialRecord, "completionTimeMs"));
      const observed = completions.filter((value): value is number => value !== undefined).sort((a, b) => a - b);
      const mean = observed.length === 0 ? undefined : observed.reduce((sum, value) => sum + value, 0) / observed.length;
      const median = observed.length === 0 ? undefined : observed.length % 2 === 1
        ? observed[(observed.length - 1) / 2]
        : (observed[observed.length / 2 - 1]! + observed[observed.length / 2]!) / 2;
      rows.push([
        session.participantCode, session.id, gameConditionId, visualAvailability,
        source === undefined ? "" : String(session.conditionOrder.indexOf(source.conditionId) + 1),
        String(projectileTotal), String(count("projectile", 1)), String(count("projectile", 0)), projectileTotal === 0 ? "" : String(count("projectile", 1) / projectileTotal),
        String(areaTotal), String(count("area", 1)), String(count("area", 0)), areaTotal === 0 ? "" : String(count("area", 1) / areaTotal),
        String(byType("chest").length), String(chest.length), ...completions.map(summaryNumber), summaryNumber(mean), summaryNumber(median)
      ]);
    }
  }
  return toCsv(OBJECTIVE_SUMMARY_COLUMNS, rows);
}

function gameConditionFor(session: StudySession, conditionId: string): string {
  return conditionContext(session, conditionId).game;
}

/** Five analysis-ready sheets. All values come from persisted session answers; no display labels are inferred. */
export function buildSubjectiveWorkbook(session: StudySession): ArrayBuffer {
  const workbook = XLSX.utils.book_new();
  const participant = [{ participant_code: session.participantCode, session_id: session.id, nickname: session.participantProfile.nickname, age: session.participantProfile.age, gender: session.participantProfile.gender, haptic_experience: session.participantProfile.hapticExperience, counterbalance_cell: session.counterbalanceCell, condition_order: session.conditionOrder.join(">") }];
  const conditionSurvey = session.conditionOrder.map((conditionId, index) => {
    const answers = session.conditionResponses[conditionId] ?? {};
    return { participant_code: session.participantCode, session_id: session.id, game_condition_id: gameConditionFor(session, conditionId), visual_condition_order_position: index + 1, ...Object.fromEntries(HXI_FACTOR_COLUMNS.map(column => [column, formatValue(answers[HXI_QUESTION_OF_COLUMN[column]!])])), ...Object.fromEntries(PXI_FACTOR_COLUMNS.map(column => [column, formatValue(answers[PXI_QUESTION_OF_COLUMN[column]!])])), comfort_electro: formatValue(answers.comfort_electro), pain_electro: formatValue(answers.pain_electro) };
  });
  const suitability = CONDITION_EVENT_IDS.map(eventId => {
    const record = session.comparisonResponses[eventId];
    const sthId = record?.baseSampleId ?? "";
    const bhId = sthId === "" ? "" : resolvedSampleIdFor(sthId, "bh");
    const preference = record?.preference === sthId ? "STH" : record?.preference === bhId ? "BH" : "none";
    return { participant_code: session.participantCode, session_id: session.id, event_id: eventId, event_label: EVENT_LABELS[eventId], sth_rating: record?.ratings[sthId] ?? "", bh_rating: record?.ratings[bhId] ?? "", preference_condition: preference, preference_reason: record?.reason ?? "", sample_a_condition: record?.order.a?.toUpperCase() ?? "", sample_b_condition: record?.order.b?.toUpperCase() ?? "" };
  });
  const finalPreference = session.finalResponses.final_preference;
  const finalCondition = finalPreference === "a" ? gameConditionFor(session, session.conditionOrder[0] ?? "") : finalPreference === "b" ? gameConditionFor(session, session.conditionOrder[1] ?? "") : "none";
  const finalEvaluation = [{ participant_code: session.participantCode, session_id: session.id, ...Object.fromEntries(FINAL_QUESTIONS.map(question => [question.id, formatValue(session.finalResponses[question.id])])), final_preference_true_condition: finalCondition }];
  const interview = [{ participant_code: session.participantCode, session_id: session.id, ...Object.fromEntries(INTERVIEW_QUESTIONS.map(question => [question.id, formatValue(session.interviewResponses[question.id])])) }];
  for (const [name, rows] of [["Participant", participant], ["ConditionSurvey", conditionSurvey], ["Suitability", suitability], ["FinalEvaluation", finalEvaluation], ["Interview", interview]] as const) XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), name);
  return XLSX.write(workbook, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
}

/**
 * 「导出全部数据」压缩包：内含原始、可直接分析的汇总与主观工作簿（CSV 带 UTF-8 BOM），
 * 包内使用纯表名（时间信息由压缩包文件名承载）。
 */
export async function buildSessionZip(session: StudySession, now: Date = new Date()): Promise<Blob> {
  const zip = new JSZip();
  const prefix = `${sanitizeForFilename(session.participantCode)}_${exportSessionStartStamp(session, now)}_`;
  zip.file(`raw/${prefix}session.json`, exportSessionJson(session));
  zip.file(`raw/${prefix}game-events.csv`, "﻿" + toGameEventsCsv(session));
  zip.file(`raw/${prefix}haptic-cues.csv`, "﻿" + toHapticCuesCsv(session));
  zip.file(`raw/${prefix}audit-log.csv`, "﻿" + toAuditCsv(session));
  zip.file(`analysis/${prefix}subjective.csv`, "﻿" + toSubjectiveCsv(session));
  zip.file(`analysis/${prefix}objective-summary.csv`, "﻿" + toObjectiveSummaryCsv(session));
  zip.file(`analysis/${prefix}subjective.xlsx`, buildSubjectiveWorkbook(session));
  zip.file(`qc/${prefix}data-quality.csv`, "﻿" + toDataQualityCsv(session));
  return zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
}

/** 下载 `编号-昵称-实验时间.zip`；同日同编号重复导出由浏览器下载目录自动追加序号。 */
export async function downloadSessionZip(session: StudySession, now: Date = new Date()): Promise<void> {
  const blob = await buildSessionZip(session, now);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = exportSessionZipName(session, now);
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
