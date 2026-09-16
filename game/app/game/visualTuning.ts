import { G04_TIMING, G08_TIMING, type TimelineEvent } from "./eventTimeline";

// Centralized visual tuning. Change these values to adjust every matching event.
export const VISION_TUNING = {
  fullRadiusPercent: 80,
  explorationRadiusPercent: 6,
  combatRadiusPercent: 18,
  ghostEndRadiusPercent: 6,
  rainEndRadiusPercent: 80,
  featherPercent: 4,
  featherOpacity: .9,
  outerOpacity: .8,
} as const;

export function getVisionRadius(event: TimelineEvent | undefined, elapsedMs: number) {
  if (!event) return VISION_TUNING.fullRadiusPercent;
  if (event.id === "G04") {
    const progress = Math.min(1, Math.max(0, (elapsedMs - G04_TIMING.ghostStartMs) / (G04_TIMING.ghostEndMs - G04_TIMING.ghostStartMs)));
    return VISION_TUNING.fullRadiusPercent - progress * (VISION_TUNING.fullRadiusPercent - VISION_TUNING.ghostEndRadiusPercent);
  }
  if (event.id === "G08") {
    const progress = Math.min(1, Math.max(0, elapsedMs / G08_TIMING.totalMs));
    return VISION_TUNING.combatRadiusPercent + progress * (VISION_TUNING.rainEndRadiusPercent - VISION_TUNING.combatRadiusPercent);
  }
  if (event.id.startsWith("G07-")) return VISION_TUNING.combatRadiusPercent;
  if (["G05", "G06"].includes(event.id)) return VISION_TUNING.explorationRadiusPercent;
  return VISION_TUNING.fullRadiusPercent;
}
