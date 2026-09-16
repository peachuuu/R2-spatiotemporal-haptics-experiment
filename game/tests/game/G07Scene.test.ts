import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GameViewport } from "../../app/components/GameViewport";
import { createGameEngine } from "../../app/game/GameEngine";
import { buildStageOrder } from "../../app/game/eventTimeline";
import { parseLaunchConfig } from "../../app/game/launchConfig";

const config = parseLaunchConfig("?mode=developer&sessionId=DEV&runId=R1&condition=STH&projectileSequence=S1&areaSequence=A1");
const state = createGameEngine(config).getState();
const renderEvent = (event: ReturnType<typeof buildStageOrder>[number], elapsedMs: number) => renderToStaticMarkup(createElement(GameViewport, { state, onInteract: () => undefined, activeEvent: event, eventElapsedMs: elapsedMs }));

describe("G07 scene", () => {
  const events = buildStageOrder("A", "developer", "g07-scene");
  it("shows every inserted chest as a positioned search event", () => {
    const chest = events.find(item => item.id === "G07-CHEST01")!;
    const html = renderEvent(
      { ...chest, parameters: { ...chest.parameters, chestX: 83 } },
      0,
    );
    expect(html).toContain("开启符文宝箱");
    expect(html).toContain("left:83%");
    expect(html).toContain("g05-g09-chest-cue.wav");
    expect(html).toContain("chest-hint g05-cue");
  });

  it("mirrors only projectiles arriving from the right", () => {
    const fromLeft = events.find((item) => item.kind === "projectile" && item.parameters.direction === "left")!;
    const fromRight = events.find((item) => item.kind === "projectile" && item.parameters.direction === "right")!;
    expect(renderEvent(fromLeft, 1000)).toContain("timeline-projectile from-left");
    expect(renderEvent(fromRight, 1000)).toContain("timeline-projectile from-right");
  });

  it("renders an area whose visual width is exactly twice its collision half-width", () => {
    const area = events.find((item) => item.kind === "area")!;
    const html = renderEvent(area, Number(area.parameters.telegraphMs) + Number(area.parameters.expansionMs) / 2);
    expect(html).toContain("danger-ring timeline-area");
    expect(html).toContain("--area-width:60%");
    expect(html).toContain("--area-progress:0.5");
    expect(html).toContain('data-target-mode="fixed-anchor"');
    expect(html).toMatch(/area-target-marker" style="left:(10|45|55|90)%/);
    expect(html).toContain("area-target-marker");
  });

  it("uses the enlarged combat view and event-specific projectile asset", () => {
    const projectile = events.find((item) => item.kind === "projectile" && item.id.startsWith("G07-"))!;
    const html = renderEvent(projectile, 800);
    expect(html).toContain("--vision:18%");
    expect(html).toContain("/assets/events/G07+G11/g07-projectile.png");
  });
});
