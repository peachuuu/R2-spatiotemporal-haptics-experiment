"use client";

import { useEffect, useRef } from "react";
import { G03_ASSETS, G03_TIMING } from "../game/eventTimeline";
import { AUDIO_VOLUME, setAudioVolume } from "../game/audioLevels";

export function G03Audio({ eventElapsedMs, hapticGateHeld = false }: { eventElapsedMs: number; hapticGateHeld?: boolean }) {
  const castAudio = useRef<HTMLAudioElement>(null);
  const fireAudio = useRef<HTMLAudioElement>(null);
  const played = useRef({ cast: false, fire: false });

  useEffect(() => {
    setAudioVolume(castAudio.current, AUDIO_VOLUME.g03Cast);
    setAudioVolume(fireAudio.current, AUDIO_VOLUME.g03Fire);
    return () => {
      for (const audio of [castAudio.current, fireAudio.current]) {
        audio?.pause();
        if (audio) audio.currentTime = 0;
      }
    };
  }, []);
  useEffect(() => {
    if (hapticGateHeld) return;
    if (!played.current.cast && eventElapsedMs >= 0) { played.current.cast = true; void castAudio.current?.play().catch(() => undefined); }
    if (!played.current.fire && eventElapsedMs >= G03_TIMING.castEndMs) { played.current.fire = true; void fireAudio.current?.play().catch(() => undefined); }
  }, [eventElapsedMs, hapticGateHeld]);

  return (
    <>
      <audio ref={castAudio} src={G03_ASSETS.castAudio} preload="auto" />
      <audio ref={fireAudio} src={G03_ASSETS.fireAudio} preload="auto" />
    </>
  );
}
