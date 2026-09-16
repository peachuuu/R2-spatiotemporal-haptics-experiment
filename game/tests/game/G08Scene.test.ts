import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GameViewport } from "../../app/components/GameViewport";
import { createGameEngine } from "../../app/game/GameEngine";
import { G08_TIMING, TIMELINE_EVENTS } from "../../app/game/eventTimeline";
import { parseLaunchConfig } from "../../app/game/launchConfig";

const config = parseLaunchConfig("?mode=developer&sessionId=DEV&runId=R1&condition=STH&projectileSequence=S1&areaSequence=A1");
const state = createGameEngine(config).getState();
const event = TIMELINE_EVENTS.find((item) => item.id === "G08")!;
const renderAt = (elapsedMs: number) => renderToStaticMarkup(createElement(GameViewport, { state, onInteract: () => undefined, activeEvent: event, eventElapsedMs: elapsedMs }));

describe("G08 scene", () => {
  it("renders independent drops and gradually restores vision", () => {
    const start = renderAt(0);
    const middle = renderAt(G08_TIMING.totalMs / 2);
    const end = renderAt(G08_TIMING.totalMs);
    expect(start.match(/--rain-x/g)).toHaveLength(72);
    expect(start).toContain("--vision:18%");
    expect(middle).toContain("--vision:49%");
    expect(end).toContain("--vision:80%");
  });

  it("moves the boss away from the right-side G09 chest lane", () => {
    expect(renderAt(2000)).toContain("left:66%");
  });
});
