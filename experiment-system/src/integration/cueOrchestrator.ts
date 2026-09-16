/**
 * Cue 编排器：游戏在 cue 边界发来 CUE_REQUEST 后，R2 执行：
 *   解析 STH/BH 样本 ID → PREPARE_SAMPLE → 收到 PREPARED →
 *   选定未来 cueAt = now + leadMs → COMMIT_AFTER(相对 delayMs) → START_CUE。
 * 相对 delay 发给 MCU；跨源 iframe 的游戏也只接收发送瞬间计算的相对 delay。
 * 失败返回阶段化错误，绝不静默继续。
 */

import { conditionAt } from "../domain/session";
import type { ConditionId, StudySession } from "../domain/types";

export const DEFAULT_LEAD_MS = 150;

export type CueRequestLike = {
  cueKey: string;
  baseSampleId: string | null;
  conditionId: string;
  atMs: number;
};

export type CueOrchestrationInput = {
  request: CueRequestLike;
  session: StudySession;
  conditionIndex: 0 | 1;
  now: number;
  leadMs?: number;
};

export type CueOrchestrationOk = {
  ok: true;
  resolvedSampleId: string;
  baseSampleId: string;
  cueAt: number;
  delayMs: number;
  requestedAtMs: number;
  prepareSentAtMs: number;
  preparedAtMs: number;
  commitSentAtMs: number;
  preparedDurationUs: number;
};

export type CueOrchestrationError = {
  ok: false;
  stage: "resolve" | "prepare" | "commit";
  message: string;
  deviceErrorName?: string;
};

export type CueHost = {
  prepareSample(sampleId: string, timeoutMs?: number): Promise<
    | { ok: true; value: { sampleId: string; durationUs: number } }
    | { ok: false; error: { code: string; message: string; deviceErrorName?: string } }
  >;
  commitAfter(delayMs: number, timeoutMs?: number): Promise<
    | { ok: true; value: { deviceStartUs: number } }
    | { ok: false; error: { code: string; message: string } }
  >;
};

/** R2 侧 STH/BH 样本解析：仅替换显式的条件 token，拒绝旧式缩写 ID。 */
export function resolveSampleForSession(session: StudySession, conditionIndex: 0 | 1, baseSampleId: string): string {
  if (!baseSampleId.startsWith("sth.")) throw new Error(`invalid STH base sample ID: ${baseSampleId}`);
  const hidden: ConditionId = conditionAt(session, conditionIndex);
  return hidden === "baseline" ? `bh.${baseSampleId.slice(4)}` : baseSampleId;
}

/**
 * 完整 prepare→commit 编排；commit 结果经 onStarted 回调异步回报（STARTED
 * 设备 tick），不阻塞 START_CUE 的及时下发。
 */
export async function orchestrateCue(
  host: CueHost,
  input: CueOrchestrationInput,
  onStarted?: (result: { deviceStartUs: number } | { error: string }) => void
): Promise<CueOrchestrationOk | CueOrchestrationError> {
  const { request, session, conditionIndex, now } = input;
  const leadMs = input.leadMs ?? DEFAULT_LEAD_MS;
  if (request.baseSampleId === null || request.baseSampleId === "") {
    return { ok: false, stage: "resolve", message: `cue ${request.cueKey} 缺少基础样本 ID（失败关闭）` };
  }
  const baseSampleId = request.baseSampleId;
  const resolvedSampleId = resolveSampleForSession(session, conditionIndex, baseSampleId);
  const prepareSentAtMs = now;
  const prepare = await host.prepareSample(resolvedSampleId, 7000);
  if (!prepare.ok) {
    return {
      ok: false,
      stage: "prepare",
      message: prepare.error.message,
      deviceErrorName: prepare.error.deviceErrorName
    };
  }
  const preparedAtMs = performance.now();
  const cueAt = preparedAtMs + leadMs;
  const delayMs = Math.max(0, Math.round(cueAt - performance.now()));
  const commitSentAtMs = performance.now();
  // COMMIT 不阻塞 START_CUE；STARTED 到达后经回调回报设备 tick。
  void host.commitAfter(delayMs, 8000).then(result => {
    if (result.ok) onStarted?.({ deviceStartUs: result.value.deviceStartUs });
    else onStarted?.({ error: result.error.message });
  });
  return {
    ok: true,
    resolvedSampleId,
    baseSampleId,
    cueAt,
    delayMs,
    requestedAtMs: request.atMs,
    prepareSentAtMs,
    preparedAtMs,
    commitSentAtMs,
    preparedDurationUs: prepare.value.durationUs
  };
}
