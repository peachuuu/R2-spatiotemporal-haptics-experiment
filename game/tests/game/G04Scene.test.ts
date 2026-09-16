import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GameViewport } from "../../app/components/GameViewport";
import { createGameEngine } from "../../app/game/GameEngine";
import { TIMELINE_EVENTS } from "../../app/game/eventTimeline";
import { parseLaunchConfig } from "../../app/game/launchConfig";

const config = parseLaunchConfig("?mode=developer&sessionId=DEV&runId=R1&condition=STH&projectileSequence=S1&areaSequence=A1");
const state = createGameEngine(config).getState();
const event = TIMELINE_EVENTS.find((item) => item.id === "G04")!;
const renderAt = (elapsedMs: number) => renderToStaticMarkup(createElement(GameViewport, { state, onInteract: () => undefined, activeEvent: event, eventElapsedMs: elapsedMs }));

describe("G04 scene", () => {
  it("plays audio after the silent bridge without showing the ghost early", () => {
    const html = renderAt(1500);
    expect(html).toContain('data-g04-phase="audio-lead"');
    expect(html).toContain("/assets/music/new/g04-ghost.wav");
    expect(html).not.toContain("g04-ghost-track");
    expect(html).toContain("--vision:80%");
  });

  it("moves the provided portrait through the ground scene while vision shrinks", () => {
    const html = renderAt(4000);
    expect(html).toContain('data-g04-phase="ghost-pass"');
    expect(html).toContain("g04-ghost-track");
    expect(html).toContain("/assets/events/G04/ghost.png");
    expect(html).not.toContain("--vision:80%");
  });

  it("reaches a smaller six-percent final view", () => {
    expect(renderAt(6879)).toMatch(/--vision:6\.0\d*%/);
  });

  it("centers the view vertically on a jumping player", () => {
    const jumpingState = { ...state, player: { ...state.player, y: 5 } };
    const html = renderToStaticMarkup(createElement(GameViewport, { state: jumpingState, onInteract: () => undefined, activeEvent: event, eventElapsedMs: 3000 }));
    expect(html).toContain("--py:57%");
  });
});
