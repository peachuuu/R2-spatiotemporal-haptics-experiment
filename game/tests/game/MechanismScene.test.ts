import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MechanismScene } from "../../app/components/MechanismScene";
import { ExperimentSceneRouter } from "../../app/components/ExperimentSceneRouter";
import { TIMELINE_EVENTS } from "../../app/game/eventTimeline";

describe("MechanismScene", () => {
  const event = TIMELINE_EVENTS.find((item) => item.id === "G01")!;

  it("renders the supplied G01 background and finger as the interactive mechanism scene", () => {
    const html = renderToStaticMarkup(createElement(MechanismScene, { event, active: false }));

    expect(html).toContain("/assets/events/G01/bgG01.png");
    expect(html).toContain("/assets/events/G01/finger.png");
    expect(html).toContain("打开机关，进入月萤遗迹");
    expect(html.match(/data-edge=/g)).toHaveLength(4);
  });

  it("keeps G01 audio-visual activation waiting while its haptic cue is gated", () => {
    const html = renderToStaticMarkup(
      createElement(ExperimentSceneRouter, {
        event,
        gameState: {} as never,
        onInteract: () => undefined,
        interactionActive: true,
        eventElapsedMs: 0,
        hapticGateHeld: true
      })
    );
    expect(html).toContain("mechanism-scene waiting");
  });

  it("keeps the entrance transition aligned after the 5.085 second shared cue", () => {
    const html = renderToStaticMarkup(createElement(MechanismScene, { event, active: true }));
    expect(html).toContain("--g01-enter-delay:5085ms");
    expect(html).toContain("--g01-enter-duration:1040ms");
  });
});
