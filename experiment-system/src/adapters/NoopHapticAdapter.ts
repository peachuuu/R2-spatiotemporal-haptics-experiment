import type { CueRequest, HapticAdapter, PreparedCue, DeviceStatus } from "./contracts";

/**
 * 无触觉测试模式（NONE）适配器：
 * - prepareCue 立即返回可起播，但明确标记“无触觉输出”；
 * - commitCue / emergencyStop 为安全空操作；
 * - 不执行任何串口/硬件操作。
 *
 * NONE 是开发/展示模式，不属于正式实验条件；只有显式选择 NONE 才会实例化
 * 本适配器。正式 STH/BH 的硬件失败绝不允许降级到本适配器。
 */
export class NoopHapticAdapter implements HapticAdapter {
  async getStatus(): Promise<DeviceStatus> {
    return { state: "ready", detail: "noop-haptic-disabled" };
  }

  async prepareCue(request: CueRequest): Promise<PreparedCue> {
    return {
      eventId: request.eventId,
      readiness: "ready",
      readyAtMs: request.requestedAtMs,
      recommendedLeadMs: 0,
      detail: "noop-haptic-disabled"
    };
  }

  async commitCue(_eventId: string, _cueAtMs: number): Promise<void> {
    // 无触觉输出；仅保持接口契约。
  }

  async emergencyStop(_reason: string): Promise<void> {
    // 无触觉输出；仅保持接口契约。
  }
}
