import { useEffect, useMemo, useRef } from "react";
import { useStudy } from "../app/StudyContext";
import { MockCalibrationAdapter } from "../adapters/MockCalibrationAdapter";
import { RealCalibrationAdapter, UnavailableCalibrationAdapter } from "../adapters/RealCalibrationAdapter";
import { CalibrationGrid } from "../components/CalibrationGrid";
import { useHardwareHostClient } from "../integration/HardwareHostFrame";
import type { CalibrationRecord, FingerId } from "../domain/types";

/**
 * 阈值校准页：生产模式经持久 HardwareHost 走真实校准适配器
 * （STOP → SET_CALIBRATION → CALIBRATION_APPLIED；断线/未连接显式失败）；
 * 干跑/测试模式使用 Mock。确认后的输出等级与固件版本写入会话快照。
 */
export function CalibrationScreen() {
  const { session, update, advance, logAdapter } = useStudy();
  const hostClient = useHardwareHostClient();
  const adapter = useMemo(() => {
    if (session?.studyMode === "production") {
      return hostClient !== null ? new RealCalibrationAdapter(hostClient) : new UnavailableCalibrationAdapter();
    }
    return new MockCalibrationAdapter();
  }, [hostClient, session?.studyMode]);
  // 后台获取固件/样本表版本（不阻塞"确定"与提交路径）
  const firmwareRef = useRef<{ fwMajor: number; fwMinor: number; sampleTableVersion: number } | null>(null);
  useEffect(() => {
    if (hostClient === null) return;
    void hostClient.hello(1500).then(result => {
      if (result.ok) firmwareRef.current = result.value;
    });
  }, [hostClient]);
  if (session === null) return null;

  const handleApplyVoltage = async (fingerId: FingerId, voltageCode: number) => {
    const status = await adapter.applyVoltage({ fingerId, voltageCode });
    await logAdapter("calibration", "apply-voltage", { fingerId, voltageCode, state: status.state, detail: status.detail ?? "" });
    return status;
  };

  const handleStartStimulation = async (fingerId: FingerId, voltageCode: number) => {
    const status = await adapter.startStimulation({ fingerId, voltageCode });
    await logAdapter("calibration", "start-stimulation", { fingerId, voltageCode, state: status.state });
    return status;
  };

  const handleStopStimulation = async (fingerId: FingerId) => {
    const status = await adapter.stopStimulation({ fingerId });
    await logAdapter("calibration", "stop-stimulation", { fingerId, state: status.state });
    return status;
  };

  const handleEnsureArmed = async () => {
    const status = await adapter.finishCalibration();
    await logAdapter("calibration", "ready-for-game", { state: status.state, detail: status.detail ?? "" });
    return status;
  };

  const submit = async (records: CalibrationRecord[]) => {
    const confirmed = Object.fromEntries(records.map(record => [record.fingerId, record.thresholdVoltage]));
    await update(s => ({
      ...s,
      calibration: records,
      hapticCalibration: {
        confirmed,
        firmware: firmwareRef.current,
        appliedAt: new Date().toISOString()
      }
    }));
    await advance("calibration");
  };

  return (
    <CalibrationGrid
      initialRecords={session.calibration}
      onApplyVoltage={handleApplyVoltage}
      onStartStimulation={handleStartStimulation}
      onStopStimulation={handleStopStimulation}
      onKeepAlive={() => adapter.getStatus()}
      onEnsureArmed={handleEnsureArmed}
      onValidSubmit={records => void submit(records)}
    />
  );
}
