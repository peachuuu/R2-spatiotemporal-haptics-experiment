"use client";

import { useEffect, useRef } from "react";
import { AUDIO_VOLUME, setAudioVolume } from "../game/audioLevels";

export function RainAudio({ src, hapticGateHeld = false }: { src: string; hapticGateHeld?: boolean }) {
  const audio = useRef<HTMLAudioElement>(null);
  const played = useRef(false);
  useEffect(() => {
    const node = audio.current;
    if (!node) return;
    setAudioVolume(node, AUDIO_VOLUME.rain);
    return () => {
      node.pause();
      node.currentTime = 0;
    };
  }, []);
  useEffect(() => {
    if (!hapticGateHeld && !played.current && audio.current) {
      played.current = true;
      audio.current.currentTime = 0;
      void audio.current.play().catch(() => undefined);
    }
  }, [hapticGateHeld]);
  return <audio ref={audio} src={src} preload="auto" />;
}
