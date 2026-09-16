import { describe, expect, it } from "vitest";
import {
  dataQualityRows,
  objectiveTrialKey,
  type ObjectiveTrialRecord
} from "../../src/domain/objective";
import { createStudySession } from "../../src/domain/session";
import { toDataQualityCsv, toObjectiveTrialsCsv } from "../../src/storage/exportSession";
import type { StudySession } from "../../src/domain/types";

function projectile(overrides: Partial<ObjectiveTrialRecord> = {}): ObjectiveTrialRecord {
  return {
    schemaVersion: "objective-trials.v1",
    trialUid: "attempt-1:G07-P01",
    trialType: "projectile",
    trialIndex: 1,
    timelineEventId: "G07-P01",
    stage: "A",
    visualAvailability: "limited",
    startedAtMs: 100,
    endedAtMs: 1800,
    trialValid: true,
    invalidReason: null,
    success: 1,
    parameters: { direction: "left", speed: "fast", spawnX: 0 },
    metrics: { firstJumpRtMs: 420 },
    ...overrides
  };
}

describe("objective trial records", () => {
  it("uses a stable key that includes the attempt, preserving restarted trials", () => {
    const first = projectile();
    const replay = projectile({ trialUid: "attempt-2:G07-P01" });

    expect(objectiveTrialKey(first)).toBe("attempt-1:G07-P01");
    expect(objectiveTrialKey(replay)).toBe("attempt-2:G07-P01");
  });

  it("keeps technical failures invalid and never converts them into behavioural failure", () => {
    const row = projectile({
      trialValid: false,
      invalidReason: "hardware_failure",
      success: null,
      metrics: { firstJumpRtMs: null }
    });

    expect(row.trialValid).toBe(false);
    expect(row.invalidReason).toBe("hardware_failure");
    expect(row.success).toBeNull();
  });

  it("reports planned, valid, invalid, and missing counts per visual-stage trial type", () => {
    const rows = dataQualityRows([
      projectile(),
      projectile({ trialUid: "attempt-1:G07-P02", trialIndex: 2, trialValid: false, invalidReason: "operator_skip", success: null })
    ]);

    expect(rows).toContainEqual({
      stage: "A",
      visualAvailability: "limited",
      trialType: "projectile",
      planned: 16,
      valid: 1,
      invalid: 1,
      missing: 15
    });
  });

  it("reports a complete 112-trial dry run across four stage-visibility cells without losing a restart", () => {
    const records: ObjectiveTrialRecord[] = [];
    for (const [stage, visualAvailability] of [["A", "limited"], ["A", "full"], ["B", "limited"], ["B", "full"]] as const) {
      for (const [trialType, count] of [["projectile", 16], ["area", 8], ["chest", 4]] as const) {
        for (let index = 1; index <= count; index++) records.push(projectile({
          trialUid: `run:${stage}:${visualAvailability}:${trialType}:${index}`,
          trialType,
          trialIndex: index,
          stage,
          visualAvailability,
          timelineEventId: `${stage}-${trialType}-${index}`
        }));
      }
    }
    // A restarted technical attempt remains visible as invalid and does not
    // reduce the 112 valid planned records.
    records.push(projectile({ trialUid: "restart:G07-P01", trialValid: false, invalidReason: "run_interrupted", success: null }));
    expect(records.filter(record => record.trialValid)).toHaveLength(112);
    expect(dataQualityRows(records).filter(row => row.missing !== 0)).toEqual([]);
    expect(dataQualityRows(records).find(row => row.stage === "A" && row.visualAvailability === "limited" && row.trialType === "projectile")).toMatchObject({ valid: 16, invalid: 1, missing: 0 });
  });

  it("exports an invalid technical trial with blank success instead of a behavioural zero", () => {
    const trial = projectile({ trialValid: false, invalidReason: "hardware_failure", success: null });
    const session = createStudySession({
      participantCode: "P001",
      studyMode: "dry-run",
      allocation: { counterbalanceCell: "AB", metadata: { methodVersion: "balanced-block-v1", blockId: 1, position: 1 } },
      gameAssignment: { timelineSeed: "seed", projectileSequenceId: "S1", areaSequenceId: "A1" },
      profile: { nickname: "n", age: 20, gender: "female", hapticExperience: "never" }
    }, "2026-08-30T00:00:00.000Z");
    const withTrial = {
      ...session,
      conditionRuns: {
        baseline: {
          displayCondition: "A", conditionId: "baseline", status: "won", startedAt: session.createdAt,
          timelineSeed: "seed", projectileSequenceId: "S1", areaSequenceId: "A1", events: [], attempts: [{
            attemptId: "attempt-1", runId: "run-1", status: "won", startedAt: session.createdAt,
            timelineSeed: "seed", projectileSequenceId: "S1", areaSequenceId: "A1", gameEvents: [],
            realizedStageOrder: [], timelineEvents: [], inputMethods: [], hapticCues: [], objectiveTrials: [trial]
          }]
        }
      }
    } as StudySession;

    expect(toObjectiveTrialsCsv(withTrial)).toContain("attempt-1:G07-P01,projectile,1,G07-P01,A,limited,100,1800,0,hardware_failure,,");
    expect(toDataQualityCsv(withTrial)).toContain("P001,baseline,A,,A,limited,projectile,16,0,1,16");
  });

  it("exports chest audio onset, successful interaction, and completion as explicit columns", () => {
    const chest = projectile({
      trialType: "chest",
      timelineEventId: "G05",
      metrics: { audioOnsetMs: 2000, interactionTimeMs: 4500, completionTimeMs: 2500 }
    });
    const session = createStudySession({
      participantCode: "P001", studyMode: "dry-run",
      allocation: { counterbalanceCell: "AB", metadata: { methodVersion: "balanced-block-v1", blockId: 1, position: 1 } },
      gameAssignment: { timelineSeed: "seed", projectileSequenceId: "S1", areaSequenceId: "A1" },
      profile: { nickname: "n", age: 20, gender: "female", hapticExperience: "never" }
    }, "2026-08-30T00:00:00.000Z");
    const withChest = { ...session, conditionRuns: { baseline: { displayCondition: "A", conditionId: "baseline", status: "won", startedAt: session.createdAt, timelineSeed: "seed", projectileSequenceId: "S1", areaSequenceId: "A1", events: [], attempts: [{ attemptId: "attempt-1", runId: "run-1", status: "won", startedAt: session.createdAt, timelineSeed: "seed", projectileSequenceId: "S1", areaSequenceId: "A1", gameEvents: [], realizedStageOrder: [], timelineEvents: [], inputMethods: [], hapticCues: [], objectiveTrials: [chest] }] } } } as StudySession;
    const csv = toObjectiveTrialsCsv(withChest);
    expect(csv.split("\n")[0]).toContain("audio_onset_ms,interaction_time_ms,completion_time_ms");
    expect(csv).toContain(",2000,4500,2500,");
  });
});
