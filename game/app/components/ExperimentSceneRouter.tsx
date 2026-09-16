"use client";
import { G09_TIMING, getEventPrompt, type TimelineEvent } from "../game/eventTimeline";
import type { GameState } from "../game/GameEngine";
import { ChestDetailScene } from "./ChestDetailScene";
import { DirectChestOpenScene } from "./DirectChestOpenScene";
import { GameViewport } from "./GameViewport";
import { MechanismScene } from "./MechanismScene";
export function ExperimentSceneRouter({ event, gameState, onInteract, interactionActive, interactionCompleted = false, eventElapsedMs, hapticGateHeld = false, showEndOverlay = true, promptOverride }: { event: TimelineEvent; gameState: GameState; onInteract: () => void; interactionActive: boolean; interactionCompleted?: boolean; eventElapsedMs: number; hapticGateHeld?: boolean; showEndOverlay?: boolean; promptOverride?: string }) {
  const prompt = event.id === "G09" && eventElapsedMs < G09_TIMING.taskStartMs ? "" : getEventPrompt(event, eventElapsedMs);
  const scene = event.kind === "chest-discovery" && event.parameters.directOpen === true && interactionCompleted ? <DirectChestOpenScene event={event} eventElapsedMs={eventElapsedMs} />
    : event.scene === "mechanism" ? <MechanismScene event={event} active={interactionActive && !hapticGateHeld} />
    : event.scene === "chest-detail" ? <ChestDetailScene event={event} eventElapsedMs={eventElapsedMs} active={interactionActive} hapticGateHeld={hapticGateHeld} />
    : event.scene === "ending" ? <section className="detail-scene" data-scene="ending" data-event-id={event.id}><h2>本轮游戏结束</h2><p>请继续完成条件后评估。</p></section>
    : <GameViewport state={gameState} onInteract={onInteract} activeEvent={event} eventElapsedMs={eventElapsedMs} hapticGateHeld={hapticGateHeld} eventPrompt={promptOverride ?? prompt} showEndOverlay={showEndOverlay} />;
  return <div className="event-scene-stack">{scene}</div>;
}
