import { describe, expect, it, vi } from "vitest";
import { orchestrateCue, resolveSampleForSession, DEFAULT_LEAD_MS } from "../../src/integration/cueOrchestrator";
import { createStudySession } from "../../src/domain/session";
import type { StudySession } from "../../src/domain/types";

function makeSession(cell: "AB" | "BA"): StudySession {
  return createStudySession({
    participantCode: "P001",
    studyMode: "production",
    allocation: { counterbalanceCell: cell, metadata: { methodVersion: "balanced-block-v1", blockId: 1, position: 0 } },
    gameAssignment: { timelineSeed: "S", projectileSequenceId: "S1", areaSequenceId: "A1" },
    profile: { nickname: "小测", age: 22, gender: "male", hapticExperience: "never" }
  });
}

function hostWith(prepare: "ok" | "undefined" | "unknown" | "fail") {
  return {
    prepareSample: vi.fn(async (sampleId: string) => {
      if (prepare === "ok") return { ok: true as const, value: { sampleId, durationUs: 5090000 } };
      if (prepare === "undefined") return { ok: false as const, error: { code: "DEVICE_ERROR", message: "SAMPLE_UNDEFINED: 07Alf", deviceErrorName: "SAMPLE_UNDEFINED" } };
      if (prepare === "unknown") return { ok: false as const, error: { code: "DEVICE_ERROR", message: "UNKNOWN_SAMPLE: x", deviceErrorName: "UNKNOWN_SAMPLE" } };
      return { ok: false as const, error: { code: "TIMEOUT", message: "prepare timeout" } };
    }),
    commitAfter: vi.fn(async (delayMs: number) => ({ ok: true as const, value: { deviceStartUs: 98765 } }))
  };
}

const request = { cueKey: "projectile", baseSampleId: "sth.g07.projectile.left.fast", conditionId: "STH", atMs: 5000 };

describe("cue orchestrator", () => {
  it("resolves an explicit sth ID to the matching condition-qualified hardware ID", () => {
    const ab = makeSession("AB");
    expect(resolveSampleForSession(ab, 0, "sth.g07.projectile.left.fast")).toBe("bh.g07.projectile.left.fast");
    expect(resolveSampleForSession(ab, 1, "sth.g07.projectile.left.fast")).toBe("sth.g07.projectile.left.fast");
  });

  it("resolves explicit STH IDs to condition-qualified hardware IDs", () => {
    const ab = makeSession("AB"); // baseline first → index 0 = BH
    expect(resolveSampleForSession(ab, 0, "sth.g07.projectile.left.fast")).toBe("bh.g07.projectile.left.fast");
    expect(resolveSampleForSession(ab, 1, "sth.g07.projectile.left.fast")).toBe("sth.g07.projectile.left.fast");
    const ba = makeSession("BA");
    expect(resolveSampleForSession(ba, 0, "sth.g01.unlock")).toBe("sth.g01.unlock");
    expect(resolveSampleForSession(ba, 1, "sth.g01.unlock")).toBe("bh.g01.unlock");
  });

  it("runs prepare -> prepared -> future cueAt -> commit with relative delay only", async () => {
    const host = hostWith("ok");
    const started: Array<{ deviceStartUs: number } | { error: string }> = [];
    const session = makeSession("BA"); // index 0 = STH
    const outcome = await orchestrateCue(host, { request, session, conditionIndex: 0, now: 5000 }, result => started.push(result));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.resolvedSampleId).toBe("sth.g07.projectile.left.fast");
    expect(host.prepareSample).toHaveBeenCalledWith("sth.g07.projectile.left.fast", 7000);
    // cueAt 在未来，delay 相对且为正
    expect(outcome.cueAt).toBeGreaterThanOrEqual(outcome.preparedAtMs + DEFAULT_LEAD_MS - 5);
    expect(outcome.delayMs).toBeGreaterThan(0);
    expect(host.commitAfter).toHaveBeenCalledWith(outcome.delayMs, 8000);
    await new Promise(r => setTimeout(r, 5));
    expect(started).toEqual([{ deviceStartUs: 98765 }]);
  });

  it("bridges the G01 spatiotemporal cue as its real sth sample ID", async () => {
    const host = hostWith("ok");
    const session = makeSession("BA"); // index 0 = STH
    const outcome = await orchestrateCue(
      host,
      {
        request: { cueKey: "g01", baseSampleId: "sth.g01.unlock", conditionId: "STH", atMs: 0 },
        session,
        conditionIndex: 0,
        now: 0
      }
    );
    expect(outcome).toMatchObject({ ok: true, resolvedSampleId: "sth.g01.unlock" });
    expect(host.prepareSample).toHaveBeenCalledWith("sth.g01.unlock", 7000);
    expect(host.commitAfter).toHaveBeenCalledOnce();
  });

  it("fails closed with a stage and message when the sample is undefined", async () => {
    const host = hostWith("undefined");
    const outcome = await orchestrateCue(host, { request, session: makeSession("BA"), conditionIndex: 0, now: 5000 });
    expect(outcome).toMatchObject({ ok: false, stage: "prepare", deviceErrorName: "SAMPLE_UNDEFINED" });
    expect(host.commitAfter).not.toHaveBeenCalled();
  });

  it("fails closed when the base sample id is missing", async () => {
    const host = hostWith("ok");
    const outcome = await orchestrateCue(host, { request: { ...request, baseSampleId: null }, session: makeSession("BA"), conditionIndex: 0, now: 5000 });
    expect(outcome).toMatchObject({ ok: false, stage: "resolve" });
    expect(host.prepareSample).not.toHaveBeenCalled();
  });

  it("never downgrades a prepare failure to a silent continue", async () => {
    const host = hostWith("fail");
    const outcome = await orchestrateCue(host, { request, session: makeSession("BA"), conditionIndex: 0, now: 5000 });
    expect(outcome.ok).toBe(false);
  });
});
