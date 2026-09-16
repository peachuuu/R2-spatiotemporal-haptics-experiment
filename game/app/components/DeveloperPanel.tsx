"use client";

import type { GameRunResult, LaunchConfig } from "../game/types";
import { sensoryPolicies } from "../game/sensoryPolicies";

export function DeveloperPanel({
  config,
  result,
  onStart,
  onAbort,
}: {
  config: LaunchConfig;
  result: GameRunResult | undefined;
  onStart: () => void;
  onAbort: () => void;
}) {
  const download = () => {
    if (!result) return;
    const href = URL.createObjectURL(
      new Blob([JSON.stringify(result, null, 2)], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = href;
    link.download = `${result.sessionId}-${result.runId}.json`;
    link.click();
    URL.revokeObjectURL(href);
  };
  const policy = sensoryPolicies[config.conditionId];
  return (
    <section className="developer-panel">
      <b>Developer run</b> · {config.runId} · 条件 {config.conditionId} /
      触觉标签 {policy.hapticVariant}
      <button onClick={onStart}>开始</button>
      <button onClick={onAbort}>中止</button>
      <button disabled={!result} onClick={download}>
        下载 run JSON
      </button>
    </section>
  );
}
