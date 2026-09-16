import type { CueMediaAdapter, CueRequest, HapticAdapter } from "./contracts";

export type CueResult = { ok: true; cueAtMs: number } | { ok: false; reason: "unavailable" | "error"; detail?: string };

export type CueCoordinator = {
  runCue(request: CueRequest): Promise<CueResult>;
};

/**
 * Two-stage cue timing (§3.3): media starts only after the haptic device
 * reports readiness, and both sides share one common cue time.
 */
export function createCueCoordinator(
  haptic: HapticAdapter,
  media: CueMediaAdapter,
  nowMs: () => number = () => performance.now()
): CueCoordinator {
  return {
    async runCue(request) {
      let prepared;
      try {
        prepared = await haptic.prepareCue(request);
      } catch (error) {
        return { ok: false, reason: "error", detail: error instanceof Error ? error.message : String(error) };
      }
      if (prepared.readiness !== "ready") {
        return { ok: false, reason: prepared.readiness, detail: prepared.detail };
      }
      const cueAtMs = Math.max(nowMs(), prepared.readyAtMs) + prepared.recommendedLeadMs;
      await haptic.commitCue(request.eventId, cueAtMs);
      await media.notifyCue({ eventId: request.eventId, cueAtMs });
      return { ok: true, cueAtMs };
    }
  };
}
