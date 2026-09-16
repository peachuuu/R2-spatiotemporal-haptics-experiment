/**
 * Typed integration seams for future hardware, game engine, and tactile
 * sample players. Current implementations are deterministic mocks; a future
 * integration must inspect the upper-computer project and demo.ino and
 * implement the real handshake behind these interfaces only.
 */

import type { ConditionId, FingerId } from "../domain/types";

export type DeviceState = "ready" | "unavailable" | "error";
export type DeviceStatus = { state: DeviceState; detail?: string };

export type CueRequest = {
  eventId: string;
  patternId: string;
  conditionId: ConditionId;
  requestedAtMs: number;
};

export type PreparedCue = {
  eventId: string;
  readiness: "ready" | "unavailable" | "error";
  readyAtMs: number;
  recommendedLeadMs: number;
  detail?: string;
};

/**
 * Hardware timing contract (§3.3): the flow controller must not assume the
 * Arduino command protocol. It waits for `prepareCue` readiness, then shares
 * one common cue time with the media/game adapter via `commitCue` + notify.
 */
export interface HapticAdapter {
  getStatus(): Promise<DeviceStatus>;
  prepareCue(request: CueRequest): Promise<PreparedCue>;
  commitCue(eventId: string, cueAtMs: number): Promise<void>;
  emergencyStop(reason: string): Promise<void>;
}

/**
 * 校准接缝（v2）："确定" = 校验 → STOP → SET_CALIBRATION → CALIBRATION_APPLIED；
 * "开始/停止校准" = 校准脉冲通断。所有数值语义为 voltageCode（0–255 输出
 * 控制码），在硬件团队提供并验证物理电压换算前不得显示"电压/V"。
 */
export interface CalibrationAdapter {
  getStatus(): Promise<DeviceStatus>;
  /** "确定"：停止当前输出 → 应用该区域的输出等级 → 等待硬件确认。 */
  applyVoltage(input: { fingerId: FingerId; voltageCode: number }): Promise<DeviceStatus>;
  /** 游戏内就地调级：不 STOP、不断联；设备空闲（ARMED_IDLE）时直接下发
   *  SET_CALIBRATION，播放/调度中显式报"设备忙"，绝不掐断当前触觉。 */
  applyVoltageInPlace(input: { fingerId: FingerId; voltageCode: number }): Promise<DeviceStatus>;
  /** 校准脉冲开（使用该区域已应用的输出等级）。 */
  startStimulation(input: { fingerId: FingerId; voltageCode: number }): Promise<DeviceStatus>;
  /** 游戏内脉冲预览开：先就地应用等级（不 STOP），空闲时再触发脉冲。 */
  startStimulationInPlace(input: { fingerId: FingerId; voltageCode: number }): Promise<DeviceStatus>;
  /** 校准脉冲关/紧急停止。 */
  stopStimulation(input: { fingerId: FingerId }): Promise<DeviceStatus>;
  /** 游戏内停止脉冲预览后自动重新 ARM（STOP → ARM），把已解锁设备交回游戏。 */
  stopStimulationInPlace(input: { fingerId: FingerId }): Promise<DeviceStatus>;
  /** 离开校准页前确认设备已安全停止且已 ARM，可交给正式游戏 cue 使用。 */
  finishCalibration(): Promise<DeviceStatus>;
}

export interface GameAdapter {
  getStatus(): Promise<DeviceStatus>;
  startCondition(input: { conditionId: ConditionId; sessionId: string }): Promise<{ startedAt: string }>;
  emitEvent(input: { eventId: string }): Promise<{ eventId: string; atMs: number }>;
  finishCondition(): Promise<{ endedAt: string }>;
}

/** Future media/game side of the shared cue time. */
export interface CueMediaAdapter {
  notifyCue(cue: { eventId: string; cueAtMs: number }): Promise<void>;
}
