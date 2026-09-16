import type { FingerId } from "../domain/types";
import { CALIBRATION_HARDWARE_MAP } from "../domain/calibrationHardwareMap";
import type { HardwareHostClient } from "../integration/hardwareHostClient";
import type { CalibrationAdapter, DeviceStatus } from "./contracts";

/**
 * 真实校准适配器：经 HardwareHost 下发协议 v2 命令。
 * - applyVoltage：STOP → ARM → SET_CALIBRATION → 等待
 *   CALIBRATION_APPLIED；任何一步失败返回 error/不可用并保证已 STOP。
 * - startStimulation：START_CALIBRATION（该区域已应用输出等级的短脉冲）；
 * - stopStimulation：STOP（立即隔离）。
 * 电极参考对只在固件 CALIBRATION_REGIONS 决定；R2 仅发送与固件同序的
 * regionIndex。硬件电压轨并非十条独立通道：拇/食、中/无名共享各自通道。
 */
export class RealCalibrationAdapter implements CalibrationAdapter {
  constructor(private readonly host: HardwareHostClient) {}

  private regionIndexOf(fingerId: FingerId): number {
    return CALIBRATION_HARDWARE_MAP[fingerId].regionIndex;
  }

  async getStatus(): Promise<DeviceStatus> {
    const result = await this.host.getStatus(5000);
    if (!result.ok) return { state: "unavailable", detail: result.error.message };
    return {
      state: result.value.armed ? "ready" : "unavailable",
      detail: result.value.armed ? undefined : "硬件未 ARM：请操作员在硬件连接页面连接并 ARM"
    };
  }

  async applyVoltage(input: { fingerId: FingerId; voltageCode: number }): Promise<DeviceStatus> {
    if (!Number.isInteger(input.voltageCode) || input.voltageCode < 0 || input.voltageCode > 180) {
      return { state: "error", detail: "输出等级必须是 0–180 的整数" };
    }
    // 1. 先停止当前输出
    const stop = await this.host.emergencyStop(3000);
    if (!stop.ok) return { state: "error", detail: `停止当前输出失败：${stop.error.message}` };
    // STOP 将固件置于安全且未 ARM 状态；必须重新 ARM 才能应用新等级。
    const armed = await this.host.arm(7000);
    if (!armed.ok) return { state: "error", detail: `重新 ARM 失败：${armed.error.message}` };
    // 2. 应用输出等级
    const applied = await this.host.setCalibration(this.regionIndexOf(input.fingerId), input.voltageCode, 7000);
    if (!applied.ok) return { state: "error", detail: applied.error.message };
    return {
      state: "ready",
      detail: `已应用（共享输出通道：${CALIBRATION_HARDWARE_MAP[input.fingerId].sharedChannelLabel}）`
    };
  }

  async applyVoltageInPlace(input: { fingerId: FingerId; voltageCode: number }): Promise<DeviceStatus> {
    if (!Number.isInteger(input.voltageCode) || input.voltageCode < 0 || input.voltageCode > 180) {
      return { state: "error", detail: "输出等级必须是 0–180 的整数" };
    }
    const status = await this.host.getStatus(5000);
    if (!status.ok) return { state: "unavailable", detail: `硬件状态不可用：${status.error.message}` };
    if (!status.value.armed) return { state: "unavailable", detail: "硬件未 ARM：请操作员在硬件连接页面连接并 ARM" };
    // 固件状态 1 = ARMED_IDLE；播放/调度/准备中一律不就地修改，避免掐断当前触觉。
    if (status.value.state !== 1) return { state: "error", detail: "设备正在播放触觉，请等当前事件结束后重试" };
    const applied = await this.host.setCalibration(this.regionIndexOf(input.fingerId), input.voltageCode, 7000);
    if (!applied.ok) return { state: "error", detail: applied.error.message };
    return {
      state: "ready",
      detail: `已应用（共享输出通道：${CALIBRATION_HARDWARE_MAP[input.fingerId].sharedChannelLabel}）`
    };
  }

  async startStimulation(input: { fingerId: FingerId; voltageCode: number }): Promise<DeviceStatus> {
    // 校准脉冲使用固件侧该区域已应用的输出等级；这里先应用再触发脉冲。
    const applied = await this.applyVoltage(input);
    if (applied.state !== "ready") return applied;
    const started = await this.host.startCalibration(this.regionIndexOf(input.fingerId), 7000);
    if (!started.ok) return { state: "error", detail: started.error.message };
    return { state: "ready", detail: "校准脉冲已开始" };
  }

  async startStimulationInPlace(input: { fingerId: FingerId; voltageCode: number }): Promise<DeviceStatus> {
    const applied = await this.applyVoltageInPlace(input);
    if (applied.state !== "ready") return applied;
    const started = await this.host.startCalibration(this.regionIndexOf(input.fingerId), 7000);
    if (!started.ok) return { state: "error", detail: started.error.message };
    return { state: "ready", detail: "校准脉冲已开始" };
  }

  async stopStimulation(_input: { fingerId: FingerId }): Promise<DeviceStatus> {
    const stop = await this.host.emergencyStop(3000);
    if (!stop.ok) return { state: "error", detail: stop.error.message };
    return { state: "ready", detail: "已停止并隔离" };
  }

  async stopStimulationInPlace(_input: { fingerId: FingerId }): Promise<DeviceStatus> {
    const stop = await this.host.emergencyStop(3000);
    if (!stop.ok) return { state: "error", detail: stop.error.message };
    const armed = await this.host.arm(7000);
    if (!armed.ok) return { state: "error", detail: `脉冲已停止，但重新 ARM 失败：${armed.error.message}` };
    return { state: "ready", detail: "已停止脉冲并恢复 ARM" };
  }

  async finishCalibration(): Promise<DeviceStatus> {
    const current = await this.host.getStatus(5000);
    if (!current.ok) return { state: "unavailable", detail: current.error.message };
    if (current.value.armed) return { state: "ready", detail: "硬件已 ARM，可进入游戏" };
    const armed = await this.host.arm(7000);
    if (!armed.ok) return { state: "error", detail: `进入游戏前 ARM 失败：${armed.error.message}` };
    return { state: "ready", detail: "硬件已 ARM，可进入游戏" };
  }
}

/** 生产模式下硬件连接缺失/不可用时的显式失败适配器（绝不静默成功）。 */
export class UnavailableCalibrationAdapter implements CalibrationAdapter {
  async getStatus(): Promise<DeviceStatus> {
    return { state: "unavailable", detail: "硬件连接未建立" };
  }

  async applyVoltage(): Promise<DeviceStatus> {
    return { state: "unavailable", detail: "硬件连接未建立：无法应用输出等级" };
  }

  async applyVoltageInPlace(): Promise<DeviceStatus> {
    return { state: "unavailable", detail: "硬件连接未建立：无法就地调整输出等级" };
  }

  async startStimulation(): Promise<DeviceStatus> {
    return { state: "unavailable", detail: "硬件连接未建立：无法开始校准脉冲" };
  }

  async startStimulationInPlace(): Promise<DeviceStatus> {
    return { state: "unavailable", detail: "硬件连接未建立：无法开始脉冲预览" };
  }

  async stopStimulation(): Promise<DeviceStatus> {
    return { state: "unavailable", detail: "硬件连接未建立" };
  }

  async stopStimulationInPlace(): Promise<DeviceStatus> {
    return { state: "unavailable", detail: "硬件连接未建立：无法恢复 ARM" };
  }

  async finishCalibration(): Promise<DeviceStatus> {
    return { state: "unavailable", detail: "硬件连接未建立" };
  }
}
