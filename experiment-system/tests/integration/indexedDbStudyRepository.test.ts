import { beforeEach, describe, expect, it } from "vitest";
import { createStudySession } from "../../src/domain/session";
import type { StudySession } from "../../src/domain/types";
import { IndexedDbStudyRepository } from "../../src/storage/IndexedDbStudyRepository";

const NOW = "2026-08-23T00:00:00.000Z";

let repo = new IndexedDbStudyRepository();

beforeEach(async () => {
  await repo.close();
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase("electrotactile-study");
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => resolve();
  });
  repo = new IndexedDbStudyRepository();
});

function session(overrides: Partial<StudySession> = {}): StudySession {
  return {
    ...createStudySession(
      {
        participantCode: "P001",
        studyMode: "dry-run",
        allocation: {
          counterbalanceCell: "AB",
          metadata: { methodVersion: "balanced-block-v1", blockId: 1, position: 0 }
        },
        gameAssignment: { timelineSeed: "SEED-T", projectileSequenceId: "S1", areaSequenceId: "A1" },
        profile: { nickname: "小测", age: 22, gender: "male", hapticExperience: "never" }
      },
      NOW
    ),
    ...overrides
  };
}

describe("IndexedDbStudyRepository", () => {
  it("saves and reloads a session", async () => {
    const created = session();
    await repo.save(created);
    await expect(repo.get(created.id)).resolves.toEqual(created);
  });

  it("returns undefined for unknown ids", async () => {
    await expect(repo.get("missing")).resolves.toBeUndefined();
  });

  it("lists only in-progress sessions", async () => {
    await repo.save(session({ id: "in-progress-1" }));
    await repo.save(session({ id: "complete-1", status: "complete" }));
    await repo.save(session({ id: "abandoned-1", status: "abandoned" }));
    const list = await repo.listIncomplete();
    expect(list.map(s => s.id)).toEqual(["in-progress-1"]);
  });

  it("replaces a session with the same id on save", async () => {
    const created = session({ id: "same-id" });
    await repo.save(created);
    await repo.save({ ...created, currentStepId: "consent" });
    const stored = await repo.get("same-id");
    expect(stored?.currentStepId).toBe("consent");
    await expect(repo.listIncomplete()).resolves.toHaveLength(1);
  });

  it("allocates exactly one AB and one BA per block across sessions", async () => {
    const first = await repo.allocateConditionOrder();
    const second = await repo.allocateConditionOrder();
    expect([first.counterbalanceCell, second.counterbalanceCell].sort()).toEqual(["AB", "BA"]);
    expect(first.allocation.blockId).toBe(second.allocation.blockId);
    expect(first.allocation.position).toBe(0);
    expect(second.allocation.position).toBe(1);
  });

  it("keeps the allocation across repository reopen (refresh recovery)", async () => {
    const first = await repo.allocateConditionOrder();
    await repo.close();
    repo = new IndexedDbStudyRepository();
    const second = await repo.allocateConditionOrder();
    expect(second.counterbalanceCell).not.toBe(first.counterbalanceCell);
    expect(second.allocation.blockId).toBe(first.allocation.blockId);
  });

  it("never reuses a block position under rapid consecutive allocations", async () => {
    const cells = await Promise.all([repo.allocateConditionOrder(), repo.allocateConditionOrder(), repo.allocateConditionOrder(), repo.allocateConditionOrder()]);
    const cellsSorted = cells.map(c => c.counterbalanceCell).sort();
    expect(cellsSorted).toEqual(["AB", "AB", "BA", "BA"]);
    expect(cells[0]?.allocation.blockId).toBe(cells[1]?.allocation.blockId);
    expect(cells[2]?.allocation.blockId).toBe(cells[3]?.allocation.blockId);
    expect(cells[0]?.allocation.blockId).not.toBe(cells[2]?.allocation.blockId);
    const positions = new Set(cells.map(c => `${c.allocation.blockId}:${c.allocation.position}`));
    expect(positions.size).toBe(4);
  });
});
