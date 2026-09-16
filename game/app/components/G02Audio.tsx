"use client";

import { useEffect, useRef } from "react";
import { G02_ASSETS, G02_TIMING } from "../game/eventTimeline";
import { AUDIO_VOLUME, setAudioVolume } from "../game/audioLevels";

export function G02Audio({ eventElapsedMs, hapticGateHeld = false }: { eventElapsedMs: number; hapticGateHeld?: boolean }) {
  const heroAudio = useRef<HTMLAudioElement>(null);
  const bossAudio = useRef<HTMLAudioElement>(null);
  const rubbleAudio = useRef<HTMLAudioElement>(null);

  const played = useRef({ hero: false, boss: false, rubble: false });
  useEffect(() => {
    setAudioVolume(heroAudio.current, AUDIO_VOLUME.g02Hero);
    setAudioVolume(bossAudio.current, AUDIO_VOLUME.g02Boss);
    setAudioVolume(rubbleAudio.current, AUDIO_VOLUME.g02Rubble);
    return () => {
      for (const audio of [heroAudio.current, bossAudio.current, rubbleAudio.current]) {
        audio?.pause();
        if (audio) audio.currentTime = 0;
      }
    };
  }, []);
  useEffect(() => {
    if (hapticGateHeld) return;
    if (!played.current.hero && eventElapsedMs >= 0) {
      played.current.hero = true;
      void heroAudio.current?.play().catch(() => undefined);
    }
    if (!played.current.boss && eventElapsedMs >= G02_TIMING.pauseEndMs) {
      played.current.boss = true;
      void bossAudio.current?.play().catch(() => undefined);
    }
    if (!played.current.rubble && eventElapsedMs >= G02_TIMING.rubbleStartMs) {
      played.current.rubble = true;
      void rubbleAudio.current?.play().catch(() => undefined);
    }
  }, [eventElapsedMs, hapticGateHeld]);

  return (
    <>
      <audio ref={heroAudio} src={G02_ASSETS.heroAudio} preload="auto" />
      <audio ref={bossAudio} src={G02_ASSETS.bossAudio} preload="auto" />
      <audio ref={rubbleAudio} src={G02_ASSETS.rubbleAudio} preload="auto" />
    </>
  );
}
