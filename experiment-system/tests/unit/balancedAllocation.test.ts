import { describe, expect, it } from "vitest";
import { nextBalancedAllocation } from "../../src/integration/balancedAllocation";

describe("balanced block-of-two allocation", () => {
  it("randomizes the first member and assigns its complement second", () => {
    const first = nextBalancedAllocation(undefined, 1);
    const second = nextBalancedAllocation(first.nextState, 0);
    expect(first.allocation.cell).toBe("BA");
    expect(second.allocation.cell).toBe("AB");
    expect(second.allocation.metadata.blockId).toBe(first.allocation.metadata.blockId);
    expect(second.allocation.metadata.position).toBe(1);
    expect(first.allocation.metadata.position).toBe(0);
  });

  it("does not consume the random bit for the complement position", () => {
    const first = nextBalancedAllocation(undefined, 0);
    const second = nextBalancedAllocation(first.nextState, 1); // bit would choose BA, but complement is fixed
    expect(first.allocation.cell).toBe("AB");
    expect(second.allocation.cell).toBe("BA");
  });

  it("starts a new block after a completed pair", () => {
    const first = nextBalancedAllocation(undefined, 0);
    const second = nextBalancedAllocation(first.nextState, 1);
    const third = nextBalancedAllocation(second.nextState, 1);
    expect(third.allocation.metadata.blockId).toBe(second.allocation.metadata.blockId + 1);
    expect(third.allocation.metadata.position).toBe(0);
    expect(third.allocation.cell).toBe("BA");
  });

  it("persists state across refresh by replaying the stored state", () => {
    const first = nextBalancedAllocation(undefined, 0);
    // Simulated refresh: reload state from storage and continue.
    const replay = nextBalancedAllocation(first.nextState, 0);
    expect(replay.allocation.cell).toBe("BA");
    expect(replay.allocation.metadata.blockId).toBe(first.allocation.metadata.blockId);
  });
});
