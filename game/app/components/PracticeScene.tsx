"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createGameEngine, type GameInput, type GameState } from "../game/GameEngine";
import {
  G07_AREA,
  G07_PROJECTILE_TIMING,
  getProjectileX,
  isAreaImpactHit,
  isPlayerWithinChestInteraction,
  type TimelineEvent,
} from "../game/eventTimeline";
import {
  PRACTICE_PREPARE_MS,
  advancePractice,
  beginPracticeCompletion,
  beginPracticeTask,
  completePracticeTask,
  createPracticeState,
  finishPracticeCompletion,
  movePracticeFocus,
  type PracticeAction,
  type PracticeState,
  type PracticeTask,
} from "../game/practiceController";
import { createPracticeBridge } from "../game/practiceBridge";
import { practiceCueFor } from "../game/practiceHaptics";
import type { LaunchConfig } from "../game/types";
import { useGameLoop } from "../game/useGameLoop";
import { useGamepadControls } from "../game/useGamepadControls";
import { GameControls, type SelectableMode } from "./GameControls";
import { GameViewport } from "./GameViewport";
import { PracticeTaskMenu } from "./PracticeTaskMenu";

const localPracticeConfig: LaunchConfig = {
  mode: "practice",
  sessionId: "PRACTICE",
  runId: "PRACTICE-SANDBOX",
  conditionId: "NH",
  projectileSequenceId: "S1",
  areaSequenceId: "A1",
  embedded: false,
};

const idleEvent: TimelineEvent = {
  id: "PRACTICE-IDLE",
  scene: "side-scroll",
  kind: "combat-break",
  durationMs: 0,
  transition: "auto",
  visibility: "full",
  hapticSampleKey: "none",
  parameters: {},
  skipAllowed: true,
};

const createProjectileEvent = (direction: "left" | "right"): TimelineEvent => ({
  id: "PRACTICE-PROJECTILE",
  scene: "side-scroll",
  kind: "projectile",
  durationMs: G07_PROJECTILE_TIMING.fastMs,
  transition: "auto",
  visibility: "full",
  hapticSampleKey: "projectile-pass",
  parameters: { direction, speed: "fast" },
  skipAllowed: true,
});

const createAreaEvent = (center: number): TimelineEvent => ({
  id: "PRACTICE-AREA",
  scene: "side-scroll",
  kind: "area",
  durationMs: G07_AREA.fastMs,
  transition: "auto",
  visibility: "full",
  hapticSampleKey: "danger-area-expand",
  parameters: {
    speed: "fast",
    center,
    anchorX: center,
    targetMode: "fixed-anchor",
    halfWidth: G07_AREA.halfWidthPercent,
    telegraphMs: G07_AREA.telegraphMs,
    expansionMs: G07_AREA.fastExpansionMs,
    impactAtMs: G07_AREA.telegraphMs + G07_AREA.fastExpansionMs + 120,
  },
  skipAllowed: true,
});

const createChestEvent = (chestX: number): TimelineEvent => ({
  id: "PRACTICE-CHEST",
  scene: "side-scroll",
  kind: "chest-discovery",
  durationMs: 0,
  transition: "player-interact",
  visibility: "full",
  hapticSampleKey: "chest-cue",
  parameters: { chestX, cueStartMs: 0 },
  skipAllowed: true,
});

export function PracticeScene({
  selectedMode,
  onModeChange,
  launchConfig = localPracticeConfig,
  random = Math.random,
}: {
  selectedMode?: SelectableMode;
  onModeChange?: (mode: SelectableMode) => void;
  launchConfig?: LaunchConfig;
  random?: () => number;
}) {
  const embedded = launchConfig.embedded === true;
  const [engine] = useState(() => createGameEngine(launchConfig));
  const [state, setState] = useState<GameState>(() => engine.getState());
  const [practice, setPractice] = useState<PracticeState>(() => createPracticeState(embedded));
  const [eventElapsedMs, setEventElapsedMs] = useState(0);
  const elapsedRef = useRef(0);
  const practiceRef = useRef(practice);
  const resolvedHitRef = useRef(false);
  const cueFiredRef = useRef(false);
  const cueHoldRef = useRef<{ atMs: number; localMs: number } | null>(null);
  const startCueRef = useRef<(delayMs: number) => void>(() => undefined);
  const bridgeRef = useRef<ReturnType<typeof createPracticeBridge> | null>(null);

  if (embedded && launchConfig.parentOrigin && bridgeRef.current === null)
    bridgeRef.current = createPracticeBridge({
      sessionId: launchConfig.sessionId,
      parentOrigin: launchConfig.parentOrigin,
      emit: (message, origin) => window.parent.postMessage(message, origin),
      onStartCue: delayMs => startCueRef.current(delayMs),
    });

  const commitPractice = useCallback((next: PracticeState) => {
    practiceRef.current = next;
    setPractice(next);
  }, []);

  startCueRef.current = delayMs => {
    const held = cueHoldRef.current;
    if (held === null) return;
    window.setTimeout(() => {
      const current = practiceRef.current;
      commitPractice({ ...current, phaseStartedAtMs: current.phaseStartedAtMs + Math.max(0, elapsedRef.current - held.atMs) });
      cueHoldRef.current = null;
    }, Math.max(0, delayMs));
  };

  useEffect(() => {
    bridgeRef.current?.publishReady();
    const onMessage = (event: MessageEvent) => bridgeRef.current?.handleMessage(event);
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const beginTask = useCallback((task: PracticeTask) => {
    const current = practiceRef.current;
    const next = beginPracticeTask(current, task, engine.getState().player.x, random(), elapsedRef.current);
    if (next === current) return;
    engine.clearTransientFeedback(elapsedRef.current);
    resolvedHitRef.current = false;
    cueFiredRef.current = false;
    cueHoldRef.current = null;
    setEventElapsedMs(0);
    commitPractice(next);
    setState(engine.getState());
    // v2 触觉路由（Phase 5）：练习事件同样走显式 cue（CUE_REQUEST）与
    // hapticSamples 解析器，不再使用旧 0x01–0x0B 单字节派发。
  }, [commitPractice, engine, random]);

  const finishTask = useCallback(() => {
    const next = completePracticeTask(practiceRef.current, elapsedRef.current);
    engine.clearTransientFeedback(elapsedRef.current);
    resolvedHitRef.current = false;
    cueFiredRef.current = false;
    cueHoldRef.current = null;
    setEventElapsedMs(0);
    commitPractice(next);
    setState(engine.getState());
  }, [commitPractice, engine]);

  const interact = useCallback(() => {
    const current = practiceRef.current;
    if (current.phase !== "chest-active" || current.chestX === undefined) return;
    if (!isPlayerWithinChestInteraction(engine.getState().player.x, current.chestX)) return;
    finishTask();
  }, [engine, finishTask]);

  const confirmAction = useCallback((action: PracticeAction) => {
    const current = practiceRef.current;
    if (current.phase === "chest-active") {
      interact();
      return;
    }
    if (current.phase !== "idle") return;
    if (action === "complete") {
      const completing = beginPracticeCompletion(current, elapsedRef.current);
      if (completing === current) return;
      bridgeRef.current?.publishComplete();
      commitPractice(finishPracticeCompletion(completing));
      return;
    }
    beginTask(action);
  }, [beginTask, commitPractice, interact]);

  const focusAction = useCallback((action: PracticeAction) => {
    const current = practiceRef.current;
    if (current.phase === "idle") commitPractice({ ...current, focusedAction: action });
  }, [commitPractice]);

  const navigate = useCallback((delta: -1 | 1) => {
    commitPractice(movePracticeFocus(practiceRef.current, delta));
  }, [commitPractice]);

  const dispatch = useCallback((type: GameInput["type"], moveX?: number) => {
    if (type === "INTERACT") {
      confirmAction(practiceRef.current.focusedAction);
      return;
    }
    engine.dispatch({ type, atMs: elapsedRef.current, moveX });
    setState(engine.getState());
  }, [confirmAction, engine]);

  const tick = useCallback((elapsedMs: number) => {
    elapsedRef.current = elapsedMs;
    engine.tickPlayerOnly(elapsedMs);
    let current = practiceRef.current;
    const advanced = advancePractice(current, elapsedMs);
    if (advanced !== current) {
      current = advanced;
      resolvedHitRef.current = false;
      commitPractice(advanced);
    }
    const localMs = Math.max(0, elapsedMs - current.phaseStartedAtMs);
    if (cueHoldRef.current !== null) {
      setEventElapsedMs(cueHoldRef.current.localMs);
      setState(engine.getState());
      return;
    }
    setEventElapsedMs(localMs);
    if (embedded && !cueFiredRef.current && current.phase.endsWith("-active")) {
      const cue = practiceCueFor(current.phase as "projectile-active" | "area-active" | "chest-active", current);
      if (localMs >= cue.offsetMs) {
        if (cue.baseSampleId === undefined) {
          bridgeRef.current?.publishError(`练习触觉参数缺失：${cue.cueKey}`);
          return;
        }
        cueFiredRef.current = true;
        cueHoldRef.current = { atMs: elapsedMs, localMs };
        bridgeRef.current?.publishCueRequest({ cueKey: cue.cueKey, baseSampleId: cue.baseSampleId, atMs: elapsedMs });
        setState(engine.getState());
        return;
      }
    }
    if (current.phase === "projectile-active") {
      const event = createProjectileEvent(current.projectileDirection ?? "left");
      const player = engine.getState().player;
      const x = getProjectileX(event, localMs);
      if (!resolvedHitRef.current && Math.abs(x - player.x) < 3.5 && Math.abs(player.y) < 1.1) {
        engine.takeTimelineHit(elapsedMs, "projectile");
        resolvedHitRef.current = true;
      }
      if (localMs >= event.durationMs) finishTask();
    } else if (current.phase === "area-active") {
      const event = createAreaEvent(current.areaCenter ?? 50);
      const impactAtMs = Number(event.parameters.impactAtMs);
      if (!resolvedHitRef.current && localMs >= impactAtMs) {
        if (isAreaImpactHit(event, localMs, engine.getState().player.x)) engine.takeTimelineHit(elapsedMs, "area");
        resolvedHitRef.current = true;
      }
      if (localMs >= event.durationMs) finishTask();
    }
    setState(engine.getState());
  }, [commitPractice, embedded, engine, finishTask]);
  useGameLoop(true, tick);

  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (key === "arrowup" || key === "arrowdown") {
        event.preventDefault();
        if (!event.repeat) navigate(key === "arrowup" ? -1 : 1);
      } else if (["a", "arrowleft"].includes(key)) dispatch("MOVE", -1);
      else if (["d", "arrowright"].includes(key)) dispatch("MOVE", 1);
      else if (key === " ") {
        event.preventDefault();
        dispatch("JUMP");
      } else if (key === "enter" || key === "e") {
        event.preventDefault();
        confirmAction(practiceRef.current.focusedAction);
      }
    };
    const up = (event: KeyboardEvent) => {
      if (["a", "arrowleft", "d", "arrowright"].includes(event.key.toLowerCase())) dispatch("MOVE", 0);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      engine.dispatch({ type: "MOVE", atMs: elapsedRef.current, moveX: 0 });
    };
  }, [confirmAction, dispatch, engine, navigate]);

  useGamepadControls({
    active: true,
    onMove: (value) => dispatch("MOVE", value),
    onNavigate: navigate,
    onAction: (action) => action === "INTERACT" ? confirmAction(practiceRef.current.focusedAction) : dispatch(action),
  });

  const activeEvent = useMemo(() => {
    if (practice.phase === "projectile-active") return createProjectileEvent(practice.projectileDirection ?? "left");
    if (practice.phase === "area-active") return createAreaEvent(practice.areaCenter ?? 50);
    if (practice.phase === "chest-active") return createChestEvent(practice.chestX ?? 50);
    return idleEvent;
  }, [practice]);
  const waiting = practice.phase.endsWith("-wait");
  const countdown = waiting ? Math.max(1, Math.ceil((PRACTICE_PREPARE_MS - eventElapsedMs) / 1000)) : 0;
  const prompt = practice.phase === "idle"
    ? "请选择一项练习；场景中可自由移动"
    : practice.phase === "projectile-wait"
      ? `${countdown}秒后飞行物来袭`
      : practice.phase === "area-wait"
        ? `${countdown}秒后危险区域扩张`
        : practice.phase === "projectile-active"
          ? "飞行物来袭，请注意躲避"
          : practice.phase === "area-active"
            ? "危险区域扩张，请注意躲避"
            : practice.phase === "chest-active"
              ? "寻找宝箱，靠近后按 E / O 交互"
              : "练习已完成，请返回实验系统";

  return (
    <main className={`pixel-app practice-page${embedded ? " embedded-game-page" : ""}`}>
      {!embedded && (
        <header>
          <div>
            <p>R2 · OPERATION PRACTICE</p>
            <h1>月萤遗迹 <small>操作练习</small></h1>
          </div>
        </header>
      )}
      <div className="practice-stage">
        <PracticeTaskMenu
          embedded={embedded}
          phase={practice.phase}
          focusedAction={practice.focusedAction}
          activeTask={practice.activeTask}
          onFocus={focusAction}
          onConfirm={confirmAction}
        />
        <GameViewport
          state={state}
          onInteract={interact}
          activeEvent={activeEvent}
          eventElapsedMs={waiting ? 0 : eventElapsedMs}
          eventPrompt={prompt}
        />
      </div>
      {!embedded && <GameControls selectedMode={selectedMode} onModeChange={onModeChange} />}
    </main>
  );
}
