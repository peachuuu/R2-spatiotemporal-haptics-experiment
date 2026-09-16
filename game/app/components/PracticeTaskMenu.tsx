"use client";

import type {
  PracticeAction,
  PracticePhase,
  PracticeTask,
} from "../game/practiceController";

const labels: Record<PracticeAction, string> = {
  projectile: "飞行物来袭",
  area: "危险区域扩张",
  chest: "寻找宝箱并进行交互",
  complete: "完成练习并继续",
};

export function PracticeTaskMenu({
  embedded,
  phase,
  focusedAction,
  activeTask,
  onFocus,
  onConfirm,
}: {
  embedded: boolean;
  phase: PracticePhase;
  focusedAction: PracticeAction;
  activeTask?: PracticeTask;
  onFocus: (action: PracticeAction) => void;
  onConfirm: (action: PracticeAction) => void;
}) {
  const actions: PracticeAction[] = embedded
    ? ["projectile", "area", "chest", "complete"]
    : ["projectile", "area", "chest"];
  const locked = phase !== "idle";
  return (
    <div className="practice-task-picker" aria-label="练习类型选择">
      <b>选择练习内容</b>
      {actions.map((action) => (
        <button
          key={action}
          type="button"
          disabled={locked}
          className={`${focusedAction === action ? "focused" : ""} ${activeTask === action ? "selected" : ""}`.trim()}
          onFocus={() => onFocus(action)}
          onClick={() => {
            onFocus(action);
            onConfirm(action);
          }}
        >
          {labels[action]}
        </button>
      ))}
    </div>
  );
}
