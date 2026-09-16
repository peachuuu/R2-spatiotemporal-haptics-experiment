/**
 * Haptic adapter boundary (design: adapter seam, never inline serial checks).
 *
 * - NONE runs use NoopHapticAdapter: prepareCue resolves playable immediately
 *   with outcome "skipped", never touches Web Serial; commit/stop are recorded
 *   no-ops.
 * - Standalone dev STH/BH runs use DevHapticAdapter: cues resolve "prepared"
 *   so the page stays useful for AV debugging without hardware.
 * - Formal embedded STH/BH will use the HardwareHost adapter (Phase 5); when
 *   its prepare fails (unavailable sample / no hardware / timeout) the cue
 *   action is "pause" and the run must stop with a recoverable operator
 *   error. Formal runs are never auto-downgraded to NONE.
 */

import type { LaunchConfig } from "./types";
import type { CuePoint } from "./hapticSamples";
import { resolveConditionSampleId } from "./hapticSamples";
import { HapticSerialHost, type SerialPortLike } from "./hapticHost";

export type HapticMode = "sth" | "bh" | "none";

export type PrepareCueInput = {
  cue: CuePoint;
  baseSampleId?: string;
  resolvedSampleId?: string;
};

export type PrepareCueResult =
  | { status: "prepared"; outcome: "prepared" | "skipped"; mode: HapticMode; baseSampleId?: string; resolvedSampleId?: string }
  | { status: "unavailable-sample"; baseSampleId?: string; reason: string }
  | { status: "hardware-unavailable"; reason: string };

export type CommitCueResult = { status: "committed" } | { status: "error"; reason: string };

export interface HapticAdapter {
  readonly mode: HapticMode;
  prepareCue(input: PrepareCueInput): Promise<PrepareCueResult>;
  commitCue(input: PrepareCueInput): Promise<CommitCueResult>;
  emergencyStop(reason: string): Promise<void>;
}

export type CueAction = "start" | "pause";

/** A failed prepare must pause a formal run; it must never silently continue. */
export function resolveCueAction(result: PrepareCueResult): CueAction {
  return result.status === "prepared" ? "start" : "pause";
}

/**
 * NONE (无触觉测试模式): AV/输入/判定/时间线完全照常，触觉全部跳过。
 * 本适配器是唯一允许"跳过硬件"的路径，且只能由显式选择 NONE 触发。
 */
export class NoopHapticAdapter implements HapticAdapter {
  readonly mode: HapticMode = "none";

  async prepareCue(input: PrepareCueInput): Promise<PrepareCueResult> {
    return {
      status: "prepared",
      outcome: "skipped",
      mode: "none",
      baseSampleId: input.baseSampleId,
      resolvedSampleId: input.resolvedSampleId
    };
  }

  async commitCue(_input: PrepareCueInput): Promise<CommitCueResult> {
    return { status: "committed" };
  }

  async emergencyStop(_reason: string): Promise<void> {
    // 无串口资源需要释放；保留为可记录空操作。
  }
}

/**
 * 独立开发页的 STH/BH 适配器：开发页不是正式试次，不要求硬件连接；
 * cue 一律按 prepared 记录，便于纯视听调试。正式嵌入运行的硬件门控
 * （Phase 5）会替换为 HardwareHost 适配器。
 */
export class DevHapticAdapter implements HapticAdapter {
  readonly mode: HapticMode;

  constructor(mode: "sth" | "bh") {
    this.mode = mode;
  }

  async prepareCue(input: PrepareCueInput): Promise<PrepareCueResult> {
    return {
      status: "prepared",
      outcome: "prepared",
      mode: this.mode,
      baseSampleId: input.baseSampleId,
      resolvedSampleId: input.resolvedSampleId
    };
  }

  async commitCue(_input: PrepareCueInput): Promise<CommitCueResult> {
    return { status: "committed" };
  }

  async emergencyStop(_reason: string): Promise<void> {
    // 开发页无真实输出；未来切换到真实适配器时此方法负责 STOP+隔离。
  }
}

/**
 * 单游戏预览的真实设备适配器。串口必须由操作者通过“连接触觉设备”按钮
 * 主动选择并 ARM；未连接/未 ARM 一律失败关闭，绝不把 STH/BH 偷换成无触觉。
 */
const previewHost = new HapticSerialHost();

type SerialNavigatorLike = {
  serial?: { requestPort(): Promise<SerialPortLike> };
};

export async function connectPreviewHaptics(): Promise<string> {
  const serial = typeof navigator === "undefined" ? undefined : (navigator as unknown as SerialNavigatorLike).serial;
  if (serial === undefined) throw new Error("当前浏览器不支持 Web Serial，请使用 Chrome 或 Edge。");
  const port = await serial.requestPort();
  const connected = await previewHost.connect(port);
  if (!connected.ok) throw new Error(connected.error.message);
  const armed = await previewHost.arm();
  if (!armed.ok) throw new Error(armed.error.message);
  return `已连接并 ARM：固件 v${connected.value.fwMajor}.${connected.value.fwMinor}`;
}

export function previewHapticsConnected(): boolean {
  return previewHost.isConnected();
}

/** 单游戏预览结束或转入正式系统前调用：STOP、释放 Web Serial 端口。 */
export async function disconnectPreviewHaptics(): Promise<void> {
  await previewHost.disconnect();
}

export class PreviewHardwareHapticAdapter implements HapticAdapter {
  readonly mode: "sth" | "bh";

  constructor(mode: "sth" | "bh") {
    this.mode = mode;
  }

  async prepareCue(input: PrepareCueInput): Promise<PrepareCueResult> {
    if (input.baseSampleId === undefined)
      return { status: "unavailable-sample", reason: "cue 未提供基础样本 ID" };
    if (!previewHost.isConnected())
      return { status: "hardware-unavailable", reason: "触觉设备未连接或未 ARM" };
    const resolvedSampleId = resolveConditionSampleId(input.baseSampleId, this.mode === "sth" ? "STH" : "BH");
    const result = await previewHost.prepareSample(resolvedSampleId);
    if (!result.ok) {
      return {
        status: result.error.code === "DEVICE_ERROR" ? "unavailable-sample" : "hardware-unavailable",
        baseSampleId: input.baseSampleId,
        reason: result.error.message
      };
    }
    return { status: "prepared", outcome: "prepared", mode: this.mode, baseSampleId: input.baseSampleId, resolvedSampleId };
  }

  async commitCue(_input: PrepareCueInput): Promise<CommitCueResult> {
    const result = await previewHost.commitAfter(0);
    return result.ok ? { status: "committed" } : { status: "error", reason: result.error.message };
  }

  async emergencyStop(_reason: string): Promise<void> {
    if (previewHost.isConnected()) await previewHost.emergencyStop();
  }
}

export function hapticModeForCondition(conditionId: LaunchConfig["conditionId"]): HapticMode {
  if (conditionId === "NH") return "none";
  return conditionId === "STH" ? "sth" : "bh";
}

export function createHapticAdapterForConfig(config: LaunchConfig): HapticAdapter {
  const mode = hapticModeForCondition(config.conditionId);
  if (mode === "none") return new NoopHapticAdapter();
  // 嵌入式正式试验由 R2 HardwareHost 统一持有串口；单游戏预览则直接使用
  // 同一 v2 PREPARE/COMMIT 协议连接真实固件，便于验收触发规则。
  return config.mode === "developer" ? new PreviewHardwareHapticAdapter(mode) : new DevHapticAdapter(mode);
}
