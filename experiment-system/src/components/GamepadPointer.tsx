import { useEffect, useRef, useState } from "react";
import { circlePressed, pageScrollDirection, pointerDirection } from "../input/gamepadControls";

type Position = { x: number; y: number };

const POINTER_SPEED = 880;
const SCROLL_SPEED = 1100;

function clamp(value: number, max: number): number {
  return Math.min(Math.max(value, 0), Math.max(max, 0));
}

function clickAt(position: Position) {
  const hit = document.elementFromPoint(position.x, position.y);
  const target = hit?.closest<HTMLElement>(
    "button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [role='button'], label"
  );
  if (target === null || target === undefined) return;

  target.focus?.({ preventScroll: true });
  target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX: position.x, clientY: position.y, button: 0 }));
  target.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: position.x, clientY: position.y, button: 0 }));
  target.click();
}

/**
 * Global PS5-compatible virtual mouse.
 * The Gamepad API's standard mapping exposes left-stick axes at 0/1, D-pad at
 * buttons 12–15, and Circle at button 1. It is deliberately UI-only: it does
 * not call experiment adapters or hardware APIs.
 */
export function GamepadPointer() {
  const [position, setPosition] = useState<Position>({ x: 0, y: 0 });
  const [visible, setVisible] = useState(false);
  const [connected, setConnected] = useState(false);
  const positionRef = useRef(position);
  const initializedRef = useRef(false);
  const circleWasPressedRef = useRef(false);

  useEffect(() => {
    let frame = 0;
    let previousTime = performance.now();

    const updateConnection = () => setConnected(Array.from(navigator.getGamepads?.() ?? []).some(gamepad => gamepad?.connected));
    const onGamepadChange = () => updateConnection();
    window.addEventListener("gamepadconnected", onGamepadChange);
    window.addEventListener("gamepaddisconnected", onGamepadChange);

    const tick = (now: number) => {
      const deltaSeconds = Math.min((now - previousTime) / 1000, 0.05);
      previousTime = now;
      const gamepad = Array.from(navigator.getGamepads?.() ?? []).find(candidate => candidate?.connected);

      if (gamepad !== undefined && gamepad !== null) {
        setConnected(true);
        if (!initializedRef.current) {
          initializedRef.current = true;
          positionRef.current = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
          setPosition(positionRef.current);
        }

        const direction = pointerDirection(gamepad);
        if (direction.x !== 0 || direction.y !== 0) {
          const next = {
            x: clamp(positionRef.current.x + direction.x * POINTER_SPEED * deltaSeconds, window.innerWidth),
            y: clamp(positionRef.current.y + direction.y * POINTER_SPEED * deltaSeconds, window.innerHeight)
          };
          positionRef.current = next;
          setPosition(next);
          setVisible(true);
        }

        const scroll = pageScrollDirection(gamepad);
        if (scroll !== 0) window.scrollBy({ top: scroll * SCROLL_SPEED * deltaSeconds, behavior: "auto" });

        const circleIsPressed = circlePressed(gamepad);
        if (circleIsPressed && !circleWasPressedRef.current) {
          setVisible(true);
          clickAt(positionRef.current);
        }
        circleWasPressedRef.current = circleIsPressed;
      } else {
        setConnected(false);
        circleWasPressedRef.current = false;
      }

      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    updateConnection();
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("gamepadconnected", onGamepadChange);
      window.removeEventListener("gamepaddisconnected", onGamepadChange);
    };
  }, []);

  return (
    <>
      {connected && (
        <p className="gamepad-status" role="status">
          PS5 手柄已连接：左摇杆／方向键移动光标，右摇杆上下滚动，○ 键点击
        </p>
      )}
      {visible && (
        <span
          className="gamepad-pointer"
          aria-hidden="true"
          style={{ transform: `translate3d(${position.x}px, ${position.y}px, 0)` }}
        />
      )}
    </>
  );
}
