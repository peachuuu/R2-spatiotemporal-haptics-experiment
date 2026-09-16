"use client";

import { useEffect, useRef } from "react";
import { G06_ASSETS, G10_ASSETS, type TimelineEvent } from "../game/eventTimeline";
import { AUDIO_VOLUME, setAudioVolume } from "../game/audioLevels";

export function DirectChestOpenScene({
  event,
  eventElapsedMs,
}: {
  event: TimelineEvent;
  eventElapsedMs: number;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const played = useRef(false);
  const assets = event.id.startsWith("G11-") ? G10_ASSETS : G06_ASSETS;

  useEffect(() => {
    setAudioVolume(audioRef.current, AUDIO_VOLUME.chestOpen);
    if (!played.current && audioRef.current) {
      played.current = true;
      audioRef.current.currentTime = 0;
      void audioRef.current.play().catch(() => undefined);
    }
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
      }
    };
  }, []);

  const opening = eventElapsedMs < Number(event.parameters.openDurationMs ?? 1217);
  return (
    <section className={`detail-scene g06-scene direct-chest-open ${opening ? "open" : "afterglow"}`} data-scene="direct-chest-open" data-event-id={event.id}>
      <img className="g06-frame g06-open visible" src={assets.open} alt="开启的符文宝箱" />
      <span className="g06-unlock-bloom" aria-hidden="true" />
      <audio ref={audioRef} src={assets.openAudio} preload="auto" />
    </section>
  );
}
