"use client";
import type { CSSProperties } from "react";
import { G06_ASSETS, G06_TIMING, G10_ASSETS, type TimelineEvent } from "../game/eventTimeline";
import { ChestAudio } from "./ChestAudio";

export function ChestDetailScene({ event, eventElapsedMs, active = true, hapticGateHeld = false }: { event: TimelineEvent; eventElapsedMs: number; active?: boolean; hapticGateHeld?: boolean }) {
  const activeElapsedMs = active ? eventElapsedMs : 0;
  const traceProgress = Math.min(1, Math.max(0, (activeElapsedMs - G06_TIMING.settleEndMs) / (G06_TIMING.traceEndMs - G06_TIMING.settleEndMs)));
  const opening = active && activeElapsedMs >= G06_TIMING.openAtMs;
  const assets = event.id === "G10" ? G10_ASSETS : G06_ASSETS;
  const phase = !active ? "waiting" : activeElapsedMs < G06_TIMING.settleEndMs ? "settle" : activeElapsedMs < G06_TIMING.traceEndMs ? "trace" : activeElapsedMs < G06_TIMING.openAtMs ? "unlock" : activeElapsedMs < G06_TIMING.openEndMs ? "open" : "afterglow";
  return <section className={`detail-scene g06-scene ${phase}`} data-scene="chest-detail" data-event-id={event.id} data-g06-phase={phase}>
    <img className="g06-frame g06-closed" src={assets.closed} alt="关闭的符文宝箱" />
    <img className={`g06-frame g06-open ${opening ? "visible" : ""}`} src={assets.open} alt="开启的符文宝箱" />
    {!opening && <><span className="g06-ridge-track"><i style={{ "--trace-progress": traceProgress } as CSSProperties} /></span><img className="g06-finger" src={assets.finger} alt="食指指尖沿横向凸棱划过" style={{ left: `${31 + traceProgress * 38}%` }} /></>}
    <span className="g06-unlock-bloom" aria-hidden="true" />
    <ChestAudio event={event} eventElapsedMs={activeElapsedMs} active={active} hapticGateHeld={hapticGateHeld} />
  </section>;
}
