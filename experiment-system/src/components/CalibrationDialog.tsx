import { useEffect, useMemo, useRef } from "react";
import { useStudy } from "../app/StudyContext";
import { MockCalibrationAdapter } from "../adapters/MockCalibrationAdapter";
import { RealCalibrationAdapter, UnavailableCalibrationAdapter } from "../adapters/RealCalibrationAdapter";
import { useHardwareHostClient } from "../integration/HardwareHostFrame";
import type { CalibrationRecord, FingerId } from "../domain/types";
import { CalibrationGrid } from "./CalibrationGrid";

/** Reuses the sole HardwareHost connection; it never opens or owns a serial port.
 *  inPlace=true（游戏内）时全程不 STOP：直接 SET_CALIBRATION，设备播放中显式报忙；
 *  脉冲预览停止后自动重新 ARM。绝不断开或掐断现有硬件连接。 */
export function CalibrationDialog({ onClose, inPlace = false }: { onClose: () => void; inPlace?: boolean }) {
  const { session, update, logAdapter } = useStudy();
  const hostClient = useHardwareHostClient();
  const adapter = useMemo(() => session?.studyMode === "production"
    ? hostClient !== null ? new RealCalibrationAdapter(hostClient) : new UnavailableCalibrationAdapter()
    : new MockCalibrationAdapter(), [hostClient, session?.studyMode]);
  const firmwareRef = useRef<{ fwMajor: number; fwMinor: number; sampleTableVersion: number } | null>(null);
  useEffect(() => {
    // RealCalibrationAdapter maps this to the hardware emergency STOP.  The
    // dialog never owns a serial port; it only asks the existing host to stop.
    if (inPlace) return;  // 游戏内就地调级：打开弹窗绝不 STOP，避免掐断当前触觉或断联。
    void adapter.stopStimulation({ fingerId: "left-palm" as FingerId });
  }, [adapter, inPlace]);
  if (session === null) return null;
  const stop = async (fingerId: FingerId) => {
    const status = inPlace ? await adapter.stopStimulationInPlace({ fingerId }) : await adapter.stopStimulation({ fingerId });
    await logAdapter("in-place-calibration", inPlace ? "stop-stimulation-in-place" : "stop-stimulation", { fingerId, state: status.state });
    return status;
  };
  const save = async (records: CalibrationRecord[]) => {
    const confirmed = Object.fromEntries(records.map(record => [record.fingerId, record.thresholdVoltage]));
    await update(s => ({ ...s, calibration: records, hapticCalibration: { confirmed, firmware: firmwareRef.current, appliedAt: new Date().toISOString() } }));
    await close();
  };
  /** 非就地模式离开前确保设备已 ARM：绝不允许把未解锁设备留给后续页面。 */
  const close = async () => {
    if (session?.studyMode === "production" && !inPlace) {
      const status = await adapter.finishCalibration();
      await logAdapter("in-place-calibration", "close-ensure-armed", { state: status.state });
    }
    onClose();
  };
  return <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="阈值校准">
    <section className="modal modal-calibration">
      <h3>阈值校准</h3>
      <p className="screen-intro">校准使用当前“硬件连接”的同一设备。关闭弹窗不会继续游戏或开始下一事件。</p>
      {inPlace && <p className="screen-intro">游戏内调整不会断开硬件连接：设备正在播放时会提示稍候，请等当前事件结束后重试。</p>}
      <CalibrationGrid
        initialRecords={session.calibration}
        onApplyVoltage={async (fingerId, voltageCode) => { const status = inPlace ? await adapter.applyVoltageInPlace({ fingerId, voltageCode }) : await adapter.applyVoltage({ fingerId, voltageCode }); await logAdapter("in-place-calibration", inPlace ? "apply-voltage-in-place" : "apply-voltage", { fingerId, voltageCode, state: status.state }); return status; }}
        onStartStimulation={async (fingerId, voltageCode) => { const status = inPlace ? await adapter.startStimulationInPlace({ fingerId, voltageCode }) : await adapter.startStimulation({ fingerId, voltageCode }); await logAdapter("in-place-calibration", inPlace ? "start-stimulation-in-place" : "start-stimulation", { fingerId, voltageCode, state: status.state }); return status; }}
        onStopStimulation={stop}
        onKeepAlive={() => adapter.getStatus()}
        onEnsureArmed={async () => { const status = await adapter.finishCalibration(); await logAdapter("in-place-calibration", "ready", { state: status.state }); return status; }}
        onValidSubmit={records => void save(records)}
      />
      <button type="button" className="button button-secondary" onClick={() => void close()}>关闭校准</button>
    </section>
  </div>;
}
