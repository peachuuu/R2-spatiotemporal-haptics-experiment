import { describe, expect, it } from "vitest";
import { PassiveTrialTracker } from "../../app/game/objectiveTrials";
import { buildStageOrder } from "../../app/game/eventTimeline";

describe("PassiveTrialTracker", () => {
  it("records only the first jump after projectile start", () => {
    const event = buildStageOrder("A", "developer", "objective").find(item => item.kind === "projectile")!;
    const tracker = new PassiveTrialTracker("run-1");
    tracker.start(event, 1000, 50, undefined);
    tracker.observeJump(1450);
    tracker.observeJump(1700);
    const row = tracker.finish(event.id, 3000, { hit: false });
    expect(row?.metrics.firstJumpRtMs).toBe(450);
    expect(row?.success).toBe(1);
  });

  it("measures area dwell and first exit against the final collision boundary", () => {
    const event = buildStageOrder("A", "developer", "area-objective").find(item => item.kind === "area")!;
    const tracker = new PassiveTrialTracker("run-1");
    tracker.start(event, 1000, 45, 45);
    tracker.sampleArea(event.id, 1100, 45);
    tracker.sampleArea(event.id, 1400, 80);
    tracker.sampleArea(event.id, 1800, 80);
    const row = tracker.finish(event.id, 2000, { hit: false });
    expect(row?.metrics.areaExitMs).toBe(400);
    expect(row?.metrics.dwellTimeMs).toBe(400);
  });

  it("retains direct-open chest metadata", () => {
    const event = buildStageOrder("A", "developer", "chest-objective").find(item => item.kind === "chest-discovery")!;
    const tracker = new PassiveTrialTracker("run-1");
    tracker.start(event, 5000, 30, undefined, 80);
    const row = tracker.finish(event.id, 7200, { hit: false, chestFoundAtMs: 6800 });
    expect(row?.parameters.directOpen).toBe(true);
    expect(row?.metrics.completionTimeMs).toBe(1800);
  });

  it("measures every chest from its prompt audio onset to the successful interaction", () => {
    const g05 = {
      id: "G05",
      kind: "chest-discovery" as const,
      visibility: "limited" as const,
      parameters: { audioStartMs: 1000, cueStartMs: 1500 },
    } as ReturnType<typeof buildStageOrder>[number];
    const tracker = new PassiveTrialTracker("run-1");
    tracker.start(g05, 5000, 30, undefined, 80);

    const row = tracker.finish(g05.id, 9000, { hit: false, chestFoundAtMs: 7500 });

    expect(row?.metrics.audioOnsetMs).toBe(6000);
    expect(row?.metrics.interactionTimeMs).toBe(7500);
    expect(row?.metrics.completionTimeMs).toBe(1500);
  });
});
