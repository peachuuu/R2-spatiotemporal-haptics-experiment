import { useState } from "react";
import type { ReactNode } from "react";
import { useStudy } from "../app/StudyContext";
import { GAME_STEP_IDS, SKIPPABLE_STEPS, STEP_ORDER } from "../app/studyMachine";
import { conditionAt, conditionMarker, getDisplayCondition, prepareDebugExportExit } from "../domain/session";
import { skipReasonLabel } from "../domain/types";
import type { StepId, StudySession } from "../domain/types";
import { useHardwareHostClient } from "../integration/HardwareHostFrame";
import { downloadSessionZip } from "../storage/exportSession";
import { SkipStepDialog } from "./SkipStepDialog";

export const STEP_TITLES: Record<StepId, string> = {
  "basic-info": "基本信息",
  consent: "知情同意",
  calibration: "阈值校准",
  instruction: "操作说明",
  "condition-1": "条件运行",
  "assessment-1": "条件后评估",
  "condition-2": "条件运行",
  "assessment-2": "条件后评估",
  comparison: "样本对比",
  final: "最终评估",
  interview: "试验后访谈",
  completion: "会话完成"
};

const MODE_LABELS = { "dry-run": "干跑", production: "生产" } as const;

/**
 * 步骤标题（条件步骤带显示标签 A/B 与操作员标记）。
 * 标题后的标记区分隐藏的真实条件（○=BH 基础触觉、✦=STH 时空触觉），
 * 参与者无法解读，操作员可快速核对；标记不写入任何数据表。
 */
export function stepTitle(session: StudySession, step: StepId): string {
  const markerAt = (index: 0 | 1) => conditionMarker(conditionAt(session, index));
  switch (step) {
    case "condition-1":
      return `条件 ${getDisplayCondition(session, conditionAt(session, 0))} ${markerAt(0)}`;
    case "assessment-1":
      return `条件 ${getDisplayCondition(session, conditionAt(session, 0))} 后评估 ${markerAt(0)}`;
    case "condition-2":
      return `条件 ${getDisplayCondition(session, conditionAt(session, 1))} ${markerAt(1)}`;
    case "assessment-2":
      return `条件 ${getDisplayCondition(session, conditionAt(session, 1))} 后评估 ${markerAt(1)}`;
    default:
      return STEP_TITLES[step];
  }
}

type Props = {
  stepId: StepId;
  title: string;
  skippable: boolean;
  children: ReactNode;
};

/** 每个实验界面的共享框架：进度、模式徽章、跳过控件、保存并退出。 */
export function StepFrame({ stepId, title, skippable, children }: Props) {
  const { session, skip, saveAndExit, update } = useStudy();
  const hostClient = useHardwareHostClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  if (session === null) return null;

  const isDryRun = session.studyMode === "dry-run";
  const stepNumber = STEP_ORDER.indexOf(stepId) + 1;
  const lastSkipped = session.skippedSteps.at(-1);
  const skipAllowed = isDryRun && skippable && SKIPPABLE_STEPS.includes(stepId);

  const isGameStep = GAME_STEP_IDS.includes(stepId);

  const debugExportAndExit = async () => {
    if (!window.confirm("将停止当前输出、下载目前的调试数据，并退出本会话。该记录会标为未完成。是否继续？")) return;
    setExporting(true);
    setExportError(null);
    try {
      if (session.studyMode === "production") {
        if (hostClient === null) throw new Error("硬件连接未建立，无法确认已安全停止输出。");
        const stopped = await hostClient.emergencyStop(3000);
        if (!stopped.ok) throw new Error(`停止输出失败：${stopped.error.message}`);
      }
      const snapshot = prepareDebugExportExit(session);
      await update(() => snapshot);
      await downloadSessionZip(snapshot);
      await saveAndExit();
    } catch (error) {
      setExportError(error instanceof Error ? error.message : String(error));
    } finally {
      setExporting(false);
    }
  };

  return (
    <section className={`step-frame${isGameStep ? " step-frame--game" : ""}`}>
      <header className="step-header">
        <div>
          <p className="step-progress">
            第 {stepNumber} 步 / 共 {STEP_ORDER.length} 步 — {MODE_LABELS[session.studyMode]}
          </p>
          <h2>{title}</h2>
        </div>
        <div className="step-badges">
          {isDryRun && <span className="badge badge-dry-run">干跑 / 仅模拟</span>}
          <span className="badge">会话：{session.participantCode}</span>
        </div>
      </header>

      {lastSkipped !== undefined && (
        <p className="skip-banner" role="status">
          本会话中已跳过的步骤：{STEP_TITLES[lastSkipped.stepId]} — 原因：{skipReasonLabel(lastSkipped.reason)}
          {lastSkipped.note !== undefined ? `（${lastSkipped.note}）` : ""}，时间：{lastSkipped.skippedAt}
        </p>
      )}

      <div className="step-body">{children}</div>

      <footer className="step-footer">
        <button type="button" className="button button-secondary" onClick={() => void saveAndExit()}>
          保存并退出
        </button>
        <button type="button" className="button button-danger" disabled={exporting} onClick={() => void debugExportAndExit()}>
          {exporting ? "正在导出…" : "调试：导出并退出"}
        </button>
        {exportError !== null && <p className="field-error" role="alert">调试导出失败：{exportError}</p>}
        {skipAllowed && (
          <button type="button" className="button button-danger" onClick={() => setDialogOpen(true)}>
            跳过此步骤
          </button>
        )}
      </footer>

      {dialogOpen && (
        <SkipStepDialog
          onCancel={() => setDialogOpen(false)}
          onConfirm={input => {
            setDialogOpen(false);
            void skip(stepId, input);
          }}
        />
      )}
    </section>
  );
}
