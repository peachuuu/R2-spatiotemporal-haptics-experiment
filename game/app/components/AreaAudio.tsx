"use client";

import { useEffect, useRef } from "react";
import type { TimelineEvent } from "../game/eventTimeline";
import { AUDIO_VOLUME, setAudioVolume } from "../game/audioLevels";

export function AreaAudio({
  event,
  eventElapsedMs,
  expansionSrc,
  impactSrc,
  hapticGateHeld = false,
}: {
  event: TimelineEvent;
  eventElapsedMs: number;
  expansionSrc: string;
  impactSrc: string;
  hapticGateHeld?: boolean;
}) {
  const expansion = useRef<HTMLAudioElement>(null);
  const impact = useRef<HTMLAudioElement>(null);
  const played = useRef({ expansion: "", impact: "" });
  const telegraphMs = Number(event.parameters.telegraphMs ?? 0);
  const impactAtMs = Number(event.parameters.impactAtMs ?? event.durationMs);
  useEffect(() => {
    setAudioVolume(
      expansion.current,
      event.parameters.speed === "fast"
        ? AUDIO_VOLUME.areaFast
        : AUDIO_VOLUME.areaSlow,
    );
    setAudioVolume(impact.current, AUDIO_VOLUME.areaImpact);
    if (
      !hapticGateHeld &&
      eventElapsedMs >= telegraphMs &&
      played.current.expansion !== event.id &&
      expansion.current
    ) {
      played.current.expansion = event.id;
      expansion.current.currentTime = 0;
      void expansion.current.play().catch(() => undefined);
    }
    if (
      !hapticGateHeld &&
      eventElapsedMs >= impactAtMs &&
      played.current.impact !== event.id &&
      impact.current
    ) {
      played.current.impact = event.id;
      impact.current.currentTime = 0;
      void impact.current.play().catch(() => undefined);
    }
  }, [event.id, eventElapsedMs, impactAtMs, telegraphMs, hapticGateHeld]);
  useEffect(
    () => () => {
      for (const node of [expansion.current, impact.current])
        if (node) {
          node.pause();
          node.currentTime = 0;
        }
    },
    [event.id],
  );
  return (
    <>
      <audio
        key={`${event.id}-expansion`}
        ref={expansion}
        src={expansionSrc}
        preload="auto"
      />
      <audio
        key={`${event.id}-impact`}
        ref={impact}
        src={impactSrc}
        preload="auto"
      />
    </>
  );
}
