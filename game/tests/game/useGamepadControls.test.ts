import { describe, expect, it } from "vitest";
import {
  applyStickDeadzone,
  getNavigationEdge,
  readGamepadInput,
} from "../../app/game/useGamepadControls";

describe("gamepad stick processing", () => {
  it("returns zero around the resting point and preserves analog strength outside it", () => {
    expect(applyStickDeadzone(0.1, 0)).toBe(0);
    expect(applyStickDeadzone(-0.1, 0.05)).toBe(0);
    expect(applyStickDeadzone(0.565, 0)).toBeCloseTo(0.5, 2);
    expect(applyStickDeadzone(-0.565, 0)).toBeCloseTo(-0.5, 2);
    expect(applyStickDeadzone(1, 0)).toBe(1);
  });

  it("uses the left stick for movement and only D-pad up/down for menu navigation", () => {
    const buttons = Array.from({ length: 16 }, () => ({ pressed: false }));
    buttons[12] = { pressed: true };
    buttons[15] = { pressed: true };
    const up = readGamepadInput({ axes: [0.565, 0.8], buttons });
    expect(up.move).toBeCloseTo(0.5, 3);
    expect(up.navigation).toBe(-1);
    buttons[12] = { pressed: false };
    buttons[13] = { pressed: true };
    buttons[14] = { pressed: true };
    expect(readGamepadInput({ axes: [0, 0], buttons })).toMatchObject({
      move: 0,
      navigation: 1,
    });
  });

  it("emits one menu navigation edge until the D-pad is released", () => {
    expect(getNavigationEdge(0, -1)).toBe(-1);
    expect(getNavigationEdge(-1, -1)).toBe(0);
    expect(getNavigationEdge(-1, 0)).toBe(0);
    expect(getNavigationEdge(0, 1)).toBe(1);
  });
});
