import { describe, expect, it } from "vitest";
import { shouldStartEventAudio } from "../../app/game/eventAudio";

describe("event audio replay policy", () => {
  it("starts a fast projectile after a prior slow projectile has played", () => {
    expect(
      shouldStartEventAudio({
        eventId: "G07-P02",
        previouslyPlayedEventId: "G07-P01",
        hapticGateHeld: false,
      }),
    ).toBe(true);
  });

  it("does not start audio while that event is waiting for its tactile cue", () => {
    expect(
      shouldStartEventAudio({
        eventId: "G07-P02",
        previouslyPlayedEventId: undefined,
        hapticGateHeld: true,
      }),
    ).toBe(false);
  });
});
