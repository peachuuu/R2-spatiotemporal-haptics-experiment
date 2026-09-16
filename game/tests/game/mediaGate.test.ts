import { describe, expect, it } from "vitest";
import { shouldHoldCueMedia } from "../../app/game/mediaGate";

describe("cue media gate", () => {
  it("holds the initial G01 interaction until its first cue is released", () => {
    expect(
      shouldHoldCueMedia({
        hapticGatedMode: true,
        eventId: "G01",
        mediaGateOpen: false,
        cueHeld: false,
      }),
    ).toBe(true);
  });

  it("does not suppress G02 cinematic audio before its later rubble cue", () => {
    expect(
      shouldHoldCueMedia({
        hapticGatedMode: true,
        eventId: "G02",
        mediaGateOpen: false,
        cueHeld: false,
      }),
    ).toBe(false);
  });

  it("holds any event while its own cue is preparing", () => {
    expect(
      shouldHoldCueMedia({
        hapticGatedMode: true,
        eventId: "G04",
        mediaGateOpen: true,
        cueHeld: true,
      }),
    ).toBe(true);
  });
});
