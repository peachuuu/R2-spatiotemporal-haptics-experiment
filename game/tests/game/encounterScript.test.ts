import { describe, expect, it } from "vitest";
import { getAreaTrials, getIntroCues, getProjectileTrials } from "../../app/game/encounterScript";

describe("deterministic encounter script", () => {
  it("emits landing, casting, and fire wall as separate timed events", () => {
    expect(getIntroCues(2500).map((cue) => cue.eventId)).toEqual(["boss-landing", "boss-casting"]);
    expect(getIntroCues(3200).map((cue) => cue.eventId)).toEqual(["boss-landing", "boss-casting", "fire-wall"]);
  });

  it("uses the declared S1 order and contains every projectile exactly once", () => {
    expect(getProjectileTrials("S1").map((trial) => trial.eventId)).toEqual(["projectile-right-low", "projectile-left-low", "projectile-left-high", "projectile-right-middle", "projectile-right-high", "projectile-left-middle"]);
    expect(new Set(getProjectileTrials("S1").map((trial) => trial.eventId)).size).toBe(6);
  });

  it("returns copied tables without mutating the declared sequence", () => {
    const first = getProjectileTrials("S4"); first.reverse();
    expect(getProjectileTrials("S4")[0].eventId).toBe("projectile-left-middle");
    expect(getAreaTrials("A1").map((trial) => trial.x)).toEqual([24, 38, 77, 63]);
  });
});
