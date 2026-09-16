import { G07_AREA } from "./eventTimeline";
import { areaAnchorOf, cueBaseSampleId } from "./hapticSamples";

export type PracticeActivePhase = "projectile-active" | "area-active" | "chest-active";

export function practiceCueFor(
  phase: PracticeActivePhase,
  positions: { projectileDirection?: "left" | "right"; areaCenter?: number; chestX?: number },
) {
  if (phase === "projectile-active") {
    const side = positions.projectileDirection ?? "left";
    return { cueKey: "PRACTICE-PROJECTILE:projectile", baseSampleId: cueBaseSampleId({ kind: "projectile", side, speed: "fast" }), offsetMs: 0 };
  }
  if (phase === "area-active") {
    const anchor = areaAnchorOf(positions.areaCenter);
    return { cueKey: "PRACTICE-AREA:area", baseSampleId: anchor === undefined ? undefined : cueBaseSampleId({ kind: "area", anchor, speed: "fast" }), offsetMs: G07_AREA.telegraphMs };
  }
  return {
    cueKey: "PRACTICE-CHEST:chest",
    baseSampleId: cueBaseSampleId({ kind: "chest-cue", side: (positions.chestX ?? 50) < 50 ? "left" : "right" }),
    offsetMs: 0,
  };
}
