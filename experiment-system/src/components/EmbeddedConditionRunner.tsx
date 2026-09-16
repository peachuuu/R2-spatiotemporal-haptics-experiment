import { useEffect, useRef, useState } from "react";
import type { GameEventRecord, TimelineEventRecord } from "../domain/types";
import {
  createConditionUrl,
  createStartRunMessage,
  GAME_ORIGIN,
  isGameMessage,
  isValidRunCompletePayload,
  type GameLaunchPayload
} from "../integration/gameProtocol";
import type { DiagnosticDetail } from "./EmbeddedPracticeRunner";

export type ConditionRunnerStatus = "loading" | "ready" | "running" | "complete" | "error";

function isEventRecord(value: unknown, launch: GameLaunchPayload): value is GameEventRecord {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    record.sessionId === launch.sessionId &&
    record.runId === launch.runId &&
    record.conditionId === launch.conditionId &&
    typeof record.eventId === "string" &&
    typeof record.outcome === "string" &&
    typeof record.atMs === "number" &&
    typeof record.phase === "string"
  );
}

/**
 * Embeds the formal G01-G12 game for one condition. Waits for an authenticated
 * GAME_READY, sends START_RUN exactly once, streams deduplicated GAME_EVENT
 * records to the parent persistence layer, and accepts exactly one validated
 * RUN_COMPLETE. Failures and timeouts surface a retryable error plus
 * diagnostics; nothing is fabricated on failure.
 */
export function EmbeddedConditionRunner({
  launch,
  onEvent,
  onComplete,
  onCueRequest,
  onCueRecoveryRequest,
  onError,
  onRetry,
  onDiagnostic,
  pauseAfterEventToken = 0,
  readyTimeoutMs = 60000
}: {
  launch: GameLaunchPayload;
  onEvent: (record: GameEventRecord) => void;
  onComplete: (result: {
    status: "won";
    elapsedMs: number;
    realizedStageOrder?: string[];
    timelineEvents?: TimelineEventRecord[];
  }) => Promise<void>;
  /** 正式 cue 编排：返回 R2 时钟中的共同起播点或错误；错误会使运行暂停（可恢复）。 */
  onCueRequest?: (
    request: { cueKey: string; trialUid?: string; baseSampleId: string | null; conditionId: string; atMs: number }
  ) => Promise<{ cueAt: number } | { error: string }>;
  /** Verifies that the real device is safe and ARMED_IDLE before skipping a held failed cue. */
  onCueRecoveryRequest?: (
    request: { eventId: string; atMs: number }
  ) => Promise<{ ok: true } | { ok: false; reason: string }>;
  /** Called once per failure so the parent can close the current attempt. */
  onError?: (reason: string) => void;
  /** Called when the participant retries so the parent can open a new attempt. */
  onRetry?: () => void;
  onDiagnostic?: (detail: DiagnosticDetail) => void;
  /** Incremented by the parent before in-place calibration; never interrupts the active event. */
  pauseAfterEventToken?: number;
  readyTimeoutMs?: number;
}) {
  const [status, setStatus] = useState<ConditionRunnerStatus>("loading");
  const [errorReason, setErrorReason] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const startedRef = useRef(false);
  const completedRef = useRef(false);
  const pauseTokenRef = useRef(0);
  useEffect(() => {
    if (pauseAfterEventToken === 0 || pauseAfterEventToken === pauseTokenRef.current) return;
    pauseTokenRef.current = pauseAfterEventToken;
    iframeRef.current?.contentWindow?.postMessage({ source: "r2-experiment", protocolVersion: 1, sessionId: launch.sessionId, runId: launch.runId, type: "PAUSE_AFTER_EVENT" }, GAME_ORIGIN);
  }, [launch.runId, launch.sessionId, pauseAfterEventToken]);
  const failedRef = useRef(false);
  const statusRef = useRef<ConditionRunnerStatus>("loading");
  // Callbacks live in refs so inline props never re-arm the message effect.
  const eventRef = useRef(onEvent);
  eventRef.current = onEvent;
  const completeRef = useRef(onComplete);
  completeRef.current = onComplete;
  const errorRef = useRef(onError);
  errorRef.current = onError;
  const retryRef = useRef(onRetry);
  retryRef.current = onRetry;
  const diagnosticRef = useRef(onDiagnostic);
  diagnosticRef.current = onDiagnostic;
  // 硬件 iframe 可能在游戏页出现后才完成连接；cue 必须读取最新回调，
  // 不能永久捕获首帧的“未连接”状态。
  const cueRequestRef = useRef(onCueRequest);
  cueRequestRef.current = onCueRequest;
  const cueRecoveryRef = useRef(onCueRecoveryRequest);
  cueRecoveryRef.current = onCueRecoveryRequest;

  const url = createConditionUrl(launch);

  const transition = (next: ConditionRunnerStatus) => {
    statusRef.current = next;
    setStatus(next);
  };

  const fail = (reason: string) => {
    transition("error");
    setErrorReason(reason);
    if (!failedRef.current) {
      failedRef.current = true;
      errorRef.current?.(reason);
    }
  };

  const retry = () => {
    setAttempt(current => current + 1);
    retryRef.current?.();
  };

  useEffect(() => {
    transition("loading");
    setErrorReason(null);
    startedRef.current = false;
    completedRef.current = false;
    failedRef.current = false;
    const readyTimer = window.setTimeout(() => {
      if (statusRef.current === "loading") {
        fail("游戏加载超时：未收到 GAME_READY。");
        diagnosticRef.current?.({ event: "condition-ready-timeout", readyTimeoutMs, runId: launch.runId });
      }
    }, readyTimeoutMs);

    const onMessage = (event: MessageEvent) => {
      if (event.origin !== GAME_ORIGIN) {
        diagnosticRef.current?.({ event: "condition-rejected-origin", origin: event.origin, runId: launch.runId });
        return;
      }
      const iframeWindow = iframeRef.current?.contentWindow ?? null;
      if (event.source !== null && event.source !== iframeWindow) {
        diagnosticRef.current?.({ event: "condition-rejected-source", runId: launch.runId });
        return;
      }
      const message: unknown = event.data;
      if (!isGameMessage(message, launch.sessionId, launch.runId)) {
        diagnosticRef.current?.({ event: "condition-rejected-message", runId: launch.runId });
        return;
      }
      if (message.type === "GAME_READY") {
        window.clearTimeout(readyTimer);
        // A mounted game can publish READY twice in development/React
        // remount paths. Once START_RUN has been sent, a duplicate READY must
        // not regress the parent from running back to a permanent "ready"
        // state or consume the one-shot start guard.
        if (startedRef.current) return;
        transition("ready");
        startedRef.current = true;
        iframeRef.current?.contentWindow?.postMessage(createStartRunMessage(launch), GAME_ORIGIN);
        transition("running");
      } else if (message.type === "GAME_EVENT") {
        if (isEventRecord(message.payload, launch)) eventRef.current(message.payload);
        else diagnosticRef.current?.({ event: "condition-rejected-event-payload", runId: launch.runId });
      } else if (message.type === "OBJECTIVE_TRIAL") {
        const trial = message.payload as Record<string, unknown> | undefined;
        if (trial === undefined || typeof trial.trialUid !== "string" || typeof trial.trialType !== "string" || typeof trial.startedAtMs !== "number" || typeof trial.endedAtMs !== "number") {
          diagnosticRef.current?.({ event: "condition-rejected-objective-trial", runId: launch.runId });
          return;
        }
        eventRef.current({
          sessionId: launch.sessionId, runId: launch.runId, conditionId: launch.conditionId,
          projectileSequenceId: launch.projectileSequenceId, areaSequenceId: launch.areaSequenceId,
          eventId: "objective-trial", outcome: trial.success === 0 ? "failed" : "completed", atMs: trial.endedAtMs as number,
          phase: "combat", trialIndex: typeof trial.trialIndex === "number" ? trial.trialIndex : undefined,
          timelineEventId: typeof trial.timelineEventId === "string" ? trial.timelineEventId : undefined,
          visualAvailability: trial.visualAvailability === "full" ? "full" : "limited", details: {
            trial_uid: trial.trialUid, trial_type: trial.trialType as string, stage: trial.stage as string,
            started_at_ms: trial.startedAtMs as number, ended_at_ms: trial.endedAtMs as number,
            trial_valid: trial.trialValid === true ? 1 : 0,
            invalid_reason: typeof trial.invalidReason === "string" ? trial.invalidReason : "",
            success: trial.success === null ? -1 : trial.success as number,
            parameters_json: JSON.stringify(trial.parameters ?? {}), metrics_json: JSON.stringify(trial.metrics ?? {}),
          }, recordedAt: new Date().toISOString()
        });
      } else if (message.type === "RUN_ERROR") {
        const reason = (message.payload as { reason?: string } | undefined)?.reason ?? "游戏运行失败。";
        fail(reason);
        diagnosticRef.current?.({ event: "condition-run-error", reason, runId: launch.runId });
      } else if (message.type === "CUE_REQUEST") {
        const payload = message.payload as { cueKey: string; trialUid?: string; baseSampleId: string | null; conditionId: string; atMs: number } | undefined;
        if (payload === undefined || typeof payload.cueKey !== "string" || typeof payload.atMs !== "number") {
          diagnosticRef.current?.({ event: "condition-rejected-cue-request", runId: launch.runId });
          return;
        }
        void (async () => {
          const requestCue = cueRequestRef.current;
          if (requestCue === undefined) {
            diagnosticRef.current?.({ event: "condition-cue-request-unhandled", runId: launch.runId });
            return;
          }
          const outcome = await requestCue(payload);
          if ("error" in outcome) {
            iframeRef.current?.contentWindow?.postMessage(
              {
                source: "spirit-ruins",
                protocolVersion: 1,
                sessionId: launch.sessionId,
                runId: launch.runId,
                type: "CUE_FAILURE",
                payload: { reason: outcome.error }
              },
              GAME_ORIGIN
            );
            diagnosticRef.current?.({ event: "condition-cue-failed-held", reason: outcome.error, runId: launch.runId });
            return;
          }
          // 跨源 iframe 不共享绝对 performance.now 基准；在发送瞬间转成
          // 剩余相对延迟，游戏据此在自己的冻结时钟中共同起播。
          const delayMs = Math.max(0, Math.round(outcome.cueAt - performance.now()));
          iframeRef.current?.contentWindow?.postMessage(
            {
              source: "spirit-ruins",
              protocolVersion: 1,
              sessionId: launch.sessionId,
              runId: launch.runId,
              type: "START_CUE",
              payload: { delayMs }
            },
            GAME_ORIGIN
          );
        })();
      } else if (message.type === "CUE_RECOVERY_REQUEST") {
        const payload = message.payload as { eventId?: unknown; atMs?: unknown } | undefined;
        if (payload === undefined || typeof payload.eventId !== "string" || typeof payload.atMs !== "number") {
          diagnosticRef.current?.({ event: "condition-rejected-cue-recovery", runId: launch.runId });
          return;
        }
        const eventId = payload.eventId;
        const atMs = payload.atMs;
        void (async () => {
          const recover = cueRecoveryRef.current;
          const outcome = recover === undefined
            ? { ok: false as const, reason: "硬件恢复入口不可用" }
            : await recover({ eventId, atMs });
          iframeRef.current?.contentWindow?.postMessage(
            {
              source: "spirit-ruins",
              protocolVersion: 1,
              sessionId: launch.sessionId,
              runId: launch.runId,
              type: "CUE_RECOVERY_RESULT",
              payload: outcome.ok ? { ok: true } : { ok: false, reason: outcome.reason }
            },
            GAME_ORIGIN
          );
          diagnosticRef.current?.({
            event: "condition-cue-recovery",
            ok: outcome.ok,
            ...(outcome.ok ? {} : { reason: outcome.reason }),
            runId: launch.runId
          });
        })();
      } else if (message.type === "RUN_COMPLETE") {
        if (completedRef.current) return;
        const payload = message.payload as Record<string, unknown> | undefined;
        const status = typeof payload === "object" && payload !== null ? String(payload.status ?? "") : "";
        if (status !== "won") {
          // Terminal but not a win (timeout/aborted/lost): surface a
          // recoverable error instead of silently leaving the participant
          // stuck on the running state.
          const reason = status === "" ? "游戏返回了无效的结束结果。" : `游戏未完成本条件（状态：${status}），请重试。`;
          fail(reason);
          diagnosticRef.current?.({ event: "condition-run-not-won", status, runId: launch.runId });
          return;
        }
        if (!isValidRunCompletePayload(message, launch)) {
          diagnosticRef.current?.({ event: "condition-rejected-run-complete", runId: launch.runId });
          return;
        }
        completedRef.current = true;
        const won = message.payload as unknown as {
          status: "won";
          elapsedMs: number;
          realizedStageOrder?: string[];
          timelineEvents?: TimelineEventRecord[];
        };
        void completeRef.current({
          status: "won", elapsedMs: won.elapsedMs, realizedStageOrder: won.realizedStageOrder, timelineEvents: won.timelineEvents
        }).then(() => transition("complete")).catch(error => {
          completedRef.current = false;
          fail(error instanceof Error ? `保存条件数据失败：${error.message}` : "保存条件数据失败，请重试。");
        });
      }
    };
    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("message", onMessage);
      window.clearTimeout(readyTimer);
    };
  }, [launch, attempt, readyTimeoutMs]);

  return (
    <div className="embedded-runner">
      <div className={`embedded-frame-wrap embedded-frame-wrap--game ${status === "error" ? "frame-error" : ""}`}>
        <iframe
          key={attempt}
          ref={iframeRef}
          src={url}
          title="月萤遗迹 正式条件游戏"
          className="embedded-frame condition-frame"
          data-testid="condition-frame"
        />
      </div>
      <p className="embedded-status" role="status">
        {status === "loading" && "正在加载条件游戏…"}
        {status === "ready" && "游戏已就绪，正在启动…"}
        {status === "running" && "条件游戏进行中。游戏结束后将自动进入后续问卷。"}
        {status === "complete" && "条件已完成，正在保存客观数据…"}
        {status === "error" && (errorReason ?? "条件游戏加载失败。")}
      </p>
      {status === "error" && (
        <button type="button" className="button button-secondary" onClick={retry}>
          重试加载条件游戏
        </button>
      )}
    </div>
  );
}
