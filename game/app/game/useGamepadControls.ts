"use client";

import { useEffect, useRef } from "react";

export type GamepadAction = "JUMP" | "INTERACT";

type GamepadLike = {
  axes: readonly number[];
  buttons: readonly { pressed: boolean }[];
};

export function applyStickDeadzone(
  x: number,
  y: number,
  min = 0.18,
  max = 0.95,
) {
  const magnitude = Math.hypot(x, y);
  if (magnitude <= min) return 0;
  const normalizedMagnitude = Math.min(
    1,
    (magnitude - min) / Math.max(0.001, max - min),
  );
  return Math.max(-1, Math.min(1, (x / magnitude) * normalizedMagnitude));
}

export function readGamepadInput(pad: GamepadLike) {
  const up = Boolean(pad.buttons[12]?.pressed);
  const down = Boolean(pad.buttons[13]?.pressed);
  return {
    move: applyStickDeadzone(pad.axes[0] ?? 0, 0),
    navigation: up === down ? 0 : up ? (-1 as const) : (1 as const),
    jump: Boolean(pad.buttons[0]?.pressed),
    interact: Boolean(pad.buttons[1]?.pressed),
  };
}

export function getNavigationEdge(
  previous: -1 | 0 | 1,
  current: -1 | 0 | 1,
) {
  return previous === 0 && current !== 0 ? current : 0;
}

export function useGamepadControls({
  active,
  onMove,
  onAction,
  onNavigate,
}: {
  active: boolean;
  onMove: (value: number) => void;
  onAction: (action: GamepadAction) => void;
  onNavigate?: (delta: -1 | 1) => void;
}) {
  const moveRef = useRef(onMove);
  const actionRef = useRef(onAction);
  const navigateRef = useRef(onNavigate);
  useEffect(() => {
    moveRef.current = onMove;
  }, [onMove]);
  useEffect(() => {
    actionRef.current = onAction;
  }, [onAction]);
  useEffect(() => {
    navigateRef.current = onNavigate;
  }, [onNavigate]);
  useEffect(() => {
    if (!active) return;
    let frame = 0;
    let previousMove = 0;
    let previousNavigation: -1 | 0 | 1 = 0;
    let previousX = false;
    let previousCircle = false;
    const releaseMove = () => {
      if (previousMove !== 0) {
        previousMove = 0;
        moveRef.current(0);
      }
    };
    const poll = () => {
      const pad = Array.from(navigator.getGamepads?.() ?? []).find(
        (item) => item?.connected,
      );
      if (!pad) releaseMove();
      else {
        const input = readGamepadInput(pad);
        const move = input.move;
        if (
          Math.abs(move - previousMove) >= 0.015 ||
          (move === 0) !== (previousMove === 0)
        ) {
          previousMove = move;
          moveRef.current(move);
        }
        const navigationEdge = getNavigationEdge(
          previousNavigation,
          input.navigation,
        );
        if (navigationEdge) navigateRef.current?.(navigationEdge);
        previousNavigation = input.navigation;
        const xPressed = input.jump;
        const circlePressed = input.interact;
        if (xPressed && !previousX) actionRef.current("JUMP");
        if (circlePressed && !previousCircle) actionRef.current("INTERACT");
        previousX = xPressed;
        previousCircle = circlePressed;
      }
      frame = window.requestAnimationFrame(poll);
    };
    frame = window.requestAnimationFrame(poll);
    return () => {
      window.cancelAnimationFrame(frame);
      releaseMove();
    };
  }, [active]);
}
