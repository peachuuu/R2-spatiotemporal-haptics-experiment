/**
 * 协议 v2 事务主机（Phase 3.1）：与固件 demo.ino 的帧协议逐字节一致
 * （见 hapticProtocol.ts）。每个请求分配递增事务号；只有回显同一事务号的
 * 响应才会解析该事务。STOP 抢占所有挂起事务。断开前尽力发送 STOP 并释放
 * 读写锁。缺少连接时返回显式失败结果，绝不静默成功。
 */

import {
  DeviceOp,
  encodeFrame,
  FrameDecoder,
  Op,
  parseComplete,
  parseError,
  parseHelloAck,
  parseStarted,
  parseStatus,
  parsePrepared,
  payloadCommitAfter,
  payloadPrepareSample,
  payloadSetCalibration,
  payloadStartCalibration
} from "./hapticProtocol";
import { SERIAL_BAUD_RATE } from "./hapticSerial";

export type HostErrorCode =
  | "NOT_CONNECTED"
  | "TIMEOUT"
  | "STOP_PREEMPTED"
  | "DEVICE_ERROR"
  | "PROTOCOL"
  | "IO";

export type HapticResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: HostErrorCode; deviceError?: number; deviceErrorName?: string; message: string } };

const ok = <T>(value: T): HapticResult<T> => ({ ok: true, value });
const fail = <T>(code: HostErrorCode, message: string, deviceError?: number): HapticResult<T> => ({
  ok: false,
  error: {
    code,
    message,
    deviceError,
    deviceErrorName: deviceError !== undefined ? (DEVICE_ERROR_NAMES[deviceError] ?? `0x${deviceError.toString(16)}`) : undefined
  }
});

export const DEVICE_ERROR_NAMES: Record<number, string> = {
  0x01: "BAD_CRC",
  0x02: "BAD_FRAME",
  0x03: "BAD_STATE",
  0x04: "NOT_ARMED",
  0x05: "UNKNOWN_SAMPLE",
  0x06: "SAMPLE_UNDEFINED",
  0x07: "INVALID_ELECTRODE_MAP",
  0x08: "INVALID_OUTPUT",
  0x09: "BUSY",
  0x0a: "WATCHDOG_STOP",
  0x0b: "TIMEOUT"
};

const CONNECT_HELLO_ATTEMPTS = 3;

/** Minimal Web Serial surface so this module also loads where the API is absent. */
export type SerialPortLike = {
  open(options: { baudRate: number }): Promise<void>;
  setSignals?(signals: { dataTerminalReady?: boolean; requestToSend?: boolean }): Promise<void>;
  close(): Promise<void>;
  getInfo(): { usbVendorId?: number; usbProductId?: number };
  writable?: { getWriter(): { write(data: Uint8Array): Promise<void>; releaseLock?(): void } } | null;
  readable?: ReadableStream<Uint8Array> | null;
};

type PendingTransaction = {
  expectedOpcode: number;
  resolve: (frame: { opcode: number; payload: Uint8Array }) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

export type DeviceEvent =
  | { kind: "STARTED"; txnId: number; deviceStartUs: number }
  | { kind: "COMPLETE"; txnId: number; sampleId: string; elapsedUs: number }
  | { kind: "ERROR"; txnId: number; errorCode: number; errorName: string; detail: string }
  | { kind: "unhandled"; opcode: number; txnId: number };

class DeviceError extends Error {
  constructor(readonly code: number, readonly detail: string) {
    super(`${code}: ${detail}`);
  }
}

export class HapticSerialHost {
  private port: SerialPortLike | null = null;
  private writer: { write(data: Uint8Array): Promise<void>; releaseLock?(): void } | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private decoder = new FrameDecoder(event => this.onDecodeEvent(event));
  private txnCounter = 0;
  private pending = new Map<number, PendingTransaction>();
  /** One MCU command at a time; firmware responses are transactional but its output state is serial. */
  private commandTail: Promise<void> = Promise.resolve();
  private connectionGeneration = 0;
  private readLoopActive: Promise<void> | null = null;
  private readLoopCancelled = false;
  /** Browser has ended/errored the read stream; the Port object must no longer
   * be reported as usable while the owner releases it. */
  private transportLost = false;
  private deviceEventListeners = new Set<(event: DeviceEvent) => void>();

  isConnected(): boolean {
    return this.port !== null && !this.transportLost;
  }

  onDeviceEvent(listener: (event: DeviceEvent) => void): () => void {
    this.deviceEventListeners.add(listener);
    return () => this.deviceEventListeners.delete(listener);
  }

  private nextTxn(): number {
    this.txnCounter = (this.txnCounter + 1) & 0x7fffffff;
    if (this.txnCounter === 0) this.txnCounter = 1;
    return this.txnCounter;
  }

  /** 连接 + HELLO 握手；握手失败自动断开并返回错误结果。 */
  async connect(
    port: SerialPortLike,
    timeoutMs = 2000
  ): Promise<HapticResult<{ fwMajor: number; fwMinor: number; sampleTableVersion: number; dryRun: boolean }>> {
    await this.disconnect();
    // A previous USB loss can leave a partial binary frame in the streaming
    // decoder. A new physical connection is a framing boundary.
    this.decoder.reset();
    try {
      await port.open({ baudRate: SERIAL_BAUD_RATE });
      // RP2 Nano 的 USB 串口仅在 DTR/RTS 被置位后接收协议帧。若省略，
      // 浏览器会显示端口已连接，但 HELLO/ARM/STOP 均会超时。
      await port.setSignals?.({ dataTerminalReady: true, requestToSend: true });
    } catch (error) {
      try {
        await port.close();
      } catch {
        // 打开失败时关闭只做资源清理。
      }
      return fail("IO", `串口打开失败：${error instanceof Error ? error.message : String(error)}`);
    }
    this.port = port;
    this.writer = port.writable?.getWriter() ?? null;
    if (this.writer === null) {
      this.port = null;
      return fail("IO", "串口不可写");
    }
    if (port.readable !== undefined && port.readable !== null) {
      this.reader = port.readable.getReader();
    }
    this.readLoopCancelled = false;
    this.transportLost = false;
    if (this.reader !== null) {
      this.readLoopActive = this.readLoop();
    }
    // Opening the RP2 Nano's CDC port can reset/re-enumerate its USB stack.
    // A single HELLO sent immediately after open is therefore not evidence
    // that the cable or firmware is dead. Retry within one bounded connect
    // operation; every attempt has a new transaction id.
    let hello: HapticResult<{ opcode: number; payload: Uint8Array }> = fail("TIMEOUT", "设备启动握手尚未完成");
    for (let attempt = 0; attempt < CONNECT_HELLO_ATTEMPTS; attempt++) {
      hello = await this.request(Op.HELLO, new Uint8Array(0), DeviceOp.HELLO_ACK, timeoutMs);
      if (hello.ok || hello.error.code !== "TIMEOUT") break;
    }
    if (!hello.ok) {
      await this.disconnect();
      return hello as HapticResult<never>;
    }
    return ok(parseHelloAck(hello.value.payload));
  }

  private async readLoop(): Promise<void> {
    try {
      for (;;) {
        if (this.readLoopCancelled || this.reader === null) return;
        const { done, value } = await this.reader.read();
        if (done) {
          if (!this.readLoopCancelled) this.transportLost = true;
          return;
        }
        if (value !== undefined) this.decoder.push(value);
      }
    } catch {
      if (!this.readLoopCancelled) this.transportLost = true;
    }
  }

  private onDecodeEvent(event: { kind: string; frame?: { opcode: number; txnId: number; payload: Uint8Array } }): void {
    if (event.kind !== "frame" || event.frame === undefined) return;
    const frame = event.frame;
    const pending = this.pending.get(frame.txnId);
    if (pending !== undefined) {
      if (frame.opcode === DeviceOp.ERROR) {
        const err = parseError(frame.payload);
        pending.reject(new DeviceError(err.errorCode, err.detail));
      } else if (frame.opcode === pending.expectedOpcode) {
        pending.resolve(frame);
      }
      // 其它操作码：不是本事务期望的响应，保持挂起直到正确响应或超时
      return;
    }
    this.emitDeviceEvent(frame);
  }

  private emitDeviceEvent(frame: { opcode: number; txnId: number; payload: Uint8Array }): void {
    let event: DeviceEvent;
    if (frame.opcode === DeviceOp.STARTED) {
      event = { kind: "STARTED", txnId: frame.txnId, deviceStartUs: parseStarted(frame.payload).deviceStartUs };
    } else if (frame.opcode === DeviceOp.COMPLETE) {
      const info = parseComplete(frame.payload);
      event = { kind: "COMPLETE", txnId: frame.txnId, sampleId: info.sampleId, elapsedUs: info.elapsedUs };
    } else if (frame.opcode === DeviceOp.ERROR) {
      const err = parseError(frame.payload);
      event = {
        kind: "ERROR",
        txnId: frame.txnId,
        errorCode: err.errorCode,
        errorName: DEVICE_ERROR_NAMES[err.errorCode] ?? `0x${err.errorCode.toString(16)}`,
        detail: err.detail
      };
    } else {
      event = { kind: "unhandled", opcode: frame.opcode, txnId: frame.txnId };
    }
    for (const listener of this.deviceEventListeners) listener(event);
  }

  private enqueueCommand<T>(operation: () => Promise<HapticResult<T>>): Promise<HapticResult<T>> {
    const generation = this.connectionGeneration;
    const run = () =>
      generation === this.connectionGeneration
        ? operation()
        : Promise.resolve(fail<T>("NOT_CONNECTED", "串口连接已重置"));
    const result = this.commandTail.then(run, run);
    this.commandTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  /** Writes exactly one protocol transaction; callers use `request` unless STOP must pre-empt. */
  private requestNow(
    opcode: number,
    payload: Uint8Array,
    expectedOpcode: number,
    timeoutMs: number
  ): Promise<HapticResult<{ opcode: number; payload: Uint8Array }>> {
    if (this.transportLost) {
      return Promise.resolve(fail("IO", "串口读取流已断开"));
    }
    if (this.port === null || this.writer === null) {
      return Promise.resolve(fail("NOT_CONNECTED", "串口未连接"));
    }
    const txnId = this.nextTxn();
    return new Promise(resolve => {
      const timer = setTimeout(() => {
        this.pending.delete(txnId);
        resolve(fail("TIMEOUT", `等待设备响应超时（${timeoutMs}ms）`));
      }, timeoutMs);
      this.pending.set(txnId, {
        expectedOpcode,
        timer,
        resolve: frame => {
          clearTimeout(timer);
          this.pending.delete(txnId);
          resolve(ok(frame));
        },
        reject: (error: Error) => {
          clearTimeout(timer);
          this.pending.delete(txnId);
          if (error instanceof DeviceError) {
            resolve(
              fail(
                "DEVICE_ERROR",
                `${DEVICE_ERROR_NAMES[error.code] ?? "device"}${error.detail ? `: ${error.detail}` : ""}`,
                error.code
              )
            );
          } else {
            resolve(fail("PROTOCOL", error.message));
          }
        }
      });
      void this.writer!.write(encodeFrame(opcode, txnId, payload)).catch(error => {
        clearTimeout(timer);
        this.pending.delete(txnId);
        resolve(fail("IO", `写入失败：${error instanceof Error ? error.message : String(error)}`));
      });
    });
  }

  /** 发送请求并等待同事务号的响应；普通命令在同一设备连接内串行执行。 */
  private request(
    opcode: number,
    payload: Uint8Array,
    expectedOpcode: number,
    timeoutMs: number,
  ): Promise<HapticResult<{ opcode: number; payload: Uint8Array }>> {
    return this.enqueueCommand(() => this.requestNow(opcode, payload, expectedOpcode, timeoutMs));
  }

  async hello(timeoutMs = 2000): Promise<HapticResult<{ fwMajor: number; fwMinor: number; sampleTableVersion: number; dryRun: boolean }>> {
    const result = await this.request(Op.HELLO, new Uint8Array(0), DeviceOp.HELLO_ACK, timeoutMs);
    return result.ok ? ok(parseHelloAck(result.value.payload)) : result;
  }

  async arm(timeoutMs = 2000): Promise<HapticResult<void>> {
    const result = await this.request(Op.ARM, new Uint8Array(0), DeviceOp.ARMED, timeoutMs);
    if (result.ok) return ok(undefined);

    // ARM has no stimulation side effect. If its ACK was lost, firmware may
    // already be armed; reconcile through GET_STATUS instead of reporting a
    // false failure or sending a second non-idempotent ARM.
    const mayAlreadyBeArmed =
      result.error.code === "TIMEOUT" ||
      (result.error.code === "DEVICE_ERROR" && result.error.deviceError === 0x03);
    if (mayAlreadyBeArmed) {
      const status = await this.getStatus(timeoutMs);
      if (status.ok && status.value.armed) return ok(undefined);
    }
    return result;
  }

  async getStatus(
    timeoutMs = 2000
  ): Promise<HapticResult<{ state: number; armed: boolean; voltageCode: number; preparedSample: string | null; fault: number }>> {
    const result = await this.request(Op.GET_STATUS, new Uint8Array(0), DeviceOp.STATUS, timeoutMs);
    return result.ok ? ok(parseStatus(result.value.payload)) : result;
  }

  async setCalibration(
    regionIndex: number,
    voltageCode: number,
    timeoutMs = 2000
  ): Promise<HapticResult<{ regionIndex: number; voltageCode: number }>> {
    const result = await this.request(Op.SET_CALIBRATION, payloadSetCalibration(regionIndex, voltageCode), DeviceOp.CALIBRATION_APPLIED, timeoutMs);
    return result.ok
      ? ok({ regionIndex: result.value.payload[0] ?? regionIndex, voltageCode: result.value.payload[1] ?? voltageCode })
      : result;
  }

  async startCalibration(regionIndex: number, timeoutMs = 2000): Promise<HapticResult<{ regionIndex: number }>> {
    const result = await this.request(Op.START_CALIBRATION, payloadStartCalibration(regionIndex), DeviceOp.CALIBRATION_STARTED, timeoutMs);
    return result.ok ? ok({ regionIndex: result.value.payload[0] ?? regionIndex }) : result;
  }

  /** 样本预装载；未提供数据的样本返回 DEVICE_ERROR/SAMPLE_UNDEFINED。 */
  async prepareSample(sampleId: string, timeoutMs = 3000): Promise<HapticResult<{ sampleId: string; durationUs: number }>> {
    const result = await this.request(Op.PREPARE_SAMPLE, payloadPrepareSample(sampleId), DeviceOp.PREPARED, timeoutMs);
    return result.ok ? ok(parsePrepared(result.value.payload)) : result;
  }

  /** 相对延迟后起播；STARTED 在实际起播时到达，超时应包含 delayMs。 */
  async commitAfter(delayMs: number, timeoutMs = 6000): Promise<HapticResult<{ deviceStartUs: number }>> {
    const result = await this.request(Op.COMMIT_AFTER, payloadCommitAfter(delayMs), DeviceOp.STARTED, timeoutMs);
    return result.ok ? ok(parseStarted(result.value.payload)) : result;
  }

  /** 立即停止；同时抢占所有挂起事务（STOP_PREEMPTED）。 */
  async emergencyStop(timeoutMs = 1500): Promise<HapticResult<void>> {
    const pendingTxns = [...this.pending.keys()];
    // STOP bypasses the ordinary queue so it can pre-empt a timed-out cue.
    const result = await this.requestNow(Op.STOP, new Uint8Array(0), DeviceOp.STOPPED, timeoutMs);
    // 无论 STOP 是否被确认，挂起事务一律抢占
    for (const txnId of pendingTxns) {
      const pending = this.pending.get(txnId);
      if (pending !== undefined) pending.reject(new Error("STOP pre-empted"));
    }
    return result.ok ? ok(undefined) : result;
  }

  /** 断开：尽力发送 STOP（短超时），释放读写锁并关闭端口。 */
  async disconnect(): Promise<void> {
    if (this.port === null) return;
    // Invalidate queued GET_STATUS / cue commands before releasing this port.
    this.connectionGeneration++;
    try {
      await this.emergencyStop(500);
    } catch {
      // 尽力而为
    }
    this.readLoopCancelled = true;
    const reader = this.reader;
    const writer = this.writer;
    const readLoop = this.readLoopActive;
    try {
      await reader?.cancel();
    } catch {
      // 忽略
    }
    this.reader = null;
    this.writer = null;
    try {
      writer?.releaseLock?.();
    } catch {
      // 浏览器已释放写锁时无需阻断端口关闭。
    }
    if (readLoop !== null) await readLoop;
    try {
      reader?.releaseLock();
    } catch {
      // 取消读取后已释放时无需阻断端口关闭。
    }
    try {
      await this.port.close();
    } catch {
      // 忽略已分离设备
    }
    this.port = null;
    this.readLoopActive = null;
    this.transportLost = false;
    // Do not let a partial frame survive into a later COM5 reconnect.
    this.decoder.reset();
  }
}
