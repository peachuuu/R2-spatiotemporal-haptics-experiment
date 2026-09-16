import { describe, expect, it } from "vitest";
import { practiceCueFor } from "../../app/game/practiceHaptics";

describe("practice STH cue mapping", () => {
  it.each([
    ["projectile-active", { projectileDirection: "left" }, "sth.g07.projectile.left.fast", 0],
    ["projectile-active", { projectileDirection: "right" }, "sth.g07.projectile.right.fast", 0],
    ["area-active", { areaCenter: 45 }, "sth.g07.area.b.fast", 300],
    ["area-active", { areaCenter: 90 }, "sth.g07.area.d.fast", 300],
    ["chest-active", { chestX: 20 }, "sth.g05.chest.left", 0],
    ["chest-active", { chestX: 80 }, "sth.g05.chest.right", 0],
  ] as const)("maps %s to its formal STH sample", (phase, positions, sample, offsetMs) => {
    expect(practiceCueFor(phase, positions)).toMatchObject({ baseSampleId: sample, offsetMs });
  });
});
