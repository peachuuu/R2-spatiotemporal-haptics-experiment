export type GamepadButtonLike = { pressed: boolean; value: number };

export type GamepadLike = {
  axes: readonly number[];
  buttons: readonly GamepadButtonLike[];
};

export type PointerDirection = { x: number; y: number };

export const GAMEPAD_DEAD_ZONE = 0.18;
export const PS5_CIRCLE_BUTTON = 1;

const DPAD_UP = 12;
const DPAD_DOWN = 13;
const DPAD_LEFT = 14;
const DPAD_RIGHT = 15;

function buttonPressed(gamepad: GamepadLike, index: number): boolean {
  const button = gamepad.buttons[index];
  return button?.pressed === true || (button?.value ?? 0) >= 0.5;
}

function axisValue(gamepad: GamepadLike, index: number): number {
  const value = gamepad.axes[index] ?? 0;
  return Math.abs(value) >= GAMEPAD_DEAD_ZONE ? value : 0;
}

/** Combines the left stick and D-pad into one normalised virtual-pointer direction. */
export function pointerDirection(gamepad: GamepadLike): PointerDirection {
  const x = axisValue(gamepad, 0) + (buttonPressed(gamepad, DPAD_RIGHT) ? 1 : 0) - (buttonPressed(gamepad, DPAD_LEFT) ? 1 : 0);
  const y = axisValue(gamepad, 1) + (buttonPressed(gamepad, DPAD_DOWN) ? 1 : 0) - (buttonPressed(gamepad, DPAD_UP) ? 1 : 0);
  const length = Math.hypot(x, y);
  return length > 1 ? { x: x / length, y: y / length } : { x, y };
}

/** Standard mapping: right-stick vertical axis scrolls the surrounding page. */
export function pageScrollDirection(gamepad: GamepadLike): number {
  return axisValue(gamepad, 3);
}

/** In the standard browser mapping, PS5 Circle is button index 1. */
export function circlePressed(gamepad: GamepadLike): boolean {
  return buttonPressed(gamepad, PS5_CIRCLE_BUTTON);
}
