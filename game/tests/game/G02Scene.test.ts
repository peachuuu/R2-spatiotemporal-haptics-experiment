import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GameViewport } from "../../app/components/GameViewport";
import { createGameEngine } from "../../app/game/GameEngine";
import { TIMELINE_EVENTS } from "../../app/game/eventTimeline";
import { parseLaunchConfig } from "../../app/game/launchConfig";

const config = parseLaunchConfig(
  "?mode=developer&sessionId=DEV&runId=R1&condition=STH&projectileSequence=S1&areaSequence=A1",
);
const state = createGameEngine(config).getState();
const event = TIMELINE_EVENTS.find((item) => item.id === "G02")!;
const renderAt = (elapsedMs: number) =>
  renderToStaticMarkup(
    createElement(GameViewport, {
      state,
      onInteract: () => undefined,
      activeEvent: event,
      eventElapsedMs: elapsedMs,
    }),
  );

describe("G02 scene", () => {
  it("shows only the falling hero before the boss entrance", () => {
    const html = renderAt(700);
    expect(html).toContain('data-g02-phase="hero-fall"');
    expect(html).toContain("g02-hero-fall");
    expect(html).toContain("left:30%");
    expect(html).not.toContain('class="boss ');
    expect(html).not.toContain("g02-rubble-piece");
  });

  it("places the boss on the right only during its slower fall", () => {
    const html = renderAt(3000);
    expect(html).toContain('data-g02-phase="boss-fall"');
    expect(html).toContain("g02-boss g02-boss-fall");
    expect(html).toContain("left:66%");
    expect(html).not.toContain("g02-rubble-piece");
  });

  it("renders a full debris field only after the boss has landed", () => {
    const html = renderAt(5500);
    expect(html).toContain('data-g02-phase="rubble-rise"');
    expect(html.match(/g02-rubble-piece/g)).toHaveLength(48);
    expect(html).toContain("/assets/events/G02/rock-01.png");
    expect(html).toContain("g02-impact-dust");
    expect(html).toContain("/assets/events/G02/g02-impact-dust.png");
  });
});
