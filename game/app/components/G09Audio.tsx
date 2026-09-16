"use client";

import { useEffect, useRef } from "react";
import { G09_ASSETS, G09_TIMING } from "../game/eventTimeline";
import { AUDIO_VOLUME, setAudioVolume } from "../game/audioLevels";

export function G09Audio({ eventElapsedMs, hapticGateHeld = false }: { eventElapsedMs: number; hapticGateHeld?: boolean }) {
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
    if (!hapticGateHeld && !played.current && eventElapsedMs >= G09_TIMING.audioStartMs) {
      played.current = true;
      void audioRef.current?.play().catch(() => undefined);
    }
  }, [eventElapsedMs, hapticGateHeld]);
  return <audio ref={audioRef} src={G09_ASSETS.audio} preload="auto" />;
}
