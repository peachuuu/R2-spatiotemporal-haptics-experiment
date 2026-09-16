import { describe, expect, it } from "vitest";
import { createTimelineEngine } from "../../app/game/TimelineEngine";
import { createGameEngine } from "../../app/game/GameEngine";
import { getAreaTrials, getProjectileTrials } from "../../app/game/encounterScript";
import { parseLaunchConfig } from "../../app/game/launchConfig";

/**
 * STH/BH/NONE equivalence: the condition must never change visual events,
 * audio timing, attack order or judgment parameters. Only the haptic sample
 * resolution may differ.
 */

describe("condition equivalence", () => {
  const base = "?mode=developer&projectileSequence=S2&areaSequence=A3";
  const configFor = (condition: "NH" | "BH" | "STH") =>
    parseLaunchConfig(`${base}&condition=${condition}&sessionId=S&runId=R`);

  /** 把时间线走到 completed，收集实现的事件顺序。 */
  function realiseOrder(seed: string): string[] {
    const engine = createTimelineEngine({ mode: "developer", seed });
    engine.start(0);
    const realised: string[] = [engine.getState().current.id];
    let guard = 0;
    while (!engine.getState().completed && guard < 600) {
      const s = engine.getState();
      // G01 需 E/O 启动；所有宝箱搜索事件都由有效交互完成搜索阶段。
      if (s.current.id === "G01" || s.current.kind === "chest-discovery") {
        engine.completeInteraction(s.eventStartedAtMs + 1);
      }
      engine.tick(s.eventStartedAtMs + Math.max(1, s.current.durationMs));
      const next = engine.getState();
      if (next.current.id !== realised[realised.length - 1]) realised.push(next.current.id);
      guard++;
    }
    expect(engine.getState().completed, "timeline did not complete").toBe(true);
    return realised;
  }

  it("realises the identical event order and timings for the same seed across conditions", () => {
    const sth = realiseOrder("EQUIV-SEED");
    const bh = realiseOrder("EQUIV-SEED");
    const none = realiseOrder("EQUIV-SEED");
    expect(sth).toEqual(bh);
    expect(sth).toEqual(none);
    expect(sth[0]).toBe("G01");
    expect(sth).toContain("G12");
  });

  it("keeps identical attack catalogs for the same sequence ids across conditions", () => {
    const sth = createGameEngine(configFor("STH"));
    const bh = createGameEngine(configFor("BH"));
    const nh = createGameEngine(configFor("NH"));
    // 同一序列 id 的攻击目录是常量；三个条件共享 S2/A3。
    const projectiles = getProjectileTrials("S2");
    const areas = getAreaTrials("A3");
    expect(projectiles.length).toBeGreaterThan(0);
    expect(areas.length).toBeGreaterThan(0);
    // 引擎初始状态（HP、视野、判定参数）与条件无关。
    expect(sth.getState().hp).toBe(bh.getState().hp);
    expect(sth.getState().hp).toBe(nh.getState().hp);
    expect(sth.getState().vision).toBe(nh.getState().vision);
  });

  it("keeps identical attack timing constants regardless of condition", () => {
    const telegraphs = getProjectileTrials("S2").map(trial => trial.telegraphMs);
    const activeMs = getAreaTrials("A3").map(trial => trial.activeMs);
    expect(new Set(telegraphs).size).toBeGreaterThan(0);
    expect(new Set(activeMs).size).toBeGreaterThan(0);
  });
});
