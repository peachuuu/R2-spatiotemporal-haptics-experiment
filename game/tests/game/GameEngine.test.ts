import { describe, expect, it } from "vitest";
import { createGameEngine } from "../../app/game/GameEngine";
import type { LaunchConfig } from "../../app/game/types";

const config: LaunchConfig = {
  mode: "developer",
  sessionId: "DEV",
  runId: "DEV-R1",
  conditionId: "STH",
  projectileSequenceId: "S1",
  areaSequenceId: "A1",
};

describe("GameEngine", () => {
  it("records a movement edge without advancing legacy story events", () => {
    const engine = createGameEngine(config);
    engine.dispatch({ type: "MOVE", atMs: 0, moveX: -1 });
    engine.tickPlayerOnly(1000);
    expect(engine.getState().player.x).toBeLessThan(51);
    expect(engine.getState().phase).toBe("intro");
    expect(engine.getTelemetry().events).toContainEqual(
      expect.objectContaining({ eventId: "player-move-start", outcome: "left", action: "move" }),
    );
  });
  it("records input-method transitions as objective events", () => {
    const engine = createGameEngine(config);
    engine.dispatch({ type: "MOVE", atMs: 100, moveX: 1, method: "keyboard" });
    engine.dispatch({ type: "MOVE", atMs: 200, moveX: 0, method: "keyboard" });
    engine.dispatch({ type: "MOVE", atMs: 300, moveX: 1, method: "gamepad" });
    engine.dispatch({ type: "JUMP", atMs: 400, method: "gamepad" });
    const methods = engine
      .getTelemetry()
      .events.filter(event => event.eventId === "input-keyboard" || event.eventId === "input-gamepad")
      .map(event => event.eventId);
    expect(methods).toEqual(["input-keyboard", "input-gamepad"]);
  });
  it("uses analog stick strength for proportional horizontal speed", () => {
    const half = createGameEngine(config);
    half.dispatch({ type: "MOVE", atMs: 0, moveX: 0.5 });
    half.tickPlayerOnly(100);
    const full = createGameEngine(config);
    full.dispatch({ type: "MOVE", atMs: 0, moveX: 1 });
    full.tickPlayerOnly(100);
    expect(half.getState().player.x).toBeGreaterThan(30);
    expect(half.getState().player.x).toBeLessThan(full.getState().player.x);
    half.dispatch({ type: "MOVE", atMs: 100, moveX: 0 });
    half.tickPlayerOnly(200);
    expect(half.getState().player.moveX).toBe(0);
  });
  it("applies one timeline attack hit without starting legacy combat", () => {
    const engine = createGameEngine(config);
    engine.takeTimelineHit(1000, "projectile");
    expect(engine.getState().hp).toBe(90);
    expect(engine.getState().phase).toBe("intro");
    expect(engine.getTelemetry().events.at(-1)).toMatchObject({
      eventId: "player-hit",
      outcome: "hit",
    });
  });
  it("clears transient hit feedback when the timeline enters a break", () => {
    const engine = createGameEngine(config);
    engine.takeTimelineHit(1000, "area");
    engine.clearTransientFeedback(1100);
    expect(engine.getState().player.hurtUntilMs).toBeLessThanOrEqual(1100);
    expect(engine.getState().notice).toBe("");
  });
  it("resumes movement when a developer previews G12 after a completed run", () => {
    const engine = createGameEngine(config);
    engine.completeTimeline(5000);
    engine.resumeTimelinePreview(6000);
    engine.dispatch({ type: "MOVE", atMs: 6000, moveX: 1 });
    engine.tickPlayerOnly(6100);
    expect(engine.getResult()).toBeUndefined();
    expect(engine.getState().player.x).toBeGreaterThan(30);
  });
  it("uses cinematic HP as non-fatal feedback", () => {
    const engine = createGameEngine(config);
    engine.takeCinematicFireHit(1800);
    expect(engine.getState().hp).toBe(80);
    for (let index = 0; index < 8; index++)
      engine.takeTimelineHit(3000 + index * 1000, "projectile");
    expect(engine.getState().hp).toBe(0);
    expect(engine.getResult()).toBeUndefined();
  });
  it("can complete a timeline-managed run", () => {
    const engine = createGameEngine(config);
    engine.completeTimeline(120000);
    expect(engine.getResult()).toMatchObject({
      status: "won",
      elapsedMs: 120000,
    });
  });
  it("includes timeline records and realized order in the run result", () => {
    const engine = createGameEngine(config);
    engine.setTimelineMetadata({
      seed: "p1",
      order: ["G01", "G02"],
      records: [
        {
          timelineEventId: "G01",
          timelineOrder: 0,
          outcome: "completed",
          atMs: 5000,
        },
      ],
    });
    engine.completeTimeline(5000);
    expect(engine.getResult()).toMatchObject({
      timelineSeed: "p1",
      realizedStageOrder: ["G01", "G02"],
      timelineEvents: [{ timelineEventId: "G01" }],
    });
  });
  it("records a deterministic projectile spawn", () => {
    const engine = createGameEngine(config);
    engine.enterCombat();
    engine.tick(1000);
    expect(engine.getTelemetry().events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventId: "projectile-right-low",
          outcome: "spawned",
        }),
      ]),
    );
  });

  it("ends an unfinished run at the five minute timeout", () => {
    const engine = createGameEngine(config);
    engine.tick(300000);
    expect(engine.getResult()?.status).toBe("timeout");
  });


  it("moves and jumps from engine input while preserving a grounded landing", () => {
    const engine = createGameEngine(config);
    engine.tick(0);
    engine.dispatch({ type: "MOVE", atMs: 0, moveX: -1 });
    engine.tick(100);
    expect(engine.getState().player.x).toBeLessThan(51);
    engine.dispatch({ type: "JUMP", atMs: 100 });
    engine.tick(250);
    expect(engine.getState().player.y).toBeGreaterThan(0);
    for (let time = 350; time <= 2000; time += 100) engine.tick(time);
    expect(engine.getState().player.grounded).toBe(true);
  });

  it("faces left and narrows vision when the ghost exploration sequence begins", () => {
    const engine = createGameEngine(config);
    engine.tick(8000);
    engine.dispatch({ type: "MOVE", atMs: 8000, moveX: -1 });

    expect(engine.getState()).toMatchObject({
      phase: "explore",
      vision: 11,
      notice: expect.stringMatching(/向左/),
      player: { facing: -1 },
    });
  });

  it("opens the chest only after the player reaches its interaction distance", () => {
    const engine = createGameEngine(config);
    engine.tick(8000);
    engine.dispatch({ type: "INTERACT", atMs: 8000 });
    expect(engine.getState().phase).toBe("explore");
    for (let time = 8100; time <= 9400; time += 100) {
      engine.dispatch({ type: "MOVE", atMs: time, moveX: -1 });
      engine.tick(time);
    }
    engine.dispatch({ type: "INTERACT", atMs: 9500 });
    expect(engine.getState().phase).toBe("combat");
    expect(engine.getTelemetry().events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ eventId: "chest-opened" }),
      ]),
    );
  });

});
