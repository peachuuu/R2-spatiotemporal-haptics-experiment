import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GameViewport } from "../../app/components/GameViewport";
import { createGameEngine, type GameState } from "../../app/game/GameEngine";
import { TIMELINE_EVENTS } from "../../app/game/eventTimeline";
import { parseLaunchConfig } from "../../app/game/launchConfig";

const config = parseLaunchConfig("?mode=developer&sessionId=DEV&runId=R1&condition=STH&projectileSequence=S1&areaSequence=A1");
const state = createGameEngine(config).getState();
const event = TIMELINE_EVENTS.find((item) => item.id === "G05")!;
const renderAt = (elapsedMs: number, gameState: GameState = state) => renderToStaticMarkup(createElement(GameViewport, { state: gameState, onInteract: () => undefined, activeEvent: event, eventElapsedMs: elapsedMs }));

describe("G05 scene", () => {
  it("keeps the chest hidden during the one-second pause", () => {
    const html = renderAt(999);
    expect(html).toContain("/assets/music/new/g05-g09-chest-cue.wav");
    expect(html).not.toContain("g05-chest");
  });

  it("reveals the subdued breathing cue half a second after audio starts", () => {
    const html = renderAt(1500);
    expect(html).toContain("chest-hint g05-cue");
    expect(html).toContain("chest g05-chest");
    expect(html).toContain("/assets/events/G05+G09/chest-pixel.png");
    expect(html).not.toContain("按 E 交互");
  });

  it("shows the E prompt only when the player is near the chest", () => {
    const nearState = { ...state, player: { ...state.player, x: 27 } };
    expect(renderAt(1800, nearState)).toContain("按O交互 打开宝箱");
  });

  it("renders and detects a runtime chest placement on the opposite side", () => {
    const runtimeEvent = {
      ...event,
      parameters: { ...event.parameters, chestX: 83 },
    };
    const nearState = { ...state, player: { ...state.player, x: 83 } };
    const html = renderToStaticMarkup(
      createElement(GameViewport, {
        state: nearState,
        onInteract: () => undefined,
        activeEvent: runtimeEvent,
        eventElapsedMs: 1800,
      }),
    );
    expect(html).toContain("left:83%");
    expect(html).toContain("按O交互 打开宝箱");
  });
});
