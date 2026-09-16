"use client";

import { useEffect, useRef } from "react";
import { AUDIO_VOLUME, setAudioVolume } from "../game/audioLevels";

export function G12Audio({
  src,
  startDelayMs = 0,
  eventElapsedMs,
  hapticGateHeld = false,
}: {
  src: string;
  startDelayMs?: number;
  eventElapsedMs: number;
  hapticGateHeld?: boolean;
}) {
  const audio = useRef<HTMLAudioElement>(null);
  const played = useRef(false);
  useEffect(() => {
    const node = audio.current;
    if (!node) return;
    setAudioVolume(node, AUDIO_VOLUME.fireworks);
    return () => {
      node.pause();
      node.currentTime = 0;
    };
  }, [src]);
  useEffect(() => {
    if (!hapticGateHeld && !played.current && eventElapsedMs >= startDelayMs && audio.current) {
      played.current = true;
      audio.current.currentTime = 0;
      void audio.current.play().catch(() => undefined);
    }
  }, [eventElapsedMs, hapticGateHeld, startDelayMs]);
  return <audio ref={audio} src={src} preload="auto" />;
}
