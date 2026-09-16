"use client";

import { useEffect, useState, type ReactNode } from "react";
import type { ConditionId, LaunchConfig } from "../game/types";
import { normalizeTopLevelPracticeSearch, parseLaunchConfig } from "../game/launchConfig";
import { emergencyStopAll } from "../game/hapticRuntime";
import type { SelectableMode } from "./GameControls";
import { ExperimentPage } from "./ExperimentPage";
import { HardwareHostPage } from "./HardwareHostPage";
import { PracticeScene } from "./PracticeScene";
import { SerialSettingsPage } from "./SerialSettingsPage";

type EntryMode = "practice" | "STH" | "BH" | "NONE";

const localConfig = (conditionId: ConditionId): LaunchConfig => ({
  mode: "developer",
  sessionId: `LOCAL-${conditionId}`,
  runId: `LOCAL-${conditionId}-R1`,
  conditionId,
  projectileSequenceId: "S1",
  areaSequenceId: "A1",
  // 单游戏预览的 STH/BH 使用与正式试验相同的 cue 门控；NH 不等待触觉。
  hapticGate: conditionId !== "NH",
});

export function StudyEntry({ searchOverride }: { searchOverride?: string }) {
  const [resolvedSearch, setResolvedSearch] = useState(searchOverride ?? "");
  const [routingResolved, setRoutingResolved] = useState(
    searchOverride !== undefined,
  );
  const initialRequestedMode = new URLSearchParams(
    searchOverride ?? "",
  ).get("mode");
  const [mode, setMode] = useState<EntryMode>(
    initialRequestedMode === "practice" ? "practice" : "STH",
  );

  useEffect(() => {
    if (searchOverride !== undefined) return;
    const search = normalizeTopLevelPracticeSearch(
      window.location.search,
      window.self === window.top,
    );
    if (search !== window.location.search)
      window.history.replaceState(null, "", search);
    setResolvedSearch(search);
    if (new URLSearchParams(search).get("mode") === "practice")
      setMode("practice");
    setRoutingResolved(true);
  }, [searchOverride]);

  const requestedMode = new URLSearchParams(resolvedSearch).get("mode");
  const shell = (content: ReactNode) => (
    <div className={routingResolved ? "entry-routing-ready" : "entry-routing-pending"}>
      {content}
    </div>
  );

  // 操作员专用的全局串口设置页（独立打开；嵌入式 iframe 不提供串口入口）
  if (requestedMode === "serial") return shell(<SerialSettingsPage />);

  // 持久 HardwareHost：R2 会话内唯一串口持有者（仅经 R2 嵌入）
  if (requestedMode === "serial-host")
    return shell(<HardwareHostPage key="serial-host" />);

  if (requestedMode === "experiment" || requestedMode === "developer") {
    try {
      const config = parseLaunchConfig(resolvedSearch);
      return shell(<ExperimentPage configOverride={config} />);
    } catch (error) {
      return shell(
        <main className="mode-entry practice-config-error" role="alert">
          <section className="mode-entry-panel">
            <h1>实验模式配置错误</h1>
            <p>{error instanceof Error ? error.message : "unknown error"}</p>
          </section>
        </main>,
      );
    }
  }

  if (requestedMode === "practice") {
    try {
      const config = parseLaunchConfig(resolvedSearch);
      if (config.embedded) return shell(<PracticeScene launchConfig={config} />);
    } catch (error) {
      return shell(
        <main className="mode-entry practice-config-error" role="alert">
          <section className="mode-entry-panel">
            <h1>练习模式配置错误</h1>
            <p>{error instanceof Error ? error.message : "unknown error"}</p>
          </section>
        </main>,
      );
    }
  }

  // 本地模式切换：先安全停止当前触觉事务，再以新条件从 G01 重挂载。
  const switchLocalMode = (next: SelectableMode) => {
    void emergencyStopAll(`mode switch to ${next}`).then(() => setMode(next));
  };

  if (mode === "practice")
    return shell(
      <PracticeScene
        key="practice"
        selectedMode={mode}
        onModeChange={switchLocalMode}
      />,
    );
  return shell(
    <ExperimentPage
      key={mode}
      configOverride={localConfig(mode === "NONE" ? "NH" : mode)}
      selectedMode={mode}
      onModeChange={switchLocalMode}
      autoStart
    />,
  );
}
