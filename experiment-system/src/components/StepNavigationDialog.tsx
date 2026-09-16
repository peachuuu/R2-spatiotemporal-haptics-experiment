import { useStudy } from "../app/StudyContext";
import { STEP_ORDER } from "../app/studyMachine";
import { stepTitle } from "./StepFrame";

/** 全局目录：支持从任一步直接跳转，适用于系统搭建与干跑。 */
export function StepNavigationDialog({ onClose }: { onClose: () => void }) {
  const { session, goToStep } = useStudy();
  if (session === null) return null;

  const skipped = new Set(session.skippedSteps.map(step => step.stepId));
  const completed = new Set(
    session.auditLog.filter(event => event.type === "StepCompleted" && event.stepId !== undefined).map(event => event.stepId)
  );

  return (
    <div className="modal-backdrop">
      <div role="dialog" aria-modal="true" aria-labelledby="toc-title" className="modal modal-wide">
        <h3 id="toc-title">实验步骤目录</h3>
        <ol className="toc-list">
          {STEP_ORDER.map((step, index) => {
            const isCurrent = step === session.currentStepId;
            const isDone = completed.has(step);
            const wasSkipped = skipped.has(step);
            return (
              <li key={step} className="toc-item">
                <button
                  type="button"
                  className="button button-ghost toc-link"
                  onClick={() => {
                    void goToStep(step);
                    onClose();
                  }}
                >
                  {index + 1}. {stepTitle(session, step)}
                </button>
                <span className="toc-status">
                  {isCurrent ? "当前" : wasSkipped ? "已跳过" : isDone ? "已完成" : "未开始"}
                </span>
              </li>
            );
          })}
        </ol>
        <p className="modal-hint">可直接跳转到任一步。跳转不会自动标记步骤为已完成或已跳过。</p>
        <div className="modal-actions">
          <button type="button" className="button button-secondary" onClick={onClose}>
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}
