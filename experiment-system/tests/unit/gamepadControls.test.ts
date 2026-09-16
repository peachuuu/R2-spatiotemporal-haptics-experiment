import { describe, expect, it } from "vitest";
import { circlePressed, pointerDirection } from "../../src/input/gamepadControls";

function gamepad({ axes = [0, 0], pressed = [] }: { axes?: number[]; pressed?: number[] } = {}) {
  return {
    axes,
    buttons: Array.from({ length: 16 }, (_, index) => ({ pressed: pressed.includes(index), value: pressed.includes(index) ? 1 : 0 }))
  };
}

describe("PS5 gamepad controls", () => {
  it("uses the left stick for virtual pointer movement and ignores stick drift", () => {
    expect(pointerDirection(gamepad({ axes: [0.1, -0.1] }))).toEqual({ x: 0, y: 0 });
    expect(pointerDirection(gamepad({ axes: [0.8, -0.4] }))).toEqual({ x: 0.8, y: -0.4 });
  });

  it("uses the D-pad and normalises diagonal movement", () => {
    expect(pointerDirection(gamepad({ pressed: [15] }))).toEqual({ x: 1, y: 0 });
    const diagonal = pointerDirection(gamepad({ pressed: [12, 14] }));
    expect(diagonal.x).toBeCloseTo(-Math.SQRT1_2);
    expect(diagonal.y).toBeCloseTo(-Math.SQRT1_2);
  });

  it("maps PS5 Circle (standard button 1) to the click action", () => {
    expect(circlePressed(gamepad({ pressed: [1] }))).toBe(true);
    expect(circlePressed(gamepad({ pressed: [0] }))).toBe(false);
  });
});
