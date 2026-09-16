"use client";

import { useEffect, useRef } from "react";
import { G04_ASSETS, G04_TIMING } from "../game/eventTimeline";
import { AUDIO_VOLUME, setAudioVolume } from "../game/audioLevels";

export function G04Audio({ eventElapsedMs, hapticGateHeld = false }: { eventElapsedMs: number; hapticGateHeld?: boolean }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const played = useRef(false);

  useEffect(() => {
    setAudioVolume(audioRef.current, AUDIO_VOLUME.g04Ghost);
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
      }
    };
  }, []);
  useEffect(() => {
    if (!hapticGateHeld && !played.current && eventElapsedMs >= G04_TIMING.audioStartMs) {
      played.current = true;
      void audioRef.current?.play().catch(() => undefined);
    }
  }, [eventElapsedMs, hapticGateHeld]);

  return <audio ref={audioRef} src={G04_ASSETS.audio} preload="auto" />;
}
