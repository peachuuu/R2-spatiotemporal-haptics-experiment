/**
 * 样本对比播放编排：与条件游戏相同的两阶段门控——
 *   PREPARE_SAMPLE → 收到 PREPARED（含设备实测时长 durationUs）→
 *   选定未来共同起播点 cueAt = now + leadMs → COMMIT_AFTER(相对 delayMs)。
 * 触觉与音频共享同一共同起播点：调用方在 onStarted（cueAt 时刻）起播音频。
 * stop() 清除全部计时器并向固件 STOP（归零输出），绝不静默继续。
 */

export const DEFAULT_LEAD_MS = 150;

export type ComparisonPlaybackHost = {
  prepareSample(sampleId: string, timeoutMs?: number): Promise<
    | { ok: true; value: { sampleId: string; durationUs: number } }
    | { ok: false; error: { code: string; message: string } }
  >;
  commitAfter(delayMs: number, timeoutMs?: number): Promise<
    | { ok: true; value: { deviceStartUs: number } }
    | { ok: false; error: { code: string; message: string } }
  >;
  /** STOP 抢占挂起事务并使固件输出归零（HardwareHostClient.emergencyStop）。 */
  emergencyStop(timeoutMs?: number): Promise<unknown>;
  /** STOP 后自动重新 ARM（可选）：会话内连续播放保持输出解锁。 */
  arm?(timeoutMs?: number): Promise<unknown>;
};

export type ComparisonPlaybackInput = {
  /** 已解析（含条件限定）的样本 ID，如 sth.g03.fire / bh.g03.fire。 */
  resolvedSampleId: string;
  leadMs?: number;
  /** 共同起播点到期时回调（此时应起播音频）；携带时长供界面复位按钮。 */
  onStarted?: (info: { resolvedSampleId: string; cueAt: number; durationMs: number }) => void;
  /** 设备实测样本播完后回调（已含少量余量）。 */
  onFinished?: () => void;
  /** 准备/提交失败时回调（不播放任何媒体）。 */
  onError?: (message: string) => void;
};

export type ComparisonPlaybackHandle = {
  stop: () => void;
};

/**
 * 启动一次对比样本播放。PREPARE 成功前不播放任何媒体；
 * onStarted 在共同起播点触发，调用方在回调内同步起播音频。
 */
export function playComparisonSample(host: ComparisonPlaybackHost, input: ComparisonPlaybackInput): ComparisonPlaybackHandle {
  const leadMs = input.leadMs ?? DEFAULT_LEAD_MS;
  const timers: ReturnType<typeof setTimeout>[] = [];
  let stopped = false;

  void (async () => {
    const prepare = await host.prepareSample(input.resolvedSampleId, 4000);
    if (stopped) return;
    if (!prepare.ok) {
      input.onError?.(prepare.error.message);
      return;
    }
    const durationMs = prepare.value.durationUs / 1000;
    const cueAt = performance.now() + leadMs;
    const delayMs = Math.max(0, Math.round(cueAt - performance.now()));
    // COMMIT 不阻塞共同起播点；失败经 onError 回报（不播放媒体）。
    void host.commitAfter(delayMs, 8000).then(result => {
      if (!result.ok && !stopped) input.onError?.(result.error.message);
    });
    timers.push(
      setTimeout(() => {
        if (stopped) return;
        input.onStarted?.({ resolvedSampleId: input.resolvedSampleId, cueAt, durationMs });
        timers.push(
          setTimeout(() => {
            if (!stopped) input.onFinished?.();
          }, durationMs + 250)
        );
      }, leadMs)
    );
  })();

  return {
    stop: () => {
      stopped = true;
      for (const timer of timers) clearTimeout(timer);
      timers.length = 0;
      // STOP 抢占挂起事务并使固件输出归零；随后自动重新 ARM，
      // 保持会话内连续播放能力（设备空闲时 STOP→ARM 为安全空操作序列）。
      void host.emergencyStop(3000)
        .then(() => host.arm?.(7000))
        .catch(() => undefined);
    }
  };
}
