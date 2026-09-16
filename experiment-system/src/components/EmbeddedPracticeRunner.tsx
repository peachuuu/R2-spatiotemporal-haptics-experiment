import { useEffect, useRef, useState } from "react";
import { createPracticeUrl, GAME_ORIGIN, isPracticeMessage } from "../integration/gameProtocol";

export type PracticeRunnerStatus = "loading" | "ready" | "complete" | "error";

export type DiagnosticDetail = Record<string, string | number | boolean>;

/**
 * Embeds the real Spirit Ruins practice scene and consumes the authenticated
 * PRACTICE_READY / PRACTICE_COMPLETE / PRACTICE_ERROR messages. Only a valid
 * completion advances the workflow; loading failures show a retryable error
 * and are recorded through `onDiagnostic`.
 */
export function EmbeddedPracticeRunner({
  sessionId,
  onComplete,
  onDiagnostic,
  onCueRequest,
  readyTimeoutMs = 60000
}: {
  sessionId: string;
  onComplete: () => void;
  onDiagnostic?: (detail: DiagnosticDetail) => void;
  onCueRequest?: (request: { cueKey: string; baseSampleId: string; conditionId: "STH"; atMs: number }) => Promise<{ delayMs: number } | { error: string }>;
  readyTimeoutMs?: number;
}) {
  const [status, setStatus] = useState<PracticeRunnerStatus>("loading");
  const [errorReason, setErrorReason] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const completedRef = useRef(false);
  // Callbacks live in refs so inline props never re-arm the message effect.
  const diagnosticRef = useRef(onDiagnostic);
  diagnosticRef.current = onDiagnostic;
  const completeRef = useRef(onComplete);
  completeRef.current = onComplete;
  const cueRequestRef = useRef(onCueRequest);
  cueRequestRef.current = onCueRequest;

  const url = createPracticeUrl(sessionId, location.origin);

  useEffect(() => {
    setStatus("loading");
    setErrorReason(null);
    completedRef.current = false;
    const readyTimer = window.setTimeout(() => {
      setStatus(current => (current === "loading" ? "error" : current));
      setErrorReason(current => current ?? "练习加载超时：未收到 PRACTICE_READY。");
      diagnosticRef.current?.({ event: "practice-ready-timeout", readyTimeoutMs });
    }, readyTimeoutMs);

    const onMessage = (event: MessageEvent) => {
      if (event.origin !== GAME_ORIGIN) {
        diagnosticRef.current?.({ event: "practice-rejected-origin", origin: event.origin });
        return;
      }
      // jsdom never sets event.source; real browsers always do. Any real
      // window other than this iframe is rejected.
      const iframeWindow = iframeRef.current?.contentWindow ?? null;
      if (event.source !== null && event.source !== iframeWindow) {
        diagnosticRef.current?.({ event: "practice-rejected-source" });
        return;
      }
      const message: unknown = event.data;
      if (!isPracticeMessage(message, sessionId)) {
        diagnosticRef.current?.({ event: "practice-rejected-message" });
        return;
      }
      if (message.type === "PRACTICE_READY") {
        window.clearTimeout(readyTimer);
        setStatus("ready");
      } else if (message.type === "PRACTICE_ERROR") {
        const payload = message.payload as { reason?: unknown } | undefined;
        const reason = typeof payload?.reason === "string" ? payload.reason : "游戏报告练习初始化错误。";
        setStatus("error");
        setErrorReason(reason);
        diagnosticRef.current?.({ event: "practice-error", reason });
      } else if (message.type === "PRACTICE_COMPLETE") {
        if (completedRef.current) return;
        completedRef.current = true;
        window.clearTimeout(readyTimer);
        setStatus("complete");
        completeRef.current();
      } else if (message.type === "CUE_REQUEST") {
        const payload = message.payload as Record<string, unknown> | undefined;
        if (payload === undefined || typeof payload.cueKey !== "string" || typeof payload.baseSampleId !== "string" || payload.conditionId !== "STH" || typeof payload.atMs !== "number") {
          diagnosticRef.current?.({ event: "practice-rejected-cue-request" });
          return;
        }
        const request = { cueKey: payload.cueKey, baseSampleId: payload.baseSampleId, conditionId: "STH" as const, atMs: payload.atMs };
        void (async () => {
          const result = await cueRequestRef.current?.(request)
            ?? { error: "练习触觉处理器不可用" };
          if ("error" in result) {
            setStatus("error");
            setErrorReason(`练习触觉启动失败：${result.error}`);
            diagnosticRef.current?.({ event: "practice-cue-error", reason: result.error });
            return;
          }
          iframeRef.current?.contentWindow?.postMessage({
            source: "spirit-ruins", protocolVersion: 1, sessionId,
            type: "START_CUE", payload: { delayMs: result.delayMs },
          }, GAME_ORIGIN);
        })();
      }
    };
    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("message", onMessage);
      window.clearTimeout(readyTimer);
    };
  }, [sessionId, attempt, readyTimeoutMs]);

  return (
    <div className="embedded-runner">
      <div className={`embedded-frame-wrap embedded-frame-wrap--game ${status === "error" ? "frame-error" : ""}`}>
        <iframe
          key={attempt}
          ref={iframeRef}
          src={url}
          title="月萤遗迹 操作练习"
          className="embedded-frame practice-frame"
          data-testid="practice-frame"
        />
      </div>
      <p className="embedded-status" role="status">
        {status === "loading" && "正在加载练习游戏…"}
        {status === "ready" && "练习已就绪：可在左侧选择练习内容，完成后点击「完成练习并继续」。"}
        {status === "complete" && "练习已完成，正在进入实验条件…"}
        {status === "error" && (errorReason ?? "练习加载失败。")}
      </p>
      {status === "error" && (
        <button type="button" className="button button-secondary" onClick={() => setAttempt(current => current + 1)}>
          重试加载练习
        </button>
      )}
    </div>
  );
}
