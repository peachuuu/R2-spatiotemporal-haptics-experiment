import { describe, expect, it } from "vitest";
import { NoopHapticAdapter } from "../../src/adapters/NoopHapticAdapter";
import { toGameCondition } from "../../src/integration/gameProtocol";
import type { ConditionId } from "../../src/domain/types";

describe("NoopHapticAdapter (无触觉测试模式)", () => {
  const request = {
    eventId: "g01-unlock",
    patternId: "01",
    conditionId: "baseline" as ConditionId,
    requestedAtMs: 1000
  };

  it("prepares cues immediately as playable without any hardware operation", async () => {
    const adapter = new NoopHapticAdapter();
    const status = await adapter.getStatus();
    expect(status.state).toBe("ready");
    const prepared = await adapter.prepareCue(request);
    expect(prepared.readiness).toBe("ready");
    expect(prepared.readyAtMs).toBe(request.requestedAtMs);
    expect(prepared.recommendedLeadMs).toBe(0);
    await expect(adapter.commitCue(request.eventId, 1200)).resolves.toBeUndefined();
    await expect(adapter.emergencyStop("mode switch")).resolves.toBeUndefined();
  });

  it("never appears in the R2 condition space (NONE cannot enter formal randomisation)", () => {
    // R2 的隐藏条件空间只有 baseline/spatiotemporal，映射结果只有 BH/STH。
    expect(toGameCondition("baseline")).toBe("BH");
    expect(toGameCondition("spatiotemporal")).toBe("STH");
    const conditions: ConditionId[] = ["baseline", "spatiotemporal"];
    const gameIds = conditions.map(toGameCondition);
    expect(gameIds).not.toContain("NH");
    expect(gameIds.sort()).toEqual(["BH", "STH"]);
  });
});
