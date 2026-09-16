/**
 * Pure flow controller for the fixed study protocol.
 * advance/skip are pure functions over StudySession; the UI layer persists
 * the returned session and stamps `updatedAt`.
 */

import { appendAuditEvent, conditionAt, FINGER_IDS, isValidCalibrationRecord } from "../domain/session";
import type { ResponseSet, SkipInput, StepId, StudySession } from "../domain/types";
import { CONDITION_EVENT_IDS, EVENT_LABELS, resolvedSampleIdFor } from "../protocol/conditions.v1";
import {
  conditionQuestions,
  finalQuestions,
  interviewQuestions,
  validateResponses
} from "../protocol/questions.v1";
import type { Question } from "../protocol/questions.v1";

export const STEP_ORDER: readonly StepId[] = [
  "basic-info",
  "consent",
  "calibration",
  "instruction",
  "condition-1",
  "assessment-1",
  "condition-2",
  "assessment-2",
  "comparison",
  "final",
  "interview",
  "completion"
];

/**
 * Steps that embed the game in an iframe and therefore use the wide layout;
 * every other step keeps the ~960px reading width.
 */
export const GAME_STEP_IDS: readonly StepId[] = ["instruction", "condition-1", "condition-2"];

/** Operational steps that support dry-run skipping. Basic info and consent remain required. */
export const SKIPPABLE_STEPS: readonly StepId[] = [
  "calibration",
  "instruction",
  "condition-1",
  "assessment-1",
  "condition-2",
  "assessment-2",
  "comparison",
  "final",
  "interview"
];

export function nextStepId(stepId: StepId): StepId {
  const index = STEP_ORDER.indexOf(stepId);
  const next = index < 0 ? undefined : STEP_ORDER[index + 1];
  if (next === undefined) throw new Error(`no step after ${stepId}`);
  return next;
}

/** Whether the session satisfies every requirement of the given step. */
export function stepValidity(session: StudySession, stepId: StepId): { valid: boolean; problems: string[] } {
  switch (stepId) {
    case "basic-info":
      return check(
        "participant code and profile fields are required",
        isValidBasicInfo(session)
      );
    case "consent":
      return check("consent must be granted", session.consent !== undefined);
    case "calibration":
      return check(
        `calibration records for all ${FINGER_IDS.length} hardware regions are required`,
        session.calibration.length === FINGER_IDS.length && session.calibration.every(isValidCalibrationRecord)
      );
    case "instruction":
      return { valid: true, problems: [] }; // 说明文字页，无作答项
    case "condition-1":
      return check("condition run must be finished", isConditionRunComplete(session, 0));
    case "assessment-1":
      return questionnaireValidity(session.conditionResponses[conditionAt(session, 0)] ?? {}, conditionQuestions());
    case "condition-2":
      return check("condition run must be finished", isConditionRunComplete(session, 1));
    case "assessment-2":
      return questionnaireValidity(session.conditionResponses[conditionAt(session, 1)] ?? {}, conditionQuestions());
    case "comparison":
      return comparisonValidity(session);
    case "final":
      return questionnaireValidity(session.finalResponses, finalQuestions());
    case "interview":
      return questionnaireValidity(session.interviewResponses, interviewQuestions()); // 全部选填，恒有效
    case "completion":
      return { valid: true, problems: [] };
  }
}

function isValidBasicInfo(session: StudySession): boolean {
  const { nickname, age, gender, hapticExperience } = session.participantProfile;
  return (
    session.participantCode.trim() !== "" &&
    nickname.trim() !== "" &&
    Number.isFinite(age) &&
    age >= 1 &&
    age <= 120 &&
    gender.trim() !== "" &&
    hapticExperience.trim() !== ""
  );
}

function check(message: string, valid: boolean): { valid: boolean; problems: string[] } {
  return { valid, problems: valid ? [] : [message] };
}

function isConditionRunComplete(session: StudySession, index: 0 | 1): boolean {
  const run = session.conditionRuns[conditionAt(session, index)];
  return run?.attempts.some(attempt => attempt.status === "won") ?? false;
}

function questionnaireValidity(
  responses: ResponseSet,
  questions: readonly Question[]
): { valid: boolean; problems: string[] } {
  const result = validateResponses(questions, responses);
  return { valid: result.valid, problems: Object.values(result.errors) };
}

/** 样本对比有效性：9 个事件均需两项条件键评分（0–5）与偏好选择。 */
function comparisonValidity(session: StudySession): { valid: boolean; problems: string[] } {
  const problems: string[] = [];
  for (const eventId of CONDITION_EVENT_IDS) {
    const record = session.comparisonResponses[eventId];
    const label = EVENT_LABELS[eventId];
    if (record === undefined) {
      problems.push(`事件 ${label} 尚未作答`);
      continue;
    }
    const sthId = record.baseSampleId;
    const bhId = resolvedSampleIdFor(sthId, "bh");
    if (record.ratings[sthId] === undefined || record.ratings[bhId] === undefined) {
      problems.push(`事件 ${label} 两项样本评分未完成`);
    }
    if (record.preference !== sthId && record.preference !== bhId && record.preference !== "none") {
      problems.push(`事件 ${label} 偏好未选择`);
    }
  }
  return { valid: problems.length === 0, problems };
}

/**
 * Completes `stepId` and moves the session to the next step.
 * Throws when the step is not valid or is not the current step.
 */
export function advance(
  session: StudySession,
  step: { stepId: StepId; valid: boolean },
  now: string = new Date().toISOString()
): StudySession {
  if (!step.valid) throw new Error(`${step.stepId} is incomplete`);
  if (step.stepId !== session.currentStepId) {
    throw new Error(`expected current step ${session.currentStepId}, got ${step.stepId}`);
  }
  let next = appendAuditEvent(session, { type: "StepCompleted", stepId: step.stepId }, now);
  next = { ...next, currentStepId: nextStepId(step.stepId) };
  // 最终评估与试验后访谈完成后会话才算完成（访谈全部选填）。
  if (step.stepId === "interview") next = { ...next, status: "complete" };
  return appendAuditEvent(next, { type: "StepEntered", stepId: next.currentStepId }, now);
}

/**
 * Dry-run skip. A reason may be recorded by an operator but is never required.
 * Rejects production mode, basic-info/consent, unknown supplied reasons, and
 * "other" without a 1–280 character note.
 */
export function skip(
  session: StudySession,
  stepId: StepId,
  input: SkipInput,
  now: string = new Date().toISOString()
): StudySession {
  if (session.studyMode !== "dry-run") throw new Error("skipping is only available in dry-run mode");
  if (!SKIPPABLE_STEPS.includes(stepId)) throw new Error(`${stepId} cannot be skipped`);
  if (stepId !== session.currentStepId) throw new Error(`expected current step ${session.currentStepId}, got ${stepId}`);
  const reason = input.reason ?? "not specified";
  if (reason !== "not specified" && reason !== "other" && !["hardware unavailable", "game unavailable", "sample unavailable", "operator demonstration"].includes(reason)) {
    throw new Error(`unknown skip reason: ${reason}`);
  }
  if (reason === "other" && (input.note === undefined || input.note.trim().length < 1 || input.note.length > 280)) {
    throw new Error("a note of 1–280 characters is required when reason is 'other'");
  }

  let next = {
    ...session,
    skippedSteps: [
      ...session.skippedSteps,
      { stepId, reason, ...(input.note === undefined ? {} : { note: input.note }), skippedAt: now }
    ]
  };
  next = appendAuditEvent(
    next,
    { type: "StepSkipped", stepId, detail: { reason, ...(input.note === undefined ? {} : { note: input.note }) } },
    now
  );
  next = { ...next, currentStepId: nextStepId(stepId) };
  return appendAuditEvent(next, { type: "StepEntered", stepId: next.currentStepId }, now);
}

/**
 * 全局目录导航：干跑和搭建阶段可在任意步骤间直接跳转。
 * 跳转本身只记录 StepEntered，不会伪造步骤完成或跳过记录。
 */
export function navigateToStep(
  session: StudySession,
  stepId: StepId,
  now: string = new Date().toISOString()
): StudySession {
  const target = STEP_ORDER.indexOf(stepId);
  if (target < 0) throw new Error(`unknown step ${stepId}`);
  return appendAuditEvent({ ...session, currentStepId: stepId }, { type: "StepEntered", stepId }, now);
}
