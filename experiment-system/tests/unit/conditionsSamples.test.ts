import { describe, expect, it } from "vitest";
import { EVENT_SAMPLES, resolvedSampleIdFor } from "../../src/protocol/conditions.v1";

describe("comparison event sample variants", () => {
  it("uses left-side chest and fast projectile samples for events four and six", () => {
    expect(EVENT_SAMPLES["event-04"].baseSampleId).toBe("sth.g05.chest.left");
    expect(resolvedSampleIdFor(EVENT_SAMPLES["event-04"].baseSampleId, "bh")).toBe("bh.g05.chest.left");
    expect(EVENT_SAMPLES["event-06"].baseSampleId).toBe("sth.g07.projectile.left.fast");
    expect(resolvedSampleIdFor(EVENT_SAMPLES["event-06"].baseSampleId, "bh")).toBe("bh.g07.projectile.left.fast");
  });
});
