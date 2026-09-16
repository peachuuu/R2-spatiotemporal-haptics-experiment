import { describe, expect, it, vi } from "vitest";
import { orchestratePracticeCue } from "../../src/integration/practiceCueOrchestrator";

describe("practice cue orchestrator", () => {
  it("prepares and commits the unchanged STH sample with formal cue timing", async () => {
    const host = {
      prepareSample: vi.fn().mockResolvedValue({ ok: true, value: { sampleId: "sth.g07.projectile.left.fast", durationUs: 1000 } }),
      commitAfter: vi.fn().mockResolvedValue({ ok: true, value: { deviceStartUs: 1 } }),
    };
    const result = await orchestratePracticeCue(host, {
      cueKey: "PRACTICE-PROJECTILE:projectile", baseSampleId: "sth.g07.projectile.left.fast", atMs: 10,
    }, 150);
    expect(host.prepareSample).toHaveBeenCalledWith("sth.g07.projectile.left.fast", 7000);
    expect(host.commitAfter).toHaveBeenCalledWith(150, 8000);
    expect(result).toEqual({ delayMs: 150 });
  });

  it("rejects BH samples so practice cannot follow a formal condition", async () => {
    const host = { prepareSample: vi.fn(), commitAfter: vi.fn() };
    await expect(orchestratePracticeCue(host as never, {
      cueKey: "bad", baseSampleId: "bh.g07.projectile.left.fast", atMs: 10,
    })).resolves.toEqual({ error: "练习只允许 STH 样本" });
    expect(host.prepareSample).not.toHaveBeenCalled();
  });
});
