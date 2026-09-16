import { describe, expect, it } from "vitest";
import {
  PRACTICE_PREPARE_MS,
  advancePractice,
  beginPracticeTask,
  completePracticeTask,
  createPracticeState,
  movePracticeFocus,
} from "../../app/game/practiceController";

describe("practice controller", () => {
  it("locks a deterministic random projectile side and waits two seconds", () => {
    const left = beginPracticeTask(
      createPracticeState(false),
      "projectile",
      42,
      0.1,
      100,
    );
    const right = beginPracticeTask(
      createPracticeState(false),
      "projectile",
      42,
      0.9,
      100,
    );
    expect(left).toMatchObject({
      phase: "projectile-wait",
      projectileDirection: "left",
      phaseStartedAtMs: 100,
    });
    expect(right.projectileDirection).toBe("right");
    expect(advancePractice(left, 100 + PRACTICE_PREPARE_MS - 1).phase).toBe(
      "projectile-wait",
    );
    expect(advancePractice(left, 100 + PRACTICE_PREPARE_MS)).toMatchObject({
      phase: "projectile-active",
      phaseStartedAtMs: 2100,
    });
  });

  it("locks the formal area anchor and opposite chest position at selection", () => {
    expect(
      beginPracticeTask(createPracticeState(false), "area", 12, 0, 0),
    ).toMatchObject({ phase: "area-wait", areaCenter: 10 });
    expect(
      beginPracticeTask(createPracticeState(false), "area", 38, 0, 0),
    ).toMatchObject({ areaCenter: 45 });
    expect(
      beginPracticeTask(createPracticeState(false), "area", 63, 0, 0),
    ).toMatchObject({ areaCenter: 55 });
    expect(
      beginPracticeTask(createPracticeState(false), "area", 88, 0, 0),
    ).toMatchObject({ areaCenter: 90 });
    expect(
      beginPracticeTask(createPracticeState(false), "chest", 20, 0, 0),
    ).toMatchObject({ phase: "chest-active", chestX: 83 });
    expect(
      beginPracticeTask(createPracticeState(false), "chest", 80, 0, 0),
    ).toMatchObject({ chestX: 17 });
  });

  it("locks task selection until completion and then returns to idle", () => {
    const active = beginPracticeTask(
      createPracticeState(false),
      "chest",
      20,
      0,
      0,
    );
    expect(beginPracticeTask(active, "area", 20, 0, 20)).toBe(active);
    expect(completePracticeTask(active, 300)).toMatchObject({
      phase: "idle",
      activeTask: undefined,
      focusedAction: "chest",
    });
  });

  it("wraps three local actions and includes completion only when embedded", () => {
    const local = createPracticeState(false);
    expect(movePracticeFocus(local, -1).focusedAction).toBe("chest");
    const embedded = createPracticeState(true);
    expect(movePracticeFocus(embedded, -1).focusedAction).toBe("complete");
    expect(
      movePracticeFocus({ ...embedded, phase: "area-wait" }, 1),
    ).toEqual({ ...embedded, phase: "area-wait" });
  });
});
