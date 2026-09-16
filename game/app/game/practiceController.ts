import {
  resolveEdgeLockAnchor,
  resolveOppositeChestX,
} from "./eventTimeline";

export const PRACTICE_PREPARE_MS = 2000;

export type PracticeTask = "projectile" | "area" | "chest";
export type PracticeAction = PracticeTask | "complete";
export type PracticePhase =
  | "idle"
  | "projectile-wait"
  | "projectile-active"
  | "area-wait"
  | "area-active"
  | "chest-active"
  | "completing"
  | "complete";

export type PracticeState = {
  embedded: boolean;
  phase: PracticePhase;
  focusedAction: PracticeAction;
  activeTask?: PracticeTask;
  phaseStartedAtMs: number;
  projectileDirection?: "left" | "right";
  areaCenter?: number;
  chestX?: number;
};

const actionsFor = (embedded: boolean): readonly PracticeAction[] =>
  embedded
    ? ["projectile", "area", "chest", "complete"]
    : ["projectile", "area", "chest"];

export function createPracticeState(embedded: boolean): PracticeState {
  return {
    embedded,
    phase: "idle",
    focusedAction: "projectile",
    phaseStartedAtMs: 0,
  };
}

export function movePracticeFocus(
  state: PracticeState,
  delta: -1 | 1,
): PracticeState {
  if (state.phase !== "idle") return state;
  const actions = actionsFor(state.embedded);
  const current = actions.indexOf(state.focusedAction);
  const next = (current + delta + actions.length) % actions.length;
  return { ...state, focusedAction: actions[next] };
}

export function beginPracticeTask(
  state: PracticeState,
  task: PracticeTask,
  playerX: number,
  randomValue: number,
  atMs: number,
): PracticeState {
  if (state.phase !== "idle") return state;
  if (task === "projectile")
    return {
      ...state,
      phase: "projectile-wait",
      focusedAction: task,
      activeTask: task,
      phaseStartedAtMs: atMs,
      projectileDirection: randomValue < 0.5 ? "left" : "right",
    };
  if (task === "area")
    return {
      ...state,
      phase: "area-wait",
      focusedAction: task,
      activeTask: task,
      phaseStartedAtMs: atMs,
      areaCenter: resolveEdgeLockAnchor(playerX),
    };
  return {
    ...state,
    phase: "chest-active",
    focusedAction: task,
    activeTask: task,
    phaseStartedAtMs: atMs,
    chestX: resolveOppositeChestX(playerX),
  };
}

export function advancePractice(
  state: PracticeState,
  atMs: number,
): PracticeState {
  if (atMs - state.phaseStartedAtMs < PRACTICE_PREPARE_MS) return state;
  if (state.phase === "projectile-wait")
    return { ...state, phase: "projectile-active", phaseStartedAtMs: atMs };
  if (state.phase === "area-wait")
    return { ...state, phase: "area-active", phaseStartedAtMs: atMs };
  return state;
}

export function completePracticeTask(
  state: PracticeState,
  atMs: number,
): PracticeState {
  if (state.phase === "idle" || state.phase === "complete") return state;
  return {
    embedded: state.embedded,
    phase: "idle",
    focusedAction: state.activeTask ?? state.focusedAction,
    activeTask: undefined,
    phaseStartedAtMs: atMs,
    projectileDirection: undefined,
    areaCenter: undefined,
    chestX: undefined,
  };
}

export function beginPracticeCompletion(
  state: PracticeState,
  atMs: number,
): PracticeState {
  if (!state.embedded || state.phase !== "idle") return state;
  return { ...state, phase: "completing", phaseStartedAtMs: atMs };
}

export function finishPracticeCompletion(state: PracticeState): PracticeState {
  return state.phase === "completing" ? { ...state, phase: "complete" } : state;
}
