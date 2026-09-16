import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DirectChestOpenScene } from "../../app/components/DirectChestOpenScene";
import { buildStageOrder, G06_ASSETS } from "../../app/game/eventTimeline";

describe("direct chest opening", () => {
  it("renders only the opening animation/audio and never the ridge trace", () => {
    const event = buildStageOrder("A", "developer", "open").find(
      item => item.id === "G07-CHEST01",
    )!;
    const html = renderToStaticMarkup(
      createElement(DirectChestOpenScene, { event, eventElapsedMs: 0 }),
    );
    expect(html).toContain(G06_ASSETS.open);
    expect(html).toContain(G06_ASSETS.openAudio);
    expect(html).not.toContain(G06_ASSETS.traceAudio);
    expect(html).not.toContain(G06_ASSETS.finger);
  });
});
