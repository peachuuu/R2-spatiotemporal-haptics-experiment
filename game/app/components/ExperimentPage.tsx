"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DeveloperPanel } from "./DeveloperPanel";
import { GameControls } from "./GameControls";
import type { SelectableMode } from "./GameControls";
import { GameViewport } from "./GameViewport";
import { ExperimentSceneRouter } from "./ExperimentSceneRouter";
import {
  createGameEngine,
  type GameInput,
  type GameState,
} from "../game/GameEngine";
import { createExperimentBridge } from "../game/experimentBridge";
import { connectPreviewHaptics, createHapticAdapterForConfig, disconnectPreviewHaptics, resolveCueAction, type HapticAdapter } from "../game/hapticAdapter";
import { registerHapticAdapter } from "../game/hapticRuntime";
import { dueCues, isCueInteractionReady } from "../game/hapticSamples";
import { shouldHoldCueMedia } from "../game/mediaGate";
import { parseLaunchConfig } from "../game/launchConfig";
import type { LaunchConfig } from "../game/types";
import { useGameLoop } from "../game/useGameLoop";
import { useGamepadControls } from "../game/useGamepadControls";
import { createTimelineEngine } from "../game/TimelineEngine";
import { GameRunJournal } from "../game/GameRunJournal";
import { chestCueStartMs, chestSearchMeasurement } from "../game/chestTrials";
import { PassiveTrialTracker } from "../game/objectiveTrials";
import {
  getProjectileX,
  isAreaImpactHit,
  isPlayerWithinChestInteraction,
  resolveEdgeLockAnchor,
  resolveOppositeChestX,
} from "../game/eventTimeline";

const fallback = parseLaunchConfig(
  "?mode=developer&sessionId=DEV-001&runId=DEV-001-R1&condition=STH&projectileSequence=S1&areaSequence=A1",
);
export function ExperimentPage({
  configOverride,
  selectedMode,
  onModeChange,
  autoStart = false,
  hapticAdapterOverride,
}: {
  configOverride?: LaunchConfig;
  selectedMode?: SelectableMode;
  onModeChange?: (mode: SelectableMode) => void;
  autoStart?: boolean;
  /** 测试/Phase 5 注入点：覆盖按条件派生的触觉适配器。 */
  hapticAdapterOverride?: HapticAdapter;
} = {}) {
  const [config] = useState<LaunchConfig>(
    () =>
      configOverride ??
      (typeof window === "undefined"
        ? fallback
        : parseLaunchConfig(
            window.location.search ||
              "?mode=developer&sessionId=DEV-001&runId=DEV-001-R1&condition=STH&projectileSequence=S1&areaSequence=A1",
          )),
  );
  const [engine, setEngine] = useState(() => createGameEngine(config));
  const [state, setState] = useState<GameState>(() => engine.getState());
  const [timeline, setTimeline] = useState(() =>
    createTimelineEngine({ mode: config.mode, seed: config.timelineSeed ?? config.runId }),
  );
  const [timelineState, setTimelineState] = useState(() => timeline.getState());
  const [jumpId, setJumpId] = useState("G01");
  const [running, setRunning] = useState(false);
  const [mediaGateOpen, setMediaGateOpen] = useState(true);
  const [emergencyConfirm, setEmergencyConfirm] = useState(false);
  const [cueRecoveryPending, setCueRecoveryPending] = useState(false);
  /** 触觉门控失败时的可恢复错误（正式 STH/BH 由 Phase 5 适配器触发）。 */
  const [gateError, setGateError] = useState<string | null>(null);
  const [hapticConnectionMessage, setHapticConnectionMessage] = useState<string | null>(null);
  const hapticAdapter = useMemo(
    () => hapticAdapterOverride ?? createHapticAdapterForConfig(config),
    [config, hapticAdapterOverride]
  );
  useEffect(() => {
    registerHapticAdapter(hapticAdapter);
    return () => registerHapticAdapter(null);
  }, [hapticAdapter]);
  /**
   * Embedded experiment runs wait 3 seconds after the G12 fireworks finish
   * before reporting completion, with a bottom countdown prompt.
   */
  const [exitCountdown, setExitCountdown] = useState<number | null>(null);
  /** cue 时钟：held=true 时冻结在 cue 边界，START_CUE(delayMs) 到期后从该边界继续。 */
  const clockRef = useRef({ start: 0, shift: 0, held: false, holdAtMs: 0 });
  const cueReleaseTimerRef = useRef<number | null>(null);
  const firedCuesRef = useRef(new Set<string>());
  const hapticGatedMode =
    (config.conditionId === "BH" || config.conditionId === "STH") &&
    config.hapticGate !== false;
  const embeddedFormalMode = config.mode === "experiment" && hapticGatedMode;
  const bridgeRef = useRef<ReturnType<typeof createExperimentBridge> | null>(
    null,
  );
  const completeEmergencySkipRef = useRef<() => void>(() => undefined);
  const journal = useMemo(() => new GameRunJournal(config.sessionId, config.runId), [config.runId, config.sessionId]);
  const deliveryQueueRef = useRef(Promise.resolve());
  const emittedCount = useRef(0);
  const emittedTimelineCount = useRef(0);
  const resultPublished = useRef(false);
  const elapsedRef = useRef(0);
  const hitEventsRef = useRef(new Set<string>());
  const cinematicHitsRef = useRef(new Set<string>());
  const areaCentersRef = useRef(new Map<string, number>());
  const chestPositionsRef = useRef(new Map<string, number>());
  const chestStartPlayerXRef = useRef(new Map<string, number>());
  const lastEventIdRef = useRef("");
  const trialTrackerRef = useRef(new PassiveTrialTracker(config.runId));
  const deliverEvent = useCallback((event: import("../game/types").GameEventRecord) => {
    deliveryQueueRef.current = deliveryQueueRef.current.then(async () => {
      await journal.append(event);
      const bridge = bridgeRef.current;
      if (!bridge) return;
      bridge.publishEvent(event);
      const id = `${event.sessionId}:${event.runId}:${event.eventId}:${event.atMs}:${event.trialIndex ?? ""}:${event.outcome}`;
      await journal.markDelivered(id);
    }).catch(() => undefined);
  }, [journal]);
  const publish = useCallback(() => {
    const bridge = bridgeRef.current;
    if (!bridge) return;
    const telemetry = engine.getTelemetry();
    const current = timeline.getState().current;
    for (const event of telemetry.events.slice(emittedCount.current))
      deliverEvent({
        ...event,
        recordedAt: event.recordedAt ?? new Date().toISOString(),
        timelineEventId: event.timelineEventId ?? current.id,
        visualAvailability: event.visualAvailability ?? current.visibility,
        playerX: event.playerX ?? engine.getState().player.x,
        playerY: event.playerY ?? engine.getState().player.y,
      });
    emittedCount.current = telemetry.events.length;
    for (const record of timeline.getRecords().slice(emittedTimelineCount.current))
      deliverEvent({
        sessionId: config.sessionId,
        runId: config.runId,
        conditionId: config.conditionId,
        projectileSequenceId: config.projectileSequenceId,
        areaSequenceId: config.areaSequenceId,
        eventId: record.outcome === "started" ? "timeline-event-started" : record.outcome === "skipped" ? "timeline-event-skipped" : "timeline-event-completed",
        outcome: record.outcome,
        atMs: record.atMs,
        phase: engine.getState().phase,
        timelineEventId: record.timelineEventId,
        visualAvailability: timeline.getState().events[record.timelineOrder]?.visibility,
        playerX: engine.getState().player.x,
        playerY: engine.getState().player.y,
        recordedAt: new Date().toISOString(),
      });
    for (const record of timeline.getRecords().slice(emittedTimelineCount.current)) {
      if (record.outcome !== "completed") continue;
      const trial = timeline.getState().events[record.timelineOrder];
      if (!trial || !["projectile", "area", "chest-discovery"].includes(trial.kind)) continue;
      const startedAtMs = timeline.getRecords().find(item => item.timelineEventId === trial.id && item.outcome === "started")?.atMs ?? record.atMs;
      const telemetryEvents = engine.getTelemetry().events;
      const firstJump = telemetryEvents.find(item => item.eventId === "player-jump" && item.atMs >= startedAtMs && item.atMs <= record.atMs);
      const hit = telemetryEvents.some(item => item.eventId === "player-hit" && item.atMs >= startedAtMs && item.atMs <= record.atMs &&
        ((trial.kind === "area" && item.sourceEventId === "area-rune") || (trial.kind === "projectile" && item.sourceEventId?.startsWith("projectile"))));
      const chest = telemetryEvents.find(item => item.eventId === "chest-found" && item.timelineEventId === trial.id);
      const payload = trialTrackerRef.current.finish(trial.id, record.atMs, { hit, chestFoundAtMs: chest?.atMs });
      if (payload) bridgeRef.current?.publishObjectiveTrial(payload);
    }
    emittedTimelineCount.current = timeline.getRecords().length;
    const result = engine.getResult();
    if (result && !resultPublished.current) {
      bridge.publishResult(result);
      resultPublished.current = true;
    }
  }, [config, deliverEvent, engine, timeline]);
  const tick = useCallback(
    (now: number) => {
      const clock = clockRef.current;
      const elapsedMs = clock.held
        ? clock.holdAtMs
        : Math.max(0, Math.round(now - clock.start + clock.shift));
      elapsedRef.current = elapsedMs;
      const before = timeline.getState();
      // Runtime spatial parameters must be locked before checking a t=0 cue.
      // Inserted chest trials request haptics immediately, so resolving the
      // opposite side afterwards would produce an undefined sample ID.
      const playerAtEventStart = engine.getState().player.x;
      const center =
        before.current.kind === "area"
          ? (areaCentersRef.current.get(before.current.id) ??
            resolveEdgeLockAnchor(playerAtEventStart))
          : undefined;
      if (
        before.current.kind === "area" &&
        !areaCentersRef.current.has(before.current.id)
      )
        areaCentersRef.current.set(before.current.id, center!);
      const chestX =
        before.current.kind === "chest-discovery"
          ? (chestPositionsRef.current.get(before.current.id) ??
            resolveOppositeChestX(playerAtEventStart))
          : undefined;
      if (
        before.current.kind === "chest-discovery" &&
        !chestPositionsRef.current.has(before.current.id)
      ) {
        chestPositionsRef.current.set(before.current.id, chestX!);
        chestStartPlayerXRef.current.set(before.current.id, playerAtEventStart);
      }
      if (lastEventIdRef.current !== before.current.id) {
        engine.clearTransientFeedback(elapsedMs);
        lastEventIdRef.current = before.current.id;
        trialTrackerRef.current.start(before.current, before.eventStartedAtMs, playerAtEventStart, center, chestX);
      }
      // v2 触觉 cue 门控（Phase 5）：按事件内偏移逐 cue 到期触发。
      // - NONE/开发：适配器 prepare（skipped/prepared）并记录遥测；
      // - 正式 STH/BH：发送 CUE_REQUEST 并冻结在 cue 边界，直到 R2 下发
      //   START_CUE(delayMs)；样本参数无法解析时失败关闭（暂停）。
      if (!clock.held) {
        const areaCenter =
          before.current.kind === "area"
            ? areaCentersRef.current.get(before.current.id)
            : undefined;
        const chestX =
          before.current.kind === "chest-discovery"
            ? chestPositionsRef.current.get(before.current.id)
            : undefined;
        const eventWithin = elapsedMs - before.eventStartedAtMs;
        const due = isCueInteractionReady(before.current.id, before.interactionActive)
          ? dueCues(before.current, eventWithin, areaCenter, chestX, firedCuesRef.current)
          : [];
        for (const cue of due) {
          firedCuesRef.current.add(cue.cueKey);
          if (hapticGatedMode) {
            if (cue.baseSampleId === undefined) {
              // 失败关闭：绝不默认猜测侧别/锚点
              setGateError(`触觉参数缺失：${cue.cueKey} 无法解析样本 ID。`);
              setRunning(false);
              clock.held = true;
              clock.holdAtMs = elapsedMs;
              setState(engine.getState());
              return;
            }
            clock.held = true;
            clock.holdAtMs = elapsedMs;
            if (embeddedFormalMode) {
              bridgeRef.current?.publishCueRequest({
                cueKey: cue.cueKey,
                trialUid: trialTrackerRef.current.trialUid(before.current.id),
                baseSampleId: cue.baseSampleId,
                conditionId: config.conditionId,
                atMs: elapsedMs
              });
              setState(engine.getState());
              return; // 冻结直到 R2 START_CUE
            }
            // 单游戏预览：与正式条件相同的 PREPARE → COMMIT → 共同起播，
            // 但直接走浏览器已 ARM 的真实串口主机。
            void (async () => {
              const input = { cue: cue.cue, baseSampleId: cue.baseSampleId };
              const prepared = await hapticAdapter.prepareCue(input);
              if (resolveCueAction(prepared) === "pause") {
                const reason = "reason" in prepared ? prepared.reason : "unknown";
                setGateError(`触觉准备失败：${reason}`);
                setRunning(false);
                return;
              }
              const committed = await hapticAdapter.commitCue(input);
              if (committed.status !== "committed") {
                setGateError(`触觉起播失败：${committed.reason}`);
                setRunning(false);
                return;
              }
              const startAt = performance.now();
              setMediaGateOpen(true);
              clock.shift = clock.holdAtMs - startAt;
              clock.held = false;
              engine.getTelemetry().record({
                eventId: "haptic-cue-prepared",
                outcome: "prepared",
                atMs: elapsedMs,
                phase: engine.getState().phase,
                hapticMode: config.conditionId === "STH" ? "sth" : "bh",
                hapticOutcome: "prepared",
                hapticBaseSampleId: cue.baseSampleId,
                hapticResolvedSampleId: prepared.resolvedSampleId,
                hapticCueKey: cue.cueKey
              });
              setState(engine.getState());
            })();
            setState(engine.getState());
            return;
          }
          void hapticAdapter.prepareCue({ cue: cue.cue, baseSampleId: cue.baseSampleId }).then(result => {
            const telemetry = engine.getTelemetry();
            if (result.status === "prepared") {
              const skipped = result.outcome === "skipped";
              telemetry.record({
                eventId: skipped ? "haptic-cue-skipped" : "haptic-cue-prepared",
                outcome: result.outcome,
                atMs: elapsedMs,
                phase: engine.getState().phase,
                hapticMode: result.mode,
                hapticDisabled: skipped,
                hapticOutcome: result.outcome,
                hapticBaseSampleId: cue.baseSampleId,
                hapticResolvedSampleId: result.resolvedSampleId,
                hapticCueKey: cue.cueKey
              });
            } else {
              telemetry.record({
                eventId: "haptic-cue-unavailable",
                outcome: "unavailable",
                atMs: elapsedMs,
                phase: engine.getState().phase,
                hapticOutcome: "unavailable",
                hapticBaseSampleId: cue.baseSampleId,
                hapticCueKey: cue.cueKey
              });
            }
            if (resolveCueAction(result) === "pause") {
              const reason = "reason" in result ? result.reason : "unknown";
              setGateError(`触觉准备失败：${reason}`);
              setRunning(false);
            }
          });
        }
      }
      const runtimeCurrent =
        before.current.kind === "area"
          ? {
              ...before.current,
              parameters: {
                ...before.current.parameters,
                center: center!,
                anchorMode: "edge-lock",
              },
            }
          : before.current.kind === "chest-discovery"
            ? {
                ...before.current,
                parameters: { ...before.current.parameters, chestX: chestX! },
              }
            : before.current;
      if (runtimeCurrent.scene === "side-scroll") {
        engine.tickPlayerOnly(elapsedMs);
        const player = engine.getState().player;
        const eventMs = elapsedMs - before.eventStartedAtMs;
        if (runtimeCurrent.kind === "area") trialTrackerRef.current.sampleArea(runtimeCurrent.id, elapsedMs, player.x);
        if (
          runtimeCurrent.id === "G03" &&
          eventMs >= Number(runtimeCurrent.parameters.castEndMs) &&
          !cinematicHitsRef.current.has("G03-fire")
        ) {
          engine.takeCinematicFireHit(elapsedMs);
          cinematicHitsRef.current.add("G03-fire");
        }
        if (
          runtimeCurrent.kind === "projectile" &&
          !hitEventsRef.current.has(runtimeCurrent.id)
        ) {
          const x = getProjectileX(runtimeCurrent, eventMs);
          if (Math.abs(x - player.x) < 3.5 && Math.abs(player.y) < 1.1) {
            engine.takeTimelineHit(elapsedMs, "projectile");
            hitEventsRef.current.add(runtimeCurrent.id);
          }
        }
        if (
          runtimeCurrent.kind === "area" &&
          eventMs >=
            Number(
              runtimeCurrent.parameters.impactAtMs ?? runtimeCurrent.durationMs,
            ) &&
          !hitEventsRef.current.has(runtimeCurrent.id)
        ) {
          if (isAreaImpactHit(runtimeCurrent, eventMs, player.x))
            engine.takeTimelineHit(elapsedMs, "area");
          hitEventsRef.current.add(runtimeCurrent.id);
        }
      }
      timeline.tick(elapsedMs);
      if (timeline.getState().awaitingContinue && !engine.getState().paused) {
        engine.dispatch({ type: "PAUSE", atMs: elapsedMs, method: "keyboard" });
      }
      publish();
      setState(engine.getState());
      setTimelineState(timeline.getState());
    },
    [engine, publish, timeline, hapticAdapter, hapticGatedMode, embeddedFormalMode, config.conditionId],
  );
  useGameLoop(running, tick);
  const dispatch = useCallback(
    (type: GameInput["type"], moveX?: number, method: "keyboard" | "gamepad" = "keyboard") => {
      engine.dispatch({ type, atMs: elapsedRef.current, moveX, method });
      if (type === "JUMP") trialTrackerRef.current.observeJump(elapsedRef.current);
      publish();
      setState(engine.getState());
    },
    [engine, publish],
  );
  const interactTimeline = useCallback(() => {
    const timelineNow = timeline.getState();
    const event = timelineNow.current;
    const current = event.id;
    const eventMs = elapsedRef.current - timelineNow.eventStartedAtMs;
    const chestX =
      chestPositionsRef.current.get(current) ??
      resolveOppositeChestX(state.player.x);
    const isChest = event.kind === "chest-discovery";
    const canOpen =
      current === "G01" ||
      (isChest &&
        !timelineNow.interactionCompleted &&
        eventMs >= chestCueStartMs(event) &&
        isPlayerWithinChestInteraction(state.player.x, chestX));
    if (canOpen) {
      if (isChest) {
        const measurement = chestSearchMeasurement({
          event,
          eventStartedAtMs: timelineNow.eventStartedAtMs,
          foundAtMs: elapsedRef.current,
          chestX,
          playerStartX:
            chestStartPlayerXRef.current.get(current) ?? state.player.x,
        });
        engine.getTelemetry().record({
          eventId: "chest-found",
          outcome: "found",
          atMs: elapsedRef.current,
          phase: engine.getState().phase,
          timelineEventId: current,
          visualAvailability: event.visibility,
          playerX: state.player.x,
          playerY: state.player.y,
          action: "chest-found",
          ...measurement,
          recordedAt: new Date().toISOString(),
        });
      }
      timeline.completeInteraction(elapsedRef.current);
      publish();
      setTimelineState(timeline.getState());
    }
  }, [engine, publish, state.player.x, state.player.y, timeline]);
  const start = useCallback(() => {
    const next = createGameEngine(config);
    const nextTimeline = createTimelineEngine({
      mode: config.mode,
      seed: config.timelineSeed ?? config.runId,
    });
    elapsedRef.current = 0;
    hitEventsRef.current.clear();
    cinematicHitsRef.current.clear();
    areaCentersRef.current.clear();
    chestPositionsRef.current.clear();
    chestStartPlayerXRef.current.clear();
    lastEventIdRef.current = "";
    trialTrackerRef.current = new PassiveTrialTracker(config.runId);
    nextTimeline.start(0);
    emittedCount.current = 0;
    emittedTimelineCount.current = 0;
    resultPublished.current = false;
    setExitCountdown(null);
    setGateError(null);
    setMediaGateOpen(!hapticGatedMode);
    if (cueReleaseTimerRef.current !== null) {
      window.clearTimeout(cueReleaseTimerRef.current);
      cueReleaseTimerRef.current = null;
    }
    clockRef.current = { start: performance.now(), shift: 0, held: false, holdAtMs: 0 };
    firedCuesRef.current.clear();
    setEngine(next);
    setTimeline(nextTimeline);
    setState(next.getState());
    setTimelineState(nextTimeline.getState());
    setRunning(true);
  }, [config, hapticGatedMode]);
  useEffect(() => {
    if (autoStart) start();
  }, [autoStart, start]);
  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (["a", "arrowleft"].includes(key)) dispatch("MOVE", -1);
      else if (["d", "arrowright"].includes(key)) dispatch("MOVE", 1);
      else if (key === " ") {
        event.preventDefault();
        dispatch("JUMP");
      } else if (key === "j") dispatch("ATTACK");
      else if (key === "e") interactTimeline();
      else if (key === "escape" && config.mode !== "experiment")
        dispatch(state.paused ? "RESUME" : "PAUSE");
    };
    const up = (event: KeyboardEvent) => {
      if (
        ["a", "arrowleft", "d", "arrowright"].includes(event.key.toLowerCase())
      )
        dispatch("MOVE", 0);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [config.mode, dispatch, interactTimeline, state.paused]);
  useGamepadControls({
    active: running && (!state.terminal || config.mode === "developer"),
    onMove: (value) => dispatch("MOVE", value, "gamepad"),
    onAction: (action) =>
      action === "INTERACT" ? interactTimeline() : dispatch(action, undefined, "gamepad"),
  });
  useEffect(() => {
    if (config.mode !== "experiment" || !config.parentOrigin) return;
    const bridge = createExperimentBridge({
      parentOrigin: config.parentOrigin,
      sessionId: config.sessionId,
      runId: config.runId,
      onStart: start,
      onStartCue: (delayMs: number) => {
        // 绝不能把父页面的绝对 performance.now 写入 iframe 时间线：
        // 跨源文档的 time origin 可能不同，会让事件瞬间跳过整个样本。
        const clock = clockRef.current;
        if (!clock.held) return; // 忽略迟到/重复 START_CUE，禁止二次跳时。
        if (cueReleaseTimerRef.current !== null) window.clearTimeout(cueReleaseTimerRef.current);
        cueReleaseTimerRef.current = window.setTimeout(() => {
          const currentClock = clockRef.current;
          if (!currentClock.held) return;
          setMediaGateOpen(true);
          currentClock.shift = currentClock.holdAtMs - performance.now();
          currentClock.held = false;
          cueReleaseTimerRef.current = null;
          engine.getTelemetry().record({
            eventId: "haptic-cue-prepared",
            outcome: "prepared",
            atMs: currentClock.holdAtMs,
            phase: engine.getState().phase,
            hapticMode: config.conditionId === "STH" ? "sth" : "bh",
            hapticOutcome: "prepared"
          });
          setState(engine.getState());
        }, Math.max(0, Math.round(delayMs)));
      },
      onCueFailure: (reason: string) => {
        setCueRecoveryPending(false);
        setGateError(`触觉 cue 失败：${reason}`);
      },
      onCueRecoveryResult: result => {
        setCueRecoveryPending(false);
        if (!result.ok) {
          setGateError(`硬件尚未就绪，未跳过事件：${result.reason ?? "未知原因"}`);
          return;
        }
        completeEmergencySkipRef.current();
      },
      onPauseAfterEvent: () => requestEventBoundaryPause(),
      emit: (message, origin) => window.parent.postMessage(message, origin),
    });
    bridgeRef.current = bridge;
    bridge.attach();
    bridge.publishReady();
    void journal.listUndelivered().then(entries => {
      for (const entry of entries) {
        bridge.publishEvent(entry.record);
        void journal.markDelivered(entry.id);
      }
    });
    return () => {
      if (cueReleaseTimerRef.current !== null) {
        window.clearTimeout(cueReleaseTimerRef.current);
        cueReleaseTimerRef.current = null;
      }
      bridge.detach();
      bridgeRef.current = null;
    };
  }, [config, engine, journal, start]);
  useEffect(() => {
    if (!timelineState.completed || engine.getResult()) return;
    // Embedded experiment runs let the G12 fireworks finish first, then show
    // a 3-second countdown before reporting RUN_COMPLETE to the R2 parent.
    if (config.mode === "experiment") {
      if (exitCountdown === null) {
        setExitCountdown(3);
        return;
      }
      if (exitCountdown > 0) {
        const timer = window.setTimeout(() => setExitCountdown(exitCountdown - 1), 1000);
        return () => window.clearTimeout(timer);
      }
    }
    engine.setTimelineMetadata({
      seed: timelineState.seed,
      order: timelineState.events.map((event) => event.id),
      records: timeline.getRecords(),
    });
    engine.completeTimeline(elapsedRef.current);
    publish();
    setState(engine.getState());
  }, [
    engine,
    publish,
    timeline,
    timelineState.completed,
    timelineState.events,
    timelineState.seed,
    config.mode,
    exitCountdown,
  ]);
  const eventElapsedMs = Math.max(
    0,
    elapsedRef.current - timelineState.eventStartedAtMs,
  );
  /** Bottom prompt during the post-fireworks exit countdown ("3s后进入后续问卷"). */
  const exitCountdownPrompt =
    config.mode === "experiment" &&
    timelineState.completed &&
    exitCountdown !== null &&
    exitCountdown > 0
      ? `${exitCountdown}s后进入后续问卷`
      : undefined;
  const runtimeCenter =
    timelineState.current.kind === "area"
      ? (areaCentersRef.current.get(timelineState.current.id) ??
        resolveEdgeLockAnchor(state.player.x))
      : undefined;
  const runtimeChestX =
    timelineState.current.kind === "chest-discovery"
      ? (chestPositionsRef.current.get(timelineState.current.id) ??
        resolveOppositeChestX(state.player.x))
      : undefined;
  const runtimeEvent =
    timelineState.current.kind === "area"
      ? {
          ...timelineState.current,
          parameters: {
            ...timelineState.current.parameters,
            center: runtimeCenter!,
            anchorMode: "edge-lock",
          },
        }
      : timelineState.current.kind === "chest-discovery"
        ? {
            ...timelineState.current,
            parameters: {
              ...timelineState.current.parameters,
              chestX: runtimeChestX!,
            },
          }
        : timelineState.current;
  const resumeDeveloperPreview = () => {
    engine.resumeTimelinePreview(elapsedRef.current);
    engine.clearTransientFeedback(elapsedRef.current);
    lastEventIdRef.current = "";
    setState(engine.getState());
  };
  const completeEmergencySkip = () => {
    const skippedEventId = timeline.emergencySkip(elapsedRef.current);
    if (!skippedEventId) return;
    const clock = clockRef.current;
    if (clock.held) {
      clock.shift = clock.holdAtMs - performance.now();
      clock.held = false;
      setMediaGateOpen(true);
    }
    setGateError(null);
    setCueRecoveryPending(false);
    engine.getTelemetry().record({
      eventId: "timeline-event-skipped",
      outcome: "operator-emergency-skip",
      atMs: elapsedRef.current,
      phase: engine.getState().phase,
      timelineEventId: skippedEventId,
      visualAvailability: timelineState.current.visibility,
      playerX: state.player.x,
      playerY: state.player.y,
      action: "operator-emergency-skip",
      recordedAt: new Date().toISOString(),
    });
    publish();
    setTimelineState(timeline.getState());
    setState(engine.getState());
    setEmergencyConfirm(false);
  };
  completeEmergencySkipRef.current = completeEmergencySkip;
  const confirmEmergencySkip = () => {
    if (embeddedFormalMode && clockRef.current.held) {
      const bridge = bridgeRef.current;
      if (bridge === null) {
        setGateError("硬件恢复入口不可用；请重新加载条件游戏。");
        return;
      }
      setCueRecoveryPending(true);
      setEmergencyConfirm(false);
      bridge.publishCueRecoveryRequest({ eventId: timelineState.current.id, atMs: elapsedRef.current });
      return;
    }
    void hapticAdapter.emergencyStop("operator-emergency-skip");
    completeEmergencySkip();
  };
  const requestEventBoundaryPause = () => {
    if (!timeline.requestPause()) return;
    setTimelineState(timeline.getState());
  };
  const continueAfterPause = () => {
    if (!timeline.continueAfterPause(elapsedRef.current)) return;
    engine.dispatch({ type: "RESUME", atMs: elapsedRef.current, method: "keyboard" });
    setTimelineState(timeline.getState());
    setState(engine.getState());
    publish();
  };
  return (
    <main className={`pixel-app${config.mode === "experiment" ? " embedded-game-page" : ""}`}>
      {config.mode !== "experiment" && (
        <header>
          <div>
            <p>R2 · EXPERIMENTAL GAME</p>
            <h1>
              月萤遗迹 <small>Spirit Ruins</small>
            </h1>
          </div>
        </header>
      )}
      {running ? (
        <ExperimentSceneRouter
          event={runtimeEvent}
          gameState={state}
          onInteract={interactTimeline}
          interactionActive={timelineState.interactionActive}
          interactionCompleted={timelineState.interactionCompleted}
          eventElapsedMs={eventElapsedMs}
          hapticGateHeld={shouldHoldCueMedia({
            hapticGatedMode,
            eventId: timelineState.current.id,
            mediaGateOpen,
            cueHeld: clockRef.current.held,
          })}
          showEndOverlay={config.mode !== "experiment"}
          promptOverride={exitCountdownPrompt}
        />
      ) : (
        <GameViewport
          state={state}
          onInteract={interactTimeline}
          showEndOverlay={config.mode !== "experiment"}
        />
      )}
      <GameControls
        selectedMode={selectedMode}
        onModeChange={onModeChange}
        onConnectHaptics={() => void connectPreviewHaptics().then(setHapticConnectionMessage).catch(error => setHapticConnectionMessage(error instanceof Error ? error.message : String(error)))}
        onDisconnectHaptics={() => void disconnectPreviewHaptics().then(() => setHapticConnectionMessage("已停止并断开触觉设备。")).catch(error => setHapticConnectionMessage(error instanceof Error ? error.message : String(error)))}
        hapticConnectionMessage={hapticConnectionMessage}
      />
      {running && !timelineState.completed && (
        <section className="emergency-event-skip" aria-label="游戏暂停控制">
          {timelineState.awaitingContinue ? (
            <button onClick={continueAfterPause}>继续下一事件</button>
          ) : (
            <button disabled={timelineState.pauseRequested} onClick={requestEventBoundaryPause}>
              {timelineState.pauseRequested ? "将在当前事件结束后暂停" : "事件结束后暂停"}
            </button>
          )}
        </section>
      )}
      {running && !timelineState.completed && (
        <section className="emergency-event-skip">
          {emergencyConfirm ? (
            <>
              <span>{embeddedFormalMode && clockRef.current.held ? "确认重新同步硬件并跳过当前失败 cue？" : `确认跳过当前事件 ${timelineState.current.id}？`} 该操作会写入实验日志。</span>
              <button disabled={cueRecoveryPending} onClick={confirmEmergencySkip}>{cueRecoveryPending ? "正在同步硬件…" : "确认跳过"}</button>
              <button disabled={cueRecoveryPending} onClick={() => setEmergencyConfirm(false)}>取消</button>
            </>
          ) : (
            <button onClick={() => setEmergencyConfirm(true)}>跳过当前事件</button>
          )}
        </section>
      )}
      {config.mode === "developer" && (
        <DeveloperPanel
          config={config}
          result={state.terminal}
          onStart={start}
          onAbort={() => dispatch("ABORT")}
        />
      )}
      {config.mode === "developer" && running && (
        <section className="timeline-dev">
          <b>当前事件：{timelineState.current.id}</b>
          <span>
            触觉样本：{config.conditionId}:{runtimeEvent.hapticSampleKey}
          </span>
          <button
            onClick={() => {
              resumeDeveloperPreview();
              timeline.previous(elapsedRef.current);
              setTimelineState(timeline.getState());
            }}
          >
            上一事件
          </button>
          <button
            onClick={() => {
              resumeDeveloperPreview();
              timeline.skip(elapsedRef.current);
              setTimelineState(timeline.getState());
            }}
          >
            下一事件
          </button>
          <input
            value={jumpId}
            onChange={(event) => setJumpId(event.target.value.toUpperCase())}
            aria-label="事件编号"
            placeholder="G07-P01"
          />
          <button
            onClick={() => {
              resumeDeveloperPreview();
              timeline.jumpTo(jumpId, elapsedRef.current);
              setTimelineState(timeline.getState());
            }}
          >
            跳转
          </button>
        </section>
      )}
      {config.mode !== "experiment" && timelineState.completed && (
        <div className="run-complete">G12 已完成，本轮游戏结束</div>
      )}
      {gateError !== null && (
        <section className="haptic-gate-error" role="alert">
          <b>{gateError}</b>
          <p>正式条件在触觉未就绪时暂停，不会静默继续。请检查硬件/样本后重试。</p>
          <button type="button" className="start" onClick={start}>
            重试
          </button>
        </section>
      )}
      {config.mode !== "experiment" && (
        <section className="actions">
          <button className="start" onClick={start}>
            {running ? "重新开始" : "开始游戏"}
          </button>
          <p>开发模式：事件固定顺序；正式实验模式随机化两个战斗阶段。</p>
        </section>
      )}
    </main>
  );
}
