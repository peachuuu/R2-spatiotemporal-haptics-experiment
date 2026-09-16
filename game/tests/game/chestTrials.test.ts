import { describe, expect, it } from "vitest";
import { chestSearchMeasurement } from "../../app/game/chestTrials";
import { buildStageOrder, TIMELINE_EVENTS } from "../../app/game/eventTimeline";

describe("chest-search measurements", () => {
  const events = buildStageOrder("A", "developer", "chest-metrics");

  it("uses the actual prompt-audio onset for the existing G05 trial", () => {
    const event = TIMELINE_EVENTS.find(item => item.id === "G05")!;
    expect(chestSearchMeasurement({ event, eventStartedAtMs: 1000, foundAtMs: 4000, chestX: 83, playerStartX: 20 })).toMatchObject({
      trialIndex: 1,
      reactionTimeMs: 2000,
      details: {
        audioOnsetMs: 2000,
        interactionTimeMs: 4000,
        completionTimeMs: 2000,
        searchStartedAtMs: 2000,
        chestSide: "right",
        playerStartX: 20,
        directOpen: false,
      },
    });
  });

  it("numbers inserted trials 2-4 and starts them at their gated cue boundary", () => {
    const event = events.find(item => item.id === "G07-CHEST02")!;
    expect(chestSearchMeasurement({ event, eventStartedAtMs: 5000, foundAtMs: 6900, chestX: 17, playerStartX: 70 })).toMatchObject({
      trialIndex: 3,
      reactionTimeMs: 1900,
      details: { searchStartedAtMs: 5000, chestSide: "left", completedAttackCount: 16, directOpen: true },
    });
  });
});
