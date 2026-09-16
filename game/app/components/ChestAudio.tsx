"use client";

import { useEffect, useRef } from "react";
import {
  G06_ASSETS,
  G06_TIMING,
  G10_ASSETS,
  type TimelineEvent,
} from "../game/eventTimeline";
import { AUDIO_VOLUME, setAudioVolume } from "../game/audioLevels";

export function ChestAudio({
  event,
  eventElapsedMs,
  active = true,
  hapticGateHeld = false,
}: {
  event: TimelineEvent;
  eventElapsedMs: number;
  active?: boolean;
  hapticGateHeld?: boolean;
}) {
  const traceAudio = useRef<HTMLAudioElement>(null);
  const openAudio = useRef<HTMLAudioElement>(null);
  const played = useRef({ trace: "", open: "" });
  const assets = event.id === "G10" ? G10_ASSETS : G06_ASSETS;
  useEffect(() => {
    setAudioVolume(traceAudio.current, AUDIO_VOLUME.ridgeTrace);
    setAudioVolume(openAudio.current, AUDIO_VOLUME.chestOpen);
    if (
      active && !hapticGateHeld && eventElapsedMs >= G06_TIMING.settleEndMs &&
      played.current.trace !== event.id &&
      traceAudio.current
    ) {
      played.current.trace = event.id;
      traceAudio.current.currentTime = 0;
      void traceAudio.current.play().catch(() => undefined);
    }
    if (
      active && !hapticGateHeld && eventElapsedMs >= G06_TIMING.openAtMs &&
      played.current.open !== event.id &&
      openAudio.current
    ) {
      played.current.open = event.id;
      openAudio.current.currentTime = 0;
      void openAudio.current.play().catch(() => undefined);
    }
  }, [event.id, eventElapsedMs, active, hapticGateHeld]);
  useEffect(() => {
    return () => {
      for (const node of [traceAudio.current, openAudio.current])
        if (node) {
          node.pause();
          node.currentTime = 0;
        }
    };
  }, [event.id]);
  return (
    <>
      <audio
        key={`${event.id}-trace`}
        ref={traceAudio}
        src={assets.traceAudio}
        preload="auto"
      />
      <audio
        key={`${event.id}-open`}
        ref={openAudio}
        src={assets.openAudio}
        preload="auto"
      />
    </>
  );
}
