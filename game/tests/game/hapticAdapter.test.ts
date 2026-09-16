import { describe, expect, it } from "vitest";
import {
  createHapticAdapterForConfig,
  DevHapticAdapter,
  NoopHapticAdapter,
  PreviewHardwareHapticAdapter,
  resolveCueAction,
  type HapticAdapter
} from "../../app/game/hapticAdapter";
import { createGameEngine } from "../../app/game/GameEngine";
import { parseLaunchConfig } from "../../app/game/launchConfig";

/** 模拟正式 STH/BH 适配器：样本未提供时 prepare 失败（SAMPLE_UNDEFINED）。 */
class UnavailableSampleAdapter implements HapticAdapter {
  readonly mode = "sth" as const;
  async prepareCue(input: { cue: unknown; baseSampleId?: string }) {
    return { status: "unavailable-sample", baseSampleId: input.baseSampleId, reason: `SAMPLE_UNDEFINED ${input.baseSampleId}` };
  }
  async commitCue() {
    return { status: "error", reason: "not prepared" };
  }
  async emergencyStop(_reason: string) {}
}

const cue = { cue: { kind: "g01-unlock" as const }, baseSampleId: "01" };

describe("NONE haptic adapter (无触觉测试模式)", () => {
  it("prepares cues immediately as skipped without touching Web Serial", async () => {
    // In node tests navigator.serial does not exist; the Noop adapter must
    // not reference it at all (implicitly proven by resolving here).
    const adapter = new NoopHapticAdapter();
    expect(adapter.mode).toBe("none");
    const result = await adapter.prepareCue(cue);
    expect(result).toEqual({
      status: "prepared",
      outcome: "skipped",
      mode: "none",
      baseSampleId: "01",
      resolvedSampleId: undefined
    });
    expect(resolveCueAction(result)).toBe("start");
    await expect(adapter.commitCue(cue)).resolves.toEqual({ status: "committed" });
    await expect(adapter.emergencyStop("test")).resolves.toBeUndefined();
  });

  it("derives the NONE adapter from the NH condition", () => {
    const config = parseLaunchConfig(
      "?mode=developer&sessionId=LOCAL&runId=R1&condition=NH&projectileSequence=S1&areaSequence=A1"
    );
    expect(createHapticAdapterForConfig(config)).toBeInstanceOf(NoopHapticAdapter);
    const sth = parseLaunchConfig(
      "?mode=developer&sessionId=LOCAL&runId=R1&condition=STH&projectileSequence=S1&areaSequence=A1"
    );
    expect(createHapticAdapterForConfig(sth)).toBeInstanceOf(PreviewHardwareHapticAdapter);
  });

  it("keeps unavailable samples non-blocking for NONE", async () => {
    // Even when the catalog marks a sample unavailable, the NONE adapter
    // still resolves playable (skipped) so audio/animation proceed.
    const result = await new NoopHapticAdapter().prepareCue({ ...cue, baseSampleId: "07Alf" });
    expect(result).toMatchObject({ status: "prepared", outcome: "skipped", baseSampleId: "07Alf" });
    expect(resolveCueAction(result)).toBe("start");
  });

  it("pauses formal STH/BH when a sample is unavailable instead of continuing", async () => {
    const failing = new UnavailableSampleAdapter();
    const result = await failing.prepareCue(cue);
    expect(result.status).toBe("unavailable-sample");
    expect(resolveCueAction(result)).toBe("pause");
  });

  it("never auto-downgrades a failed STH/BH prepare to NONE semantics", async () => {
    const failing = new UnavailableSampleAdapter();
    const result = await failing.prepareCue(cue);
    // A failure must surface as pause; it must not come back as skipped.
    expect(resolveCueAction(result)).not.toBe("start");
    expect(result).not.toMatchObject({ outcome: "skipped" });
  });

  it("records hapticMode/hapticDisabled on run results (NONE excluded from formal stats)", () => {
    const none = createGameEngine(
      parseLaunchConfig("?mode=developer&sessionId=S&runId=R&condition=NH&projectileSequence=S1&areaSequence=A1")
    );
    none.completeTimeline(5000);
    const noneResult = none.getResult();
    expect(noneResult?.hapticMode).toBe("none");
    expect(noneResult?.hapticDisabled).toBe(true);

    const sth = createGameEngine(
      parseLaunchConfig("?mode=developer&sessionId=S&runId=R&condition=STH&projectileSequence=S1&areaSequence=A1")
    );
    sth.completeTimeline(5000);
    const sthResult = sth.getResult();
    expect(sthResult?.hapticMode).toBe("sth");
    expect(sthResult?.hapticDisabled).toBe(false);
  });
});
