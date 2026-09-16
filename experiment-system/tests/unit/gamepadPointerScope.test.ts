import { describe, expect, it } from "vitest";
import { pageGamepadPointerEnabled } from "../../src/input/gamepadPointerScope";
import { pageScrollDirection } from "../../src/input/gamepadControls";

describe("page gamepad pointer scope", () => {
  it("disables page-level controller navigation during both embedded condition games", () => {
    expect(pageGamepadPointerEnabled("condition-1")).toBe(false);
    expect(pageGamepadPointerEnabled("condition-2")).toBe(false);
    expect(pageGamepadPointerEnabled("instruction")).toBe(false);
  });

  it("keeps controller page navigation available outside the condition games", () => {
    expect(pageGamepadPointerEnabled("calibration")).toBe(true);
    expect(pageGamepadPointerEnabled("comparison")).toBe(true);
  });
});

describe("page gamepad scroll", () => {
  it("uses the right-stick vertical axis exclusively for page scroll", () => {
    expect(pageScrollDirection({ axes: [0, 0, 0, 0.8], buttons: [] })).toBe(0.8);
    expect(pageScrollDirection({ axes: [0, 0, 0, -0.8], buttons: [] })).toBe(-0.8);
    expect(pageScrollDirection({ axes: [0, 0.9, 0, 0], buttons: [] })).toBe(0);
  });
});
