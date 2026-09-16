import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GameViewport } from "../../app/components/GameViewport";
import { createGameEngine } from "../../app/game/GameEngine";
import { TIMELINE_EVENTS } from "../../app/game/eventTimeline";
import { parseLaunchConfig } from "../../app/game/launchConfig";

const config = parseLaunchConfig("?mode=developer&sessionId=DEV&runId=R1&condition=STH&projectileSequence=S1&areaSequence=A1");
const state = createGameEngine(config).getState();
const event = TIMELINE_EVENTS.find((item) => item.id === "G03")!;
const renderAt = (elapsedMs: number) => renderToStaticMarkup(createElement(GameViewport, { state, onInteract: () => undefined, activeEvent: event, eventElapsedMs: elapsedMs }));

describe("G03 scene", () => {
  it("cycles reserved split boss frames during the cast", () => {
    const html = renderAt(1500);
    expect(html).toContain('data-g03-phase="casting"');
    expect(html).toContain("g03-boss-sprite frame-2");
    expect(html).toContain("/assets/events/G03/boss-cast-02.png");
    expect(html).not.toContain("g03-fire-stage");
  });

  it("starts edge fire and hero burning only after casting completes", () => {
    const html = renderAt(3200);
    expect(html).toContain('data-g03-phase="burning"');
    expect(html).toContain("g03-fire-stage");
    expect(html.match(/g03-fire-bank/g)).toHaveLength(2);
    expect(html).toContain("/assets/events/G03/fire-");
    expect(html).toContain("g03-burning");
    expect(html).toContain("g03-hero-embers");
    expect(html).toContain("/assets/events/G03/fire-");
    expect(html).toContain("/assets/music/new/g03-fire.wav");
    expect(html).toContain("g03-boss-cast.wav");
  });
});
