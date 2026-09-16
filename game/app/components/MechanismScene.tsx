"use client";
import { useEffect, useRef, type CSSProperties } from "react";
import {
  G01_ASSETS,
  G01_TIMING,
  getEventPrompt,
  type TimelineEvent,
} from "../game/eventTimeline";
import { AUDIO_VOLUME, setAudioVolume } from "../game/audioLevels";

export function MechanismScene({
  event,
  active,
}: {
  event: TimelineEvent;
  active: boolean;
}) {
  const unlockAudio = useRef<HTMLAudioElement>(null);
  const enterAudio = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    if (!active) return;
    setAudioVolume(unlockAudio.current, AUDIO_VOLUME.g01Unlock);
    setAudioVolume(enterAudio.current, AUDIO_VOLUME.g01Enter);
    void unlockAudio.current?.play().catch(() => undefined);
    const enterTimer = window.setTimeout(() => {
      void enterAudio.current?.play().catch(() => undefined);
    }, G01_TIMING.enterSoundAtMs);
    return () => window.clearTimeout(enterTimer);
  }, [active]);

  return (
    <section
      className={`detail-scene mechanism-scene ${active ? "active" : "waiting"}`}
      data-scene="mechanism"
      data-event-id={event.id}
      style={{
        "--g01-enter-delay": `${G01_TIMING.enterSoundAtMs}ms`,
        "--g01-enter-duration": `${G01_TIMING.transitionMs}ms`,
      } as CSSProperties}
    >
      <img
        className="g01-background"
        src={G01_ASSETS.background}
        alt="月萤遗迹中的方形机关"
      />
      <div className="g01-copy">
        <p>{getEventPrompt(event)}</p>
        <small>
          {active ? "沿机关边缘完成解锁" : "按手柄O键开始解锁"}
        </small>
      </div>
      <div className="g01-edge g01-edge-left" data-edge="left" />
      <div className="g01-edge g01-edge-bottom" data-edge="bottom" />
      <div className="g01-edge g01-edge-right" data-edge="right" />
      <div className="g01-edge g01-edge-top" data-edge="top" />
      <div className="g01-start-point" />
      <div className="g01-core-glow" />
      <img
        className="finger-pointer"
        src={G01_ASSETS.finger}
        alt=""
        aria-hidden="true"
      />
      <div
        className="g01-transition"
        aria-hidden="true"
        style={active ? { animation: `g01EnterTransition ${G01_TIMING.transitionMs}ms ease-in ${G01_TIMING.enterSoundAtMs}ms both` } : undefined}
      />
      <audio ref={unlockAudio} src={G01_ASSETS.unlockAudio} preload="auto" />
      <audio ref={enterAudio} src={G01_ASSETS.enterAudio} preload="auto" />
    </section>
  );
}
