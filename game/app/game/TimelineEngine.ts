import { buildStageOrder, TIMELINE_EVENTS, type TimelineEvent } from "./eventTimeline";
import type { RunMode } from "./types";

export type TimelineRecord = { timelineEventId: string; timelineOrder: number; outcome: "started" | "completed" | "skipped"; atMs: number };
export type TimelineState = { started: boolean; completed: boolean; currentIndex: number; current: TimelineEvent; events: TimelineEvent[]; eventStartedAtMs: number; seed: string; interactionActive: boolean; interactionCompleted: boolean; pauseRequested: boolean; awaitingContinue: boolean };

export function createTimelineEngine({ mode, seed }: { mode: RunMode; seed: string }) {
  const events = TIMELINE_EVENTS.flatMap((event) => event.id === "G07" ? buildStageOrder("A", mode, seed) : event.id === "G11" ? buildStageOrder("B", mode, seed) : [event]);
  const records: TimelineRecord[] = [];
  let state: TimelineState = { started: false, completed: false, currentIndex: 0, current: events[0], events, eventStartedAtMs: 0, seed, interactionActive: false, interactionCompleted: false, pauseRequested: false, awaitingContinue: false };
  const needsStartInteraction = (id: string) => id === "G01";
  const startEvent = (atMs: number) => { if (!state.current) return; state = { ...state, eventStartedAtMs: atMs, interactionActive: !needsStartInteraction(state.current.id), interactionCompleted: false }; records.push({ timelineEventId: state.current.id, timelineOrder: state.currentIndex, outcome: "started", atMs }); };
  const moveToNext = (atMs: number) => {
    const next = state.currentIndex + 1;
    if (!events[next]) { state = { ...state, completed: true, pauseRequested: false, awaitingContinue: false }; return true; }
    state = { ...state, currentIndex: next, current: events[next], pauseRequested: false, awaitingContinue: false };
    startEvent(atMs);
    return true;
  };
  const advance = (atMs: number, outcome: "completed" | "skipped" = "completed") => {
    if (!state.started || state.completed || state.awaitingContinue) return false;
    records.push({ timelineEventId: state.current.id, timelineOrder: state.currentIndex, outcome, atMs });
    if (state.pauseRequested && events[state.currentIndex + 1]) {
      state = { ...state, pauseRequested: false, awaitingContinue: true };
      return true;
    }
    return moveToNext(atMs);
  };
  return {
    start(atMs: number) { if (state.started) return; state = { ...state, started: true }; startEvent(atMs); },
    requestPause() {
      if (!state.started || state.completed || state.awaitingContinue || state.pauseRequested) return false;
      state = { ...state, pauseRequested: true };
      return true;
    },
    continueAfterPause(atMs: number) {
      if (!state.awaitingContinue) return false;
      return moveToNext(atMs);
    },
    tick(atMs: number) { if (state.started && !state.completed && state.interactionActive && state.current.transition === "auto" && state.current.durationMs > 0 && atMs - state.eventStartedAtMs >= state.current.durationMs) advance(atMs); if (state.current.id === "G01" && state.interactionActive && atMs - state.eventStartedAtMs >= state.current.durationMs) advance(atMs); if (state.current.kind === "chest-discovery" && state.current.parameters.directOpen === true && state.interactionCompleted && atMs - state.eventStartedAtMs >= state.current.durationMs) advance(atMs); },
    completeInteraction(atMs: number) {
      if (needsStartInteraction(state.current.id)) {
        if (state.interactionActive) return false;
        state = { ...state, interactionActive: true, eventStartedAtMs: atMs };
        return true;
      }
      if (state.current.kind === "chest-discovery" && state.current.parameters.directOpen === true) {
        if (state.interactionCompleted) return false;
        state = { ...state, interactionCompleted: true, eventStartedAtMs: atMs };
        return true;
      }
      // O/E only starts G01 or completes a chest-search event. Every
      // follow-up cinematic (ridge trace or direct chest opening) advances
      // on its own timeline, so a repeated input cannot skip its animation
      // or haptic cue.
      if (state.current.kind === "chest-discovery") return advance(atMs);
      return false;
    }, completeCombat: (atMs: number) => advance(atMs),
    skip(atMs: number) { return mode === "developer" ? advance(atMs, "skipped") : false; },
    emergencySkip(atMs: number) {
      const skippedEventId = state.current.id;
      return advance(atMs, "skipped") ? skippedEventId : false;
    },
    jumpTo(id: string, atMs: number) { if (mode !== "developer") return false; const index = events.findIndex((event) => event.id === id || event.id.startsWith(`${id}-`)); if (index < 0) return false; state = { ...state, started: true, completed: false, currentIndex: index, current: events[index] }; startEvent(atMs); return true; },
    previous(atMs: number) { if (mode !== "developer" || state.currentIndex === 0) return false; state = { ...state, currentIndex: state.currentIndex - 1, current: events[state.currentIndex - 1], completed: false }; startEvent(atMs); return true; },
    getState: () => ({ ...state }), getRecords: () => [...records],
  };
}
