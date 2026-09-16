"use client";

export type SelectableMode = "practice" | "STH" | "BH" | "NONE";

export const SELECTABLE_MODE_LABELS: Record<SelectableMode, string> = {
  practice: "练习模式",
  STH: "时空触觉模式",
  BH: "基础触觉模式",
  NONE: "无触觉测试模式"
};

export function GameControls({
  selectedMode,
  onModeChange,
  onConnectHaptics,
  onDisconnectHaptics,
  hapticConnectionMessage,
}: {
  selectedMode?: SelectableMode;
  onModeChange?: (mode: SelectableMode) => void;
  onConnectHaptics?: () => void;
  onDisconnectHaptics?: () => void;
  hapticConnectionMessage?: string | null;
}) {
  return (
    <div className="controls">
      <div>
        <b>键盘</b> A/D左右移动；空格跳跃；E交互。　<b>PS5</b> 左摇杆移动；X
        跳跃；O 交互。
      </div>
      {selectedMode && onModeChange && (
        <div className="mode-inline" aria-label="游戏模式选择">
          {(["practice", "STH", "BH", "NONE"] as const).map((mode) => (
            <button
              key={mode}
              className={selectedMode === mode ? "selected" : ""}
              onClick={() => onModeChange(mode)}
            >
              {SELECTABLE_MODE_LABELS[mode]}
            </button>
          ))}
          <a className="serial-settings-link" href="/?mode=serial">
            串口设置
          </a>
          {(selectedMode === "STH" || selectedMode === "BH") && onConnectHaptics && (
            <>
              <button type="button" onClick={onConnectHaptics}>连接触觉设备并 ARM</button>
              {onDisconnectHaptics && <button type="button" onClick={onDisconnectHaptics}>停止并断开触觉设备</button>}
            </>
          )}
          {hapticConnectionMessage && <span role="status">{hapticConnectionMessage}</span>}
        </div>
      )}
    </div>
  );
}
