import { useStudy } from "../app/StudyContext";
import { appendAuditEvent } from "../domain/session";
import { skipReasonLabel } from "../domain/types";
import type { StudySession } from "../domain/types";
import { downloadSessionZip, downloadTextFile, exportFileName, exportSessionCsv, exportSessionJson } from "../storage/exportSession";

export function CompletionScreen() {
  const { session, update, saveAndExit } = useStudy();
  if (session === null) return null;

  const complete = session.status === "complete";

  const download = async (format: "json" | "csv") => {
    await update(s => appendAuditEvent(s, { type: "Exported", detail: { format } }, new Date().toISOString()));
    const content = format === "json" ? exportSessionJson(session) : exportSessionCsv(session);
    downloadTextFile(
      exportFileName(session, format),
      content,
      format === "json" ? "application/json" : "text/csv;charset=utf-8",
      format === "csv"
    );
  };

  const downloadAll = async () => {
    // 在 update 回调内捕获追加 Exported 事件后的会话，使压缩包内审计表包含本次导出记录。
    let next: StudySession | null = null;
    await update(s => {
      next = appendAuditEvent(s, { type: "Exported", detail: { format: "zip" } }, new Date().toISOString());
      return next;
    });
    if (next !== null) await downloadSessionZip(next);
  };

  return (
    <div className="completion">
      <p className={complete ? "completion-status ok" : "completion-status warn"} role="status">
        {complete ? "状态：已完成" : "状态：未完成——本会话在干跑模式中跳过了部分步骤。"}
      </p>
      {session.skippedSteps.length > 0 && (
        <p className="skip-banner">
          本会话已跳过：{session.skippedSteps.map(step => `${step.stepId}（${skipReasonLabel(step.reason)}）`).join("，")}
        </p>
      )}
      <p className="screen-intro">
        会话数据已保存在本浏览器本地。「导出全部数据」下载压缩包
        <code>被试编号-昵称-实验时间.zip</code>，内含完整 JSON 主记录与九份分析 CSV
        （主观问卷、HXI 因子宽表、HXI 因子对照表、PXI 因子宽表、PXI 因子对照表、
        游戏事件、条件汇总、触觉 cue、审计日志）。每次下载都会追加到审计日志中。
      </p>
      <div className="download-actions">
        <button type="button" className="button button-primary" onClick={() => void downloadAll()}>
          导出全部数据
        </button>
        <button type="button" className="button button-secondary" onClick={() => void download("json")}>
          仅下载 JSON
        </button>
        <button type="button" className="button button-secondary" onClick={() => void download("csv")}>
          仅下载主观 CSV
        </button>
      </div>
      <h3>审计日志摘要</h3>
      <ol className="audit-summary">
        {session.auditLog
          .slice(-12)
          .reverse()
          .map(event => (
            <li key={event.id}>
              <span className="audit-type">{event.type}</span>
              {event.stepId !== undefined ? ` (${event.stepId})` : ""}
              <span className="audit-time">{event.at}</span>
            </li>
          ))}
      </ol>
      <button type="button" className="button button-secondary" onClick={() => void saveAndExit()}>
        开始新会话
      </button>
    </div>
  );
}
