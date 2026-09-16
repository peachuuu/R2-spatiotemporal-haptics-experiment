"use client";

import { useEffect, useRef } from "react";
import { G05_ASSETS, G05_TIMING } from "../game/eventTimeline";
import { AUDIO_VOLUME, setAudioVolume } from "../game/audioLevels";

export function G05Audio({ eventElapsedMs, hapticGateHeld = false, audioStartMs = G05_TIMING.audioStartMs }: { eventElapsedMs: number; hapticGateHeld?: boolean; audioStartMs?: number }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const played = useRef(false);

  useEffect(() => {
    setAudioVolume(audioRef.current, AUDIO_VOLUME.chestCue);
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
      }
    };
  }, []);
  useEffect(() => {
    if (!hapticGateHeld && !played.current && eventElapsedMs >= audioStartMs) {
      played.current = true;
      void audioRef.current?.play().catch(() => undefined);
    }
  }, [audioStartMs, eventElapsedMs, hapticGateHeld]);

  return <audio ref={audioRef} src={G05_ASSETS.audio} preload="auto" />;
}
