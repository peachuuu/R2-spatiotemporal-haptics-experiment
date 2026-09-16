import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CalibrationDialog } from "../components/CalibrationDialog";
import { useStudy } from "../app/StudyContext";
import { EmbeddedConditionRunner } from "../components/EmbeddedConditionRunner";
import { conditionAt, getDisplayCondition } from "../domain/session";
import { useHardwareHostClient } from "../integration/HardwareHostFrame";
import { orchestrateCue, resolveSampleForSession } from "../integration/cueOrchestrator";
import { createConditionLaunch } from "../integration/gameProtocol";

/**
 * 正式条件运行：嵌入真实 G01-G12 游戏。父页面下发唯一一次 START_RUN，
 * 逐事件持久化客观数据；只有经过校验的 RUN_COMPLETE 才推进问卷。
 * 参与者只看到条件 A/B 标签，内部映射（BH/STH）绝不显示。
 */
export function ConditionScreen({ conditionIndex }: { conditionIndex: 0 | 1 }) {
  const { session, advance, startConditionAttempt, recordGameEvent, logHapticCue, completeCondition, interruptCondition, logAdapter } = useStudy();
  const hostClient = useHardwareHostClient();
  const [showCalibration, setShowCalibration] = useState(false);
  const [pauseAfterEventToken, setPauseAfterEventToken] = useState(0);

  const conditionId = session === null ? null : conditionAt(session, conditionIndex);
  const displayCondition = session === null ? null : getDisplayCondition(session, conditionId!);
  const stepId = conditionIndex === 0 ? "condition-1" : "condition-2";
  // Launch identity must stay stable across session updates (e.g. the
  // interrupt commit after a failed run); its inputs never change during a
  // session: id, the immutable gameAssignment/conditionOrder references, and
  // the condition index. Recomputing it would re-arm the runner effect and
  // reset its ready/error/completed state.
  const launch = useMemo(
    () => (session === null ? null : createConditionLaunch(session, conditionIndex, location.origin)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [session?.id, session?.gameAssignment, session?.conditionOrder, conditionIndex]
  );

  // Recover stale attempts once per mount: a running attempt left over from a
  // refresh or interruption is closed as interrupted, then a new attempt starts.
  // The ref guard also absorbs React StrictMode's dev double-mount so a single
  // visit creates exactly one attempt.
  const mountedRef = useRef(false);
  useEffect(() => {
    if (mountedRef.current) return;
    mountedRef.current = true;
    if (session === null || conditionId === null || launch === null) return;
    void startConditionAttempt(conditionId, launch);
    void logAdapter("game", "start-condition-attempt", {
      conditionId,
      runId: launch.runId,
      timelineSeed: launch.timelineSeed
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleEvent = useCallback(
    (record: Parameters<typeof recordGameEvent>[1]) => {
      if (conditionId === null) return;
      void recordGameEvent(conditionId, record);
    },
    [conditionId, recordGameEvent]
  );

  const handleComplete = useCallback(
    async (result: Parameters<typeof completeCondition>[1]) => {
      if (conditionId === null) throw new Error("条件不可用");
      await completeCondition(conditionId, result);
      await logAdapter("game", "condition-completed", { conditionId, runId: launch?.runId ?? "" });
      await advance(stepId);
    },
    [advance, completeCondition, conditionId, launch, logAdapter, stepId]
  );

  const handleInterrupt = useCallback(
    (reason: string) => {
      if (conditionId === null) return;
      void interruptCondition(conditionId, reason);
      void logAdapter("game", "condition-interrupted", { conditionId, reason });
    },
    [conditionId, interruptCondition, logAdapter]
  );

  const handleRetry = useCallback(() => {
    if (conditionId === null || launch === null) return;
    void (async () => {
      await interruptCondition(conditionId, "participant retried after load failure");
      await startConditionAttempt(conditionId, launch);
      await logAdapter("game", "condition-retry", { conditionId, runId: launch.runId });
    })();
  }, [conditionId, interruptCondition, launch, logAdapter, startConditionAttempt]);

  /** 正式 cue 编排：PREPARE → PREPARED → 共同起播点；失败返回错误并暂停。 */
  const handleCueRequest = useCallback(
    async (request: { cueKey: string; trialUid?: string; baseSampleId: string | null; conditionId: string; atMs: number }) => {
      if (session === null || conditionId === null) return { error: "会话或条件不可用" };
      if (hostClient === null) {
        return { error: "硬件连接未建立：正式 STH/BH 试次必须连接硬件" };
      }
      const resolved = request.baseSampleId !== null ? resolveSampleForSession(session, conditionIndex, request.baseSampleId) : null;
      const startedLog = (result: { deviceStartUs: number } | { error: string }) => {
        if (conditionId === null) return;
        if ("error" in result) {
          void logHapticCue(conditionId, {
            cueKey: request.cueKey, trialUid: request.trialUid,
            baseSampleId: request.baseSampleId,
            resolvedSampleId: resolved,
            requestedAtMs: request.atMs,
            outcome: "device-error",
            errorDetail: result.error,
            at: new Date().toISOString()
          });
        } else {
          void logHapticCue(conditionId, {
            cueKey: request.cueKey, trialUid: request.trialUid,
            baseSampleId: request.baseSampleId,
            resolvedSampleId: resolved,
            requestedAtMs: request.atMs,
            deviceStartedAtMs: performance.now(),
            deviceStartUs: result.deviceStartUs,
            outcome: "ok",
            at: new Date().toISOString()
          });
        }
      };
      const outcome = await orchestrateCue(hostClient, { request, session, conditionIndex, now: request.atMs }, startedLog);
      if (!outcome.ok) {
        void logHapticCue(conditionId, {
          cueKey: request.cueKey, trialUid: request.trialUid,
          baseSampleId: request.baseSampleId,
          resolvedSampleId: resolved,
          requestedAtMs: request.atMs,
          outcome: outcome.stage === "prepare" ? "prepare-error" : "prepare-error",
          errorDetail: outcome.message,
          at: new Date().toISOString()
        });
        return { error: outcome.message };
      }
      // 记录媒体预定时刻（cueAt 即游戏媒体起播点）
      void logHapticCue(conditionId, {
        cueKey: request.cueKey, trialUid: request.trialUid,
        baseSampleId: outcome.baseSampleId,
        resolvedSampleId: outcome.resolvedSampleId,
        requestedAtMs: outcome.requestedAtMs,
        prepareSentAtMs: outcome.prepareSentAtMs,
        preparedAtMs: outcome.preparedAtMs,
        commitSentAtMs: outcome.commitSentAtMs,
        mediaScheduledAtMs: outcome.cueAt,
        leadMs: outcome.cueAt - outcome.preparedAtMs,
        outcome: "ok",
        at: new Date().toISOString()
      });
      return { cueAt: outcome.cueAt };
    },
    [conditionId, conditionIndex, hostClient, logHapticCue, session]
  );

  /** Recovery may continue only from an explicitly verified idle, armed device. */
  const handleCueRecoveryRequest = useCallback(async (): Promise<{ ok: true } | { ok: false; reason: string }> => {
    if (hostClient === null) return { ok: false, reason: "硬件连接未建立" };
    const status = await hostClient.getStatus(5000);
    if (!status.ok) return { ok: false, reason: `硬件状态查询失败：${status.error.message}` };
    if (!status.value.armed) return { ok: false, reason: "设备未 ARM；请在硬件连接中手动 ARM" };
    if (status.value.fault !== 0) return { ok: false, reason: `设备故障 ${status.value.fault}；请停止并检查硬件` };
    if (status.value.state !== 1) return { ok: false, reason: "设备并非空闲状态；请停止当前输出并手动 ARM 后重试" };
    return { ok: true };
  }, [hostClient]);

  if (session === null || conditionId === null || displayCondition === null || launch === null) return null;

  return (
    <div>
      <p className="screen-intro">
        正在运行条件 {displayCondition}。请完成完整游戏流程；游戏结束后将自动进入后续问卷。
      </p>
      <button type="button" className="button button-secondary" aria-label="调整当前硬件输出等级" onClick={() => { setPauseAfterEventToken(value => value + 1); setShowCalibration(true); }}>调整输出等级</button>
      <EmbeddedConditionRunner
        launch={launch}
        onEvent={handleEvent}
        onComplete={handleComplete}
        onCueRequest={handleCueRequest}
        onCueRecoveryRequest={handleCueRecoveryRequest}
        onError={handleInterrupt}
        onRetry={handleRetry}
        onDiagnostic={detail => {
          void logAdapter("game", "condition-diagnostic", detail);
        }}
        pauseAfterEventToken={pauseAfterEventToken}
      />
      {showCalibration && <CalibrationDialog inPlace onClose={() => setShowCalibration(false)} />}
    </div>
  );
}
