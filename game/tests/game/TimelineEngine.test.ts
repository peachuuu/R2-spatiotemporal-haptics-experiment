import { describe, expect, it } from "vitest";
import { createTimelineEngine } from "../../app/game/TimelineEngine";

describe("TimelineEngine", () => {
  it("keeps G01 static until interaction then runs its animation before G02", () => {
    const engine = createTimelineEngine({ mode: "developer", seed: "dev" });
    engine.start(0);
    engine.tick(10000);
    expect(engine.getState().current.id).toBe("G01");
    expect(engine.getState().interactionActive).toBe(false);
    engine.completeInteraction(10000);
    expect(engine.getState().current.id).toBe("G01");
    expect(engine.getState().interactionActive).toBe(true);
    engine.tick(16124);
    expect(engine.getState().current.id).toBe("G01");
    engine.tick(16125);
    expect(engine.getState().current.id).toBe("G02");
  });
  it("ignores repeated E/O while the manually started G01 is already running", () => {
    const engine = createTimelineEngine({ mode: "developer", seed: "dev" });
    engine.start(0);
    expect(engine.completeInteraction(100)).toBe(true);
    expect(engine.completeInteraction(101)).toBe(false);
    expect(engine.getState().current.id).toBe("G01");

  });
  it("strictly serializes G02 G03 G04", () => {
    const engine = createTimelineEngine({ mode: "developer", seed: "dev" });
    engine.start(0);
    engine.completeInteraction(0);
    engine.tick(6125);
    expect(engine.getState().current.id).toBe("G02");
    engine.tick(15791);
    expect(engine.getState().current.id).toBe("G02");
    engine.tick(15792);
    expect(engine.getState().current.id).toBe("G02-G03-PAUSE");
    engine.tick(17791);
    expect(engine.getState().current.id).toBe("G02-G03-PAUSE");
    engine.tick(17792);
    expect(engine.getState().current.id).toBe("G03");
    engine.tick(25141);
    expect(engine.getState().current.id).toBe("G03");
    engine.tick(25142);
    expect(engine.getState().current.id).toBe("G04");
  });
  it("waits at chest discovery events for player interaction", () => {
    const engine = createTimelineEngine({ mode: "developer", seed: "dev" });
    engine.start(0);
    engine.jumpTo("G05", 0);
    engine.tick(20000);
    expect(engine.getState().current.id).toBe("G05");
    engine.completeInteraction(20000);
    expect(engine.getState().current.id).toBe("G06");
    expect(engine.getState().interactionActive).toBe(true);
    expect(engine.getState().current.transition).toBe("auto");
  });
  it("ignores a repeated O interaction while the ridge animation is playing", () => {
    const engine = createTimelineEngine({ mode: "developer", seed: "dev" });
    engine.start(0);
    expect(engine.jumpTo("G05", 0)).toBe(true);
    expect(engine.completeInteraction(2000)).toBe(true);
    expect(engine.getState().current.id).toBe("G06");

    expect(engine.completeInteraction(2001)).toBe(false);
    expect(engine.getState().current.id).toBe("G06");
  });
  it("plays a direct chest opening and its one-second gap before resuming combat", () => {
    const engine = createTimelineEngine({ mode: "developer", seed: "chest" });
    engine.start(0);
    expect(engine.jumpTo("G07-CHEST01", 1000)).toBe(true);
    const chest = engine.getState().current;
    expect(chest.kind).toBe("chest-discovery");
    engine.tick(20000);
    expect(engine.getState().current.id).toBe("G07-CHEST01");
    expect(engine.completeInteraction(20000)).toBe(true);
    expect(engine.getState().interactionCompleted).toBe(true);
    engine.tick(20000 + chest.durationMs - 1);
    expect(engine.getState().current.id).toBe("G07-CHEST01");
    engine.tick(20000 + chest.durationMs);
    expect(["projectile", "area"]).toContain(engine.getState().current.kind);
  });
  it("formal mode disables jumps", () => {
    const engine = createTimelineEngine({ mode: "experiment", seed: "p1" });
    engine.start(0);
    expect(engine.jumpTo("G11", 1)).toBe(false);
    expect(engine.getState().current.id).toBe("G01");
  });
  it("allows an explicit emergency skip in formal mode and records it", () => {
    const engine = createTimelineEngine({ mode: "experiment", seed: "p1" });
    engine.start(0);
    expect(engine.emergencySkip(80)).toBe("G01");
    expect(engine.getRecords()).toContainEqual({
      timelineEventId: "G01",
      timelineOrder: 0,
      outcome: "skipped",
      atMs: 80,
    });
  });
  it("always advances from a realized G07 combat break after its configured safe interval", () => {
    const engine = createTimelineEngine({ mode: "developer", seed: "dev" });
    engine.start(0);
    const breakId = engine.getState().events.find(event => event.id.startsWith("G07-BREAK"))!.id;
    engine.jumpTo(breakId, 1000);
    const current = engine.getState().current;
    expect(current.id).toBe(breakId);
    engine.tick(1000 + current.durationMs);
    expect(engine.getState().current.id).not.toBe(breakId);
  });
  it("finishes the current event before pausing and only advances after continue", () => {
    const engine = createTimelineEngine({ mode: "developer", seed: "pause" });
    engine.start(0);
    expect(engine.requestPause()).toBe(true);
    expect(engine.getState().current.id).toBe("G01");
    expect(engine.completeInteraction(10)).toBe(true);
    engine.tick(10 + engine.getState().current.durationMs);
    expect(engine.getState().awaitingContinue).toBe(true);
    expect(engine.getState().current.id).toBe("G01");
    expect(engine.continueAfterPause(7000)).toBe(true);
    expect(engine.getState().awaitingContinue).toBe(false);
    expect(engine.getState().current.id).toBe("G02");
  });
});
