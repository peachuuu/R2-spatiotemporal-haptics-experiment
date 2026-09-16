"use client";

import { useEffect, useRef } from "react";

export function useGameLoop(active: boolean, onFrame: (now: number) => void) {
  const onFrameRef = useRef(onFrame);
  useEffect(() => { onFrameRef.current = onFrame; }, [onFrame]);
  useEffect(() => {
    if (!active) return;
    let frame = 0;
    // 传递绝对 performance.now()；cue 编排需要与 R2 时钟对齐。
    const tick = (now: number) => { onFrameRef.current(now); frame = requestAnimationFrame(tick); };
    frame = requestAnimationFrame(tick); return () => cancelAnimationFrame(frame);
  }, [active]);
}
