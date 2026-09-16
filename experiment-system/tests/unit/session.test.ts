import { describe, expect, it } from "vitest";
import { beginConditionAttempt, createStudySession, getDisplayCondition, isValidParticipantCode, prepareDebugExportExit } from "../../src/domain/session";

const NOW = "2026-08-23T00:00:00.000Z";
const PROFILE = { nickname: "小测", age: 22, gender: "male", hapticExperience: "never" };

const newSession = (cell: "AB" | "BA", mode: "dry-run" | "production" = "dry-run", code = "P001") =>
  createStudySession(
    {
      participantCode: code,
      studyMode: mode,
      allocation: {
        counterbalanceCell: cell,
        metadata: { methodVersion: "balanced-block-v1", blockId: 1, position: cell === "AB" ? 0 : 1 }
      },
      gameAssignment: { timelineSeed: "SEED-T", projectileSequenceId: "S3", areaSequenceId: "A2" },
      profile: { ...PROFILE }
    },
    NOW
  );

describe("study session domain", () => {
  it("maps AB to baseline then spatiotemporal", () => {
    const session = newSession("AB");
    expect(session.conditionOrder).toEqual(["baseline", "spatiotemporal"]);
    expect(getDisplayCondition(session, "baseline")).toBe("A");
    expect(getDisplayCondition(session, "spatiotemporal")).toBe("B");
  });

  it("maps BA to spatiotemporal then baseline", () => {
    const session = newSession("BA");
    expect(session.conditionOrder).toEqual(["spatiotemporal", "baseline"]);
    expect(getDisplayCondition(session, "spatiotemporal")).toBe("A");
    expect(getDisplayCondition(session, "baseline")).toBe("B");
  });

  it("records allocation metadata and the shared game assignment", () => {
    const session = newSession("BA", "production", "P-001");
    expect(session.schemaVersion).toBe(3);
    expect(session.allocationMetadata).toEqual({
      methodVersion: "balanced-block-v1",
      blockId: 1,
      position: 1
    });
    expect(session.gameAssignment).toEqual({
      timelineSeed: "SEED-T",
      projectileSequenceId: "S3",
      areaSequenceId: "A2"
    });
  });

  it("initialises defaults and a SessionStarted audit event", () => {
    const session = newSession("AB", "production", "P-001");
    expect(session.currentStepId).toBe("basic-info");
    expect(session.status).toBe("in-progress");
    expect(session.calibration).toEqual([]);
    expect(session.skippedSteps).toEqual([]);
    expect(session.conditionRuns).toEqual({});
    expect(session.conditionResponses).toEqual({});
    expect(session.participantProfile).toEqual({ ...PROFILE });
    expect(session.interviewResponses).toEqual({});
    expect(session.createdAt).toBe(NOW);
    expect(session.updatedAt).toBe(NOW);
    expect(session.auditLog).toHaveLength(1);
    expect(session.auditLog[0]?.type).toBe("SessionStarted");
    expect(session.auditLog[0]?.detail).toMatchObject({
      counterbalanceCell: "AB",
      allocationBlockId: 1,
      timelineSeed: "SEED-T"
    });
  });

  it("accepts any non-empty participant code (no character limit)", () => {
    expect(isValidParticipantCode("P-001")).toBe(true);
    expect(isValidParticipantCode("A")).toBe(true);
    expect(isValidParticipantCode("任意编号")).toBe(true);
    expect(isValidParticipantCode("")).toBe(false);
    expect(isValidParticipantCode("   ")).toBe(false);
  });
});

describe("debug export exit", () => {
  it("marks an active condition attempt interrupted and audits the partial export", () => {
    const base = { ...newSession("AB"), currentStepId: "condition-1" as const };
    const running = beginConditionAttempt(base, "baseline", {
      runId: `${base.id}-C1`,
      projectileSequenceId: "S3",
      areaSequenceId: "A2",
      timelineSeed: "SEED-T"
    }, NOW);

    const exported = prepareDebugExportExit(running, "2026-08-31T13:30:00.000Z");

    expect(exported.conditionRuns.baseline?.attempts.at(-1)).toMatchObject({
      status: "interrupted",
      diagnostic: "debug_export_exit"
    });
    expect(exported.auditLog.at(-1)).toMatchObject({
      type: "Exported",
      stepId: "condition-1",
      detail: { kind: "debug_partial_exit", complete: false }
    });
  });
});
