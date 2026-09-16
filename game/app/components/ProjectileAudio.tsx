"use client";

import { useEffect, useRef } from "react";
import type { TimelineEvent } from "../game/eventTimeline";
import { AUDIO_VOLUME, setAudioVolume } from "../game/audioLevels";
import { shouldStartEventAudio } from "../game/eventAudio";

export function ProjectileAudio({
  event,
  src,
  hapticGateHeld = false,
}: {
  event: TimelineEvent;
  src: string;
  hapticGateHeld?: boolean;
}) {
  const audio = useRef<HTMLAudioElement>(null);
  const playedEventId = useRef<string>();
  useEffect(() => {
    const node = audio.current;
    if (!node) return;
    setAudioVolume(
      node,
      event.parameters.speed === "fast"
        ? AUDIO_VOLUME.projectileFast
        : AUDIO_VOLUME.projectileSlow,
    );
    return () => {
      node.pause();
      node.currentTime = 0;
    };
  }, [event.id, src]);
  useEffect(() => {
    if (
      audio.current &&
      shouldStartEventAudio({
        eventId: event.id,
        previouslyPlayedEventId: playedEventId.current,
        hapticGateHeld,
      })
    ) {
      playedEventId.current = event.id;
      audio.current.currentTime = 0;
      void audio.current.play().catch(() => undefined);
    }
  }, [event.id, hapticGateHeld]);
  return <audio ref={audio} src={src} preload="auto" />;
}
