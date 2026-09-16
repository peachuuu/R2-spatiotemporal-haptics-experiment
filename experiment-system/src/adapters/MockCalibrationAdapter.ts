import type { FingerId } from "../domain/types";
import type { CalibrationAdapter, DeviceStatus } from "./contracts";

/** Mock 校准接缝：仅写本地动作日志，不接触任何硬件（测试与明确的开发/干跑模式）。 */
export class MockCalibrationAdapter implements CalibrationAdapter {
  readonly actions: string[] = [];

  async getStatus(): Promise<DeviceStatus> {
    return { state: "ready", detail: "模拟校准设备；无电刺激输出" };
  }

  async applyVoltage(input: { fingerId: FingerId; voltageCode: number }): Promise<DeviceStatus> {
    this.actions.push(`apply:${input.fingerId}:${input.voltageCode}`);
    return { state: "ready", detail: "模拟：输出等级已应用" };
  }

  async applyVoltageInPlace(input: { fingerId: FingerId; voltageCode: number }): Promise<DeviceStatus> {
    this.actions.push(`apply-in-place:${input.fingerId}:${input.voltageCode}`);
    return { state: "ready", detail: "模拟：输出等级已就地应用" };
  }

  async startStimulation(input: { fingerId: FingerId; voltageCode: number }): Promise<DeviceStatus> {
    this.actions.push(`start:${input.fingerId}:${input.voltageCode}`);
    return { state: "ready", detail: "模拟刺激已开启（无电刺激输出）" };
  }

  async startStimulationInPlace(input: { fingerId: FingerId; voltageCode: number }): Promise<DeviceStatus> {
    this.actions.push(`start-in-place:${input.fingerId}:${input.voltageCode}`);
    return { state: "ready", detail: "模拟刺激已开启（无电刺激输出）" };
  }

  async stopStimulation(input: { fingerId: FingerId }): Promise<DeviceStatus> {
    this.actions.push(`stop:${input.fingerId}`);
    return { state: "ready", detail: "模拟刺激已停止" };
  }

  async stopStimulationInPlace(input: { fingerId: FingerId }): Promise<DeviceStatus> {
    this.actions.push(`stop-in-place:${input.fingerId}`);
    return { state: "ready", detail: "模拟刺激已停止并恢复 ARM" };
  }

  async finishCalibration(): Promise<DeviceStatus> {
    return { state: "ready", detail: "模拟校准完成，可进入游戏" };
  }
}
