/**
 * R2 侧 HardwareHost 客户端：向持久的 HardwareHost iframe（游戏源）发送
 * 白名单命令并做事务相关。响应只解析匹配的 transaction id；STOP 抢占所有
 * 挂起事务。所有消息经 postMessage 且 targetOrigin 明确，绝不用 "*"。
 */

import {
  HAPTIC_BRIDGE_VERSION,
  HAPTIC_BRIDGE_SOURCE,
  isHostEnvelope,
  type HostBridgeResponsePayload
} from "./hapticMessages";

export type HostClientStatus = {
  connected: boolean;
  armed: boolean;
  busy: boolean;
  voltageCode: number;
  firmware: { fwMajor: number; fwMinor: number; sampleTableVersion: number; dryRun: boolean } | null;
  fault: number;
};

export type HostClientResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: string; message: string } };

export type HostDeviceEvent =
  | { kind: "STARTED"; txnId: number; deviceStartUs: number }
  | { kind: "COMPLETE"; txnId: number; sampleId: string; elapsedUs: number }
  | { kind: "ERROR"; txnId: number; errorCode: number; errorName: string; detail: string }
  | { kind: "unhandled"; opcode: number; txnId: number };

type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: { code: string; message: string }) => void;
  timer: ReturnType<typeof setTimeout>;
};

const DEFAULT_TIMEOUT_MS = 7000;

export class HardwareHostClient {
  private txnCounter = 0;
  private pending = new Map<number, Pending>();
  private deviceEventListeners = new Set<(event: HostDeviceEvent) => void>();
  private statusListeners = new Set<(status: HostClientStatus) => void>();
  private attached = false;

  constructor(
    private readonly sessionId: string,
    private readonly gameOrigin: string,
    private readonly hostWindow: Window
  ) {}

  attach(): void {
    if (this.attached) return;
    this.attached = true;
    window.addEventListener("message", this.onMessage);
  }

  detach(): void {
    if (!this.attached) return;
    this.attached = false;
    window.removeEventListener("message", this.onMessage);
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject({ code: "HOST_DETACHED", message: "HardwareHost 已卸载" });
    }
    this.pending.clear();
  }

  private onMessage = (event: MessageEvent) => {
    if (event.origin !== this.gameOrigin) return;
    // jsdom 不设置 event.source；真实浏览器中任何非宿主窗口的消息一律拒绝。
    if (event.source !== null && event.source !== this.hostWindow) return;
    const data: unknown = event.data;
    if (!isHostEnvelope<HostBridgeResponsePayload>(data, this.sessionId, "RESPONSE")) return;
    const pending = this.pending.get(data.txnId);
    if (pending === undefined) {
      this.dispatchUnsolicited(data.payload);
      return;
    }
    clearTimeout(pending.timer);
    this.pending.delete(data.txnId);
    if (data.payload.kind === "RESULT") {
      pending.resolve(data.payload.result);
    } else if (data.payload.kind === "ERROR") {
      pending.reject({ code: data.payload.code, message: data.payload.message });
    } else if (data.payload.kind === "STATUS_CHANGED") {
      pending.resolve({ kind: "STATUS_CHANGED", status: data.payload.status });
    } else {
      pending.reject({ code: "PROTOCOL", message: "unexpected response payload" });
    }
  };

  private dispatchUnsolicited(payload: HostBridgeResponsePayload): void {
    if (payload.kind === "DEVICE_EVENT" && typeof payload.event === "object" && payload.event !== null) {
      for (const listener of this.deviceEventListeners) listener(payload.event as HostDeviceEvent);
    } else if (payload.kind === "STATUS_CHANGED") {
      for (const listener of this.statusListeners) listener(payload.status as HostClientStatus);
    }
  }

  onDeviceEvent(listener: (event: HostDeviceEvent) => void): () => void {
    this.deviceEventListeners.add(listener);
    return () => this.deviceEventListeners.delete(listener);
  }

  onStatusChanged(listener: (status: HostClientStatus) => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  private nextTxn(): number {
    this.txnCounter = (this.txnCounter + 1) & 0x7fffffff;
    if (this.txnCounter === 0) this.txnCounter = 1;
    return this.txnCounter;
  }

  private request(payload: unknown, timeoutMs: number): Promise<unknown> {
    const txnId = this.nextTxn();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(txnId);
        reject({ code: "TIMEOUT", message: `等待 HardwareHost 响应超时（${timeoutMs}ms）` });
      }, timeoutMs);
      this.pending.set(txnId, { resolve, reject, timer });
      this.hostWindow.postMessage(
        {
          source: HAPTIC_BRIDGE_SOURCE,
          protocolVersion: HAPTIC_BRIDGE_VERSION,
          sessionId: this.sessionId,
          txnId,
          type: "HAPTIC_HOST_COMMAND",
          payload
        },
        this.gameOrigin
      );
    });
  }

  private async command<T>(payload: unknown, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<HostClientResult<T>> {
    try {
      const result = (await this.request(payload, timeoutMs)) as { ok: true; value: T } | { ok: false; error: { code: string; message: string } };
      return result.ok ? result : { ok: false, error: result.error };
    } catch (error) {
      const err = error as { code?: string; message?: string };
      return { ok: false, error: { code: err.code ?? "IO", message: err.message ?? String(error) } };
    }
  }

  hello(timeoutMs = 7000): Promise<HostClientResult<{ fwMajor: number; fwMinor: number; sampleTableVersion: number; dryRun: boolean }>> {
    return this.command({ kind: "HELLO" }, timeoutMs);
  }

  arm(timeoutMs = 7000): Promise<HostClientResult<void>> {
    return this.command({ kind: "ARM" }, timeoutMs);
  }

  getStatus(timeoutMs = 5000): Promise<HostClientResult<{ state: number; armed: boolean; voltageCode: number; preparedSample: string | null; fault: number }>> {
    return this.command({ kind: "GET_STATUS" }, timeoutMs);
  }

  setCalibration(regionIndex: number, voltageCode: number, timeoutMs = 7000): Promise<HostClientResult<{ regionIndex: number; voltageCode: number }>> {
    return this.command({ kind: "SET_CALIBRATION", regionIndex, voltageCode }, timeoutMs);
  }

  startCalibration(regionIndex: number, timeoutMs = 7000): Promise<HostClientResult<{ regionIndex: number }>> {
    return this.command({ kind: "START_CALIBRATION", regionIndex }, timeoutMs);
  }

  prepareSample(sampleId: string, timeoutMs = 7000): Promise<HostClientResult<{ sampleId: string; durationUs: number }>> {
    return this.command({ kind: "PREPARE_SAMPLE", sampleId }, timeoutMs);
  }

  commitAfter(delayMs: number, timeoutMs = 8000): Promise<HostClientResult<{ deviceStartUs: number }>> {
    return this.command({ kind: "COMMIT_AFTER", delayMs }, timeoutMs);
  }

  /** STOP 抢占：先拒绝全部挂起事务，再发送 STOP。 */
  async emergencyStop(timeoutMs = 3000): Promise<HostClientResult<void>> {
    const pendingTxns = [...this.pending.keys()];
    const result = await this.command<void>({ kind: "STOP" }, timeoutMs);
    for (const txnId of pendingTxns) {
      const pending = this.pending.get(txnId);
      if (pending !== undefined) {
        clearTimeout(pending.timer);
        this.pending.delete(txnId);
        pending.reject({ code: "STOP_PREEMPTED", message: "被 STOP 抢占" });
      }
    }
    return result;
  }
}
