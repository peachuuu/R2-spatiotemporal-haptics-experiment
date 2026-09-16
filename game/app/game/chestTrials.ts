import { G05_TIMING, G09_TIMING, type TimelineEvent } from "./eventTimeline";

export function chestCueStartMs(event: TimelineEvent) {
  return Number(
    event.parameters.cueStartMs ??
      (event.id === "G05" ? G05_TIMING.cueStartMs : G09_TIMING.taskStartMs),
  );
}

/** 宝箱提示音在事件时间轴中的实际起播点；未单列时沿用既有提示点。 */
export function chestAudioOnsetMs(event: TimelineEvent) {
  return Number(
    event.parameters.audioStartMs ??
      (event.id === "G05" ? G05_TIMING.audioStartMs : G09_TIMING.audioStartMs),
  );
}

export function chestTrialIndex(event: TimelineEvent) {
  return Number(event.parameters.chestTrialIndex ?? 1);
}

export function chestSearchMeasurement({
  event,
  eventStartedAtMs,
  foundAtMs,
  chestX,
  playerStartX,
}: {
  event: TimelineEvent;
  eventStartedAtMs: number;
  foundAtMs: number;
  chestX: number;
  playerStartX: number;
}) {
  const audioOnsetMs = eventStartedAtMs + chestAudioOnsetMs(event);
  const interactionTimeMs = foundAtMs;
  return {
    trialIndex: chestTrialIndex(event),
    reactionTimeMs: Math.max(0, interactionTimeMs - audioOnsetMs),
    details: {
      audioOnsetMs,
      interactionTimeMs,
      completionTimeMs: Math.max(0, interactionTimeMs - audioOnsetMs),
      // 保留历史字段，确保既有原始事件消费者不受影响。
      searchStartedAtMs: audioOnsetMs,
      foundAtMs: interactionTimeMs,
      chestX,
      chestSide: chestX < 50 ? "left" : "right",
      playerStartX,
      completedAttackCount: Number(event.parameters.completedAttackCount ?? 0),
      directOpen: event.parameters.directOpen === true,
    },
  } as const;
}
