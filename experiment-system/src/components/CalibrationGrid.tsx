import { useEffect, useRef, useState } from "react";
import { FINGER_IDS, FINGER_LABELS } from "../domain/session";
import type { CalibrationRecord, FingerId } from "../domain/types";
import type { DeviceStatus } from "../adapters/contracts";

/** 每行确认流程状态：可应用 → 正在停止… → 正在发送… → 等待硬件确认… → 已应用/失败重试。 */
export type ApplyStatus = "idle" | "stopping" | "sending" | "waiting" | "applied" | "failed";

type RowState = {
  /** 输入框中的输出等级（0–180，和上位机一致）。 */
  code: string;
  /** 已确认的输出等级。 */
  applied: number | null;
  /** 校准脉冲通断。 */
  stimulating: boolean;
  applyStatus: ApplyStatus;
  statusDetail: string;
};

const emptyRow = (record: CalibrationRecord | undefined): RowState => ({
  code: record?.thresholdVoltage.toString() ?? "",
  applied: record !== undefined ? record.thresholdVoltage : null,
  stimulating: false,
  applyStatus: "idle",
  statusDetail: ""
});

type Props = {
  initialRecords: CalibrationRecord[];
  /** "确定"：STOP → SET_CALIBRATION → CALIBRATION_APPLIED。 */
  onApplyVoltage: (fingerId: FingerId, voltageCode: number) => Promise<DeviceStatus>;
  onStartStimulation: (fingerId: FingerId, voltageCode: number) => Promise<DeviceStatus>;
  onStopStimulation: (fingerId: FingerId) => Promise<DeviceStatus>;
  /** 持续校准期间每 2 秒刷新一次硬件看门狗；断页/断连后设备会自行停止。 */
  onKeepAlive: () => Promise<DeviceStatus>;
  /** 离开校准页前确认 STOP 后已重新 ARM，避免把未 ARM 设备交给正式游戏。 */
  onEnsureArmed?: () => Promise<DeviceStatus>;
  onValidSubmit: (records: CalibrationRecord[]) => void;
};

export function CalibrationGrid({ initialRecords, onApplyVoltage, onStartStimulation, onStopStimulation, onKeepAlive, onEnsureArmed, onValidSubmit }: Props) {
  const initialRows = Object.fromEntries(
    FINGER_IDS.map(fingerId => [fingerId, emptyRow(initialRecords.find(record => record.fingerId === fingerId))])
  ) as Record<FingerId, RowState>;
  const [rows, setRows] = useState<Record<FingerId, RowState>>(initialRows);
  const [errors, setErrors] = useState<Partial<Record<FingerId, string>>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [busy, setBusy] = useState<FingerId | null>(null);
  const stimulatingRef = useRef<FingerId | null>(null);
  const stopStimulationRef = useRef(onStopStimulation);
  stopStimulationRef.current = onStopStimulation;

  // 只在真正卸载校准页时停止。父组件写入日志会刷新回调引用，不能被误认为离开页面。
  useEffect(() => {
    return () => {
      if (stimulatingRef.current !== null) {
        void stopStimulationRef.current(stimulatingRef.current);
      }
    };
  }, []);

  // 固件命令看门狗为 10 秒。持续校准时维持控制链路；一旦页面关闭、桥接断开
  // 或此心跳停止，固件会在看门狗超时后输出归零并全部高阻。
  useEffect(() => {
    if (!FINGER_IDS.some(fingerId => rows[fingerId]?.stimulating)) return;
    const timer = window.setInterval(() => void onKeepAlive(), 2000);
    return () => window.clearInterval(timer);
  }, [onKeepAlive, rows]);

  const setRow = (fingerId: FingerId, patch: Partial<RowState>) => {
    const current = rows[fingerId] ?? emptyRow(undefined);
    setRows(prev => ({ ...prev, [fingerId]: { ...current, ...patch } }));
  };

  const parseCode = (text: string): number | null => {
    if (text.trim() === "") return null;
    const value = Number(text);
    return Number.isFinite(value) ? value : null;
  };

  const rowError = (row: RowState): string | null => {
    const code = parseCode(row.code);
    if (code === null || !Number.isInteger(code) || code < 0 || code > 180) {
      return "请输入 0 到 180 之间的整数输出等级。";
    }
    return null;
  };

  const applyVoltage = async (fingerId: FingerId) => {
    if (busy !== null) return; // 禁止重复提交
    const row = rows[fingerId] ?? emptyRow(undefined);
    const message = rowError(row);
    if (message !== null) {
      setErrors(prev => ({ ...prev, [fingerId]: message }));
      return;
    }
    const code = parseCode(row.code) ?? 0;
    setBusy(fingerId);
    setRow(fingerId, { applyStatus: "stopping", statusDetail: "正在停止…" });
    const status = await onApplyVoltage(fingerId, code);
    setBusy(null);
    if (status.state === "ready") {
      setRow(fingerId, { applied: code, applyStatus: "applied", statusDetail: `已应用（输出等级 ${code}）` });
      setErrors(prev => {
        const next = { ...prev };
        delete next[fingerId];
        return next;
      });
    } else {
      setRow(fingerId, { applyStatus: "failed", statusDetail: `失败，请重试：${status.detail ?? "未知错误"}` });
    }
  };

  const toggleStimulation = async (fingerId: FingerId) => {
    if (busy !== null) return;
    const row = rows[fingerId] ?? emptyRow(undefined);
    if (row.applied === null) return;
    setBusy(fingerId);
    if (row.stimulating) {
      await onStopStimulation(fingerId);
      stimulatingRef.current = null;
      setRow(fingerId, { stimulating: false });
    } else {
      // 切换区域前先停上一个脉冲
      if (stimulatingRef.current !== null && stimulatingRef.current !== fingerId) {
        await onStopStimulation(stimulatingRef.current);
        setRow(stimulatingRef.current, { stimulating: false });
      }
      const status = await onStartStimulation(fingerId, row.applied);
      if (status.state === "ready") {
        stimulatingRef.current = fingerId;
        setRow(fingerId, { stimulating: true });
      } else {
        setRow(fingerId, { applyStatus: "failed", statusDetail: status.detail ?? "开始校准失败" });
      }
    }
    setBusy(null);
  };

  const submit = async () => {
    const nextErrors: Partial<Record<FingerId, string>> = {};
    for (const fingerId of FINGER_IDS) {
      const row = rows[fingerId] ?? emptyRow(undefined);
      if (row.applied === null) nextErrors[fingerId] = "请先输入输出等级并点“确定”。";
    }
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }
    setSubmitError(null);
    if (stimulatingRef.current !== null) {
      const activeFinger = stimulatingRef.current;
      setBusy(activeFinger);
      const stopped = await onStopStimulation(activeFinger);
      setBusy(null);
      if (stopped.state !== "ready") {
        setSubmitError(`停止校准失败：${stopped.detail ?? "未知错误"}`);
        return;
      }
      stimulatingRef.current = null;
      setRow(activeFinger, { stimulating: false });
    }
    if (onEnsureArmed !== undefined) {
      const armed = await onEnsureArmed();
      if (armed.state !== "ready") {
        setSubmitError(`进入游戏前硬件未就绪：${armed.detail ?? "请重新 ARM"}`);
        return;
      }
    }
    const now = new Date().toISOString();
    onValidSubmit(
      FINGER_IDS.map(fingerId => {
        const applied = (rows[fingerId] ?? emptyRow(undefined)).applied ?? 0;
        return {
          fingerId,
          thresholdVoltage: applied,
          selectedVoltage: applied,
          mockTrialOutcome: "not-run",
          recordedAt: now
        };
      })
    );
  };

  const statusText = (row: RowState): string => {
    switch (row.applyStatus) {
      case "stopping":
        return "正在停止…";
      case "sending":
        return "正在发送…";
      case "waiting":
        return "等待硬件确认…";
      case "applied":
        return row.stimulating ? "校准脉冲中" : row.statusDetail;
      case "failed":
        return row.statusDetail;
      default:
        return row.stimulating ? "校准脉冲中" : row.applied !== null ? `已确定输出等级：${row.applied}` : "未确定输出等级";
    }
  };

  return (
    <div>
      <p className="screen-intro">
        请为每个上位机输出区域输入输出等级（0–180）并点“确定”：系统会先停止当前输出，再应用该区域设置，
        并等待硬件确认。“开始校准”控制校准脉冲的通断。没有经过验证的物理电压换算前，本页不显示电压/V。
      </p>
      <div className="calibration-grid">
        {FINGER_IDS.map(fingerId => {
          const row = rows[fingerId] ?? emptyRow(undefined);
          const isBusy = busy === fingerId;
          return (
            <div className="calibration-row" data-testid="calibration-row" key={fingerId}>
              <span className="finger-label">{FINGER_LABELS[fingerId]}</span>
              <label className="field field-inline">
                <span className="visually-hidden">{FINGER_LABELS[fingerId]}输出等级</span>
                <input
                  type="number"
                  min={0}
                  max={180}
                  step={1}
                  inputMode="numeric"
                  placeholder="输出等级（0–180）"
                  aria-label={`${FINGER_LABELS[fingerId]} 输出等级`}
                  value={row.code}
                  onChange={event => setRow(fingerId, { code: event.target.value })}
                />
              </label>
              <button
                type="button"
                className="button button-secondary"
                disabled={isBusy}
                onClick={() => void applyVoltage(fingerId)}
              >
                {row.applyStatus === "applied" ? "已应用" : row.applyStatus === "failed" ? "重试" : "确定"}
              </button>
              <button
                type="button"
                className={row.stimulating ? "button button-danger" : "button button-secondary"}
                disabled={isBusy || row.applied === null}
                onClick={() => void toggleStimulation(fingerId)}
              >
                {row.stimulating ? "停止校准" : "开始校准"}
              </button>
              <span className="calibration-status" role="status">
                {statusText(row)}
              </span>
              {errors[fingerId] !== undefined && <p className="field-error">{errors[fingerId]}</p>}
            </div>
          );
        })}
      </div>
      {submitError !== null && <p className="field-error" role="alert">{submitError}</p>}
      <button type="button" className="button button-primary" disabled={busy !== null} onClick={() => void submit()}>
        继续
      </button>
    </div>
  );
}
