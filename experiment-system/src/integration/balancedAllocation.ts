/**
 * Pure block-of-two counterbalance allocation.
 *
 * Every block contains exactly one AB session and one BA session. The first
 * session of a new block gets a random cell; the second session of the same
 * block automatically receives the complement. The state is persisted in the
 * repository so refreshes, crashes, or rapid consecutive session creations
 * never reuse a block position.
 */

import type { AllocationMetadata } from "../domain/types";

export type AllocationState = {
  blockId: number;
  firstCell: "AB" | "BA";
  nextPosition: 0 | 1;
};

export type AllocationResult = {
  allocation: { cell: "AB" | "BA"; metadata: AllocationMetadata };
  nextState: AllocationState;
};

export function nextBalancedAllocation(
  state: AllocationState | undefined,
  randomBit: 0 | 1,
): AllocationResult {
  if (state === undefined || state.nextPosition === 0) {
    const firstCell = randomBit === 0 ? "AB" : "BA";
    const blockId = (state?.blockId ?? 0) + 1;
    return {
      allocation: {
        cell: firstCell,
        metadata: { methodVersion: "balanced-block-v1", blockId, position: 0 },
      },
      nextState: { blockId, firstCell, nextPosition: 1 },
    };
  }
  return {
    allocation: {
      cell: state.firstCell === "AB" ? "BA" : "AB",
      metadata: {
        methodVersion: "balanced-block-v1",
        blockId: state.blockId,
        position: 1,
      },
    },
    nextState: { blockId: state.blockId, firstCell: state.firstCell, nextPosition: 0 },
  };
}

/** Crypto-safe random bit; only position 0 of a block consumes randomness. */
export function randomBit(): 0 | 1 {
  const bytes = crypto.getRandomValues(new Uint8Array(1));
  return ((bytes[0] ?? 0) & 1) as 0 | 1;
}
