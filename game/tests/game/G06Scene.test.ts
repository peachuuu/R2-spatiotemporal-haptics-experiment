import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChestDetailScene } from "../../app/components/ChestDetailScene";
import { G06_TIMING, TIMELINE_EVENTS } from "../../app/game/eventTimeline";

const event = TIMELINE_EVENTS.find((item) => item.id === "G06")!;
const renderAt = (elapsedMs: number) => renderToStaticMarkup(createElement(ChestDetailScene, { event, eventElapsedMs: elapsedMs }));

describe("G06 scene", () => {
  it("traces the ridge with the generated closed frame", () => {
    const html = renderAt(2000);
    expect(html).toContain('data-g06-phase="trace"');
    expect(html).toContain("g06-chest-closed-v1.png");
    expect(html).toContain("g06-ridge-track");
    expect(html).toContain("g06-finger");
  });

  it("crossfades to the generated open frame after unlocking", () => {
    const html = renderAt(G06_TIMING.openAtMs + 100);
    expect(html).toContain('data-g06-phase="open"');
    expect(html).toContain("g06-chest-open-v1.png");
    expect(html).toContain("g06-open visible");
    expect(html).not.toContain("g06-finger");
  });

  it("uses the shared G06+G10 chest frame set for G10", () => {
    const g10 = TIMELINE_EVENTS.find((item) => item.id === "G10")!;
    const html = renderToStaticMarkup(createElement(ChestDetailScene, { event: g10, eventElapsedMs: 1000 }));
    expect(html).toContain("/assets/events/G06+G10/g06-chest-closed-v1.png");
  });
});
