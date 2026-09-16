import { describe, expect, it } from "vitest";
import { createStudySession } from "../../src/domain/session";
import type { ResponseSet, StepId, StudySession } from "../../src/domain/types";
import { conditionQuestions } from "../../src/protocol/questions.v1";
import { advance, navigateToStep, nextStepId, skip, STEP_ORDER, stepValidity } from "../../src/app/studyMachine";

const NOW = "2026-08-23T00:00:00.000Z";
const PROFILE = { nickname: "小测", age: 22, gender: "male", hapticExperience: "never" };

const newSession = (): StudySession =>
  createStudySession(
    {
      participantCode: "P001",
      studyMode: "dry-run",
      allocation: {
        counterbalanceCell: "AB",
        metadata: { methodVersion: "balanced-block-v1", blockId: 1, position: 0 }
      },
      gameAssignment: { timelineSeed: "SEED-T", projectileSequenceId: "S1", areaSequenceId: "A1" },
      profile: PROFILE
    },
    NOW
  );

const atConsent = (): StudySession => advance(newSession(), { stepId: "basic-info", valid: true }, NOW);

const atCalibration = (): StudySession => advance(atConsent(), { stepId: "consent", valid: true }, NOW);

describe("advance", () => {
  it("rejects advancing when a required step is incomplete", () => {
    expect(() => advance(newSession(), { stepId: "consent", valid: false }, NOW)).toThrow("consent is incomplete");
  });

  it("moves to the next step and logs StepCompleted + StepEntered", () => {
    const next = advance(newSession(), { stepId: "basic-info", valid: true }, NOW);
    expect(next.currentStepId).toBe("consent");
    const types = next.auditLog.map(event => event.type);
    expect(types).toContain("StepCompleted");
    expect(types).toContain("StepEntered");
    expect(next.auditLog.at(-1)?.stepId).toBe("consent");
  });

  it("rejects advancing a step that is not current", () => {
    expect(() => advance(newSession(), { stepId: "calibration", valid: true }, NOW)).toThrow(
      "expected current step basic-info"
    );
  });

  it("sets the session complete after the interview step", () => {
    let session = newSession();
    for (const step of STEP_ORDER) {
      if (step === "completion") break;
      session = advance(session, { stepId: step, valid: true }, NOW);
    }
    expect(session.status).toBe("complete");
    expect(session.currentStepId).toBe("completion");
  });
});

describe("skip", () => {
  it("records a dry-run skip with reason", () => {
    const next = skip(atCalibration(), "calibration", { reason: "hardware unavailable" }, NOW);
    expect(next.skippedSteps[0]?.reason).toBe("hardware unavailable");
    expect(next.skippedSteps[0]?.skippedAt).toBe(NOW);
    expect(next.currentStepId).toBe("instruction");
    expect(next.auditLog.some(event => event.type === "StepSkipped" && event.detail.reason === "hardware unavailable")).toBe(true);
  });

  it("allows an unclassified skip and still validates an explicitly supplied reason", () => {
    expect(() => skip(atCalibration(), "calibration", {}, NOW)).not.toThrow();
    expect(skip(atCalibration(), "calibration", {}, NOW).skippedSteps[0]?.reason).toBe("not specified");
    expect(() => skip(atCalibration(), "calibration", { reason: "other" }, NOW)).toThrow(/1–280/);
    expect(() => skip(atCalibration(), "calibration", { reason: "other", note: "x" }, NOW)).not.toThrow();
    expect(() => skip(atCalibration(), "calibration", { reason: "bogus" as never }, NOW)).toThrow(/unknown skip reason/);
  });

  it("refuses to skip basic-info or consent", () => {
    expect(() => skip(newSession(), "basic-info", { reason: "other", note: "x" }, NOW)).toThrow(
      /cannot be skipped/
    );
    expect(() => skip(atConsent(), "consent", { reason: "other", note: "x" }, NOW)).toThrow(
      /cannot be skipped/
    );
  });

  it("refuses any skip in production mode", () => {
    const production = createStudySession(
      {
        participantCode: "P002",
        studyMode: "production",
        allocation: {
          counterbalanceCell: "AB",
          metadata: { methodVersion: "balanced-block-v1", blockId: 2, position: 0 }
        },
        gameAssignment: { timelineSeed: "SEED-T", projectileSequenceId: "S1", areaSequenceId: "A1" },
        profile: PROFILE
      },
      NOW
    );
    expect(() => skip(production, "calibration", { reason: "hardware unavailable" }, NOW)).toThrow(
      /skipping is only available/
    );
  });

  it("does not mark a skipped final step as complete", () => {
    let session = newSession();
    for (const step of STEP_ORDER) {
      if (step === "final") break;
      session = advance(session, { stepId: step, valid: true }, NOW);
    }
    const next = skip(session, "final", { reason: "operator demonstration" }, NOW);
    expect(next.currentStepId).toBe("interview");
    expect(next.status).toBe("in-progress");
  });
});

describe("stepValidity", () => {
  it("flags missing consent and calibration", () => {
    expect(stepValidity(newSession(), "basic-info").valid).toBe(true);
    expect(stepValidity(newSession(), "consent").valid).toBe(false);
    expect(stepValidity(atConsent(), "calibration").valid).toBe(false);
  });

  it("treats the text-only instruction step as always valid", () => {
    expect(stepValidity(atCalibration(), "instruction").valid).toBe(true);
  });

  it("validates required questionnaire responses per condition", () => {
    const afterInstruction = advance(atCalibration(), { stepId: "calibration", valid: true }, NOW);
    const withRun = {
      ...afterInstruction,
      conditionRuns: {
        baseline: {
          displayCondition: "A" as const,
          conditionId: "baseline" as const,
          startedAt: NOW,
          endedAt: NOW,
          events: [],
          status: "won" as const,
          timelineSeed: "SEED-T",
          projectileSequenceId: "S1" as const,
          areaSequenceId: "A1" as const,
          attempts: [
            {
              attemptId: "a1",
              runId: "R1",
              status: "won" as const,
              startedAt: NOW,
              endedAt: NOW,
              timelineSeed: "SEED-T",
              projectileSequenceId: "S1" as const,
              areaSequenceId: "A1" as const,
              gameEvents: [],
              realizedStageOrder: [],
              timelineEvents: [],
              inputMethods: [],
              hapticCues: []
            }
          ]
        }
      }
    };
    expect(stepValidity(withRun, "assessment-1").valid).toBe(false);
    const answered = { ...withRun, conditionResponses: { baseline: completeConditionResponses() } };
    expect(stepValidity(answered, "assessment-1").valid).toBe(true);
  });

  it("accepts any step order from nextStepId", () => {
    expect(nextStepId("basic-info")).toBe("consent");
    expect(nextStepId("final")).toBe("interview");
    expect(nextStepId("interview")).toBe("completion");
    expect(() => nextStepId("completion")).toThrow(/no step after/);
  });
});

function completeConditionResponses(): ResponseSet {
  // 每个 likert 题取中间值：HXI（1–7）→ 4，PXI（−3–3）→ 0。
  return Object.fromEntries(
    conditionQuestions().map(question => [
      question.id,
      question.response.kind === "likert"
        ? Math.round((question.response.min + question.response.max) / 2)
        : 4
    ])
  );
}

describe("navigateToStep", () => {
  const atConditionOne = (): StudySession =>
    advance(advance(atCalibration(), { stepId: "calibration", valid: true }, NOW), { stepId: "instruction", valid: true }, NOW);

  it("navigates back to an earlier step and audits StepEntered", () => {
    const next = navigateToStep(atConditionOne(), "calibration", NOW);
    expect(next.currentStepId).toBe("calibration");
    expect(next.auditLog.at(-1)?.type).toBe("StepEntered");
    expect(next.auditLog.at(-1)?.stepId).toBe("calibration");
  });

  it("allows forward navigation", () => {
    expect(navigateToStep(atConditionOne(), "comparison", NOW).currentStepId).toBe("comparison");
  });

  it("allows revisiting basic-info and consent", () => {
    expect(navigateToStep(atConditionOne(), "basic-info", NOW).currentStepId).toBe("basic-info");
    expect(navigateToStep(atConditionOne(), "consent", NOW).currentStepId).toBe("consent");
  });
});
