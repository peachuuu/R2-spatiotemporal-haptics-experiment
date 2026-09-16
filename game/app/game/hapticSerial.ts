/**
 * Game-side serial bridge to the RP2040 RS485 electrotactile stimulator.
 *
 * LEGACY-DIAGNOSTIC ONLY (2026-08-26): the single-byte 0x01–0x0B protocol and
 * the 0xA5 voltage frame are superseded by protocol v2 (hapticProtocol.ts)
 * with PREPARE/COMMIT/STOP semantics. Production cue routing no longer calls
 * dispatchSample; the remaining exports exist solely for the legacy
 * diagnostic surface and must not be extended.
 *
 * The operator connects a local serial port on the global settings page
 * (/?mode=serial). Electrical output stays disabled until the operator
 * explicitly enables it — matching the project rule that real hardware
 * commands sit behind an adapter seam and are only activated deliberately.
 */

/** Fixed baud rate for both firmware and web sides; deliberately not user-facing. */
export const SERIAL_BAUD_RATE = 115200;

/** Protocol (mirrors rp2040_rs485_stim.ino). */
export const CMD_STOP = 0x00;
export const CMD_VOLTAGE_HEAD = 0xa5;
export const CMD_VOLTAGE_OP = 0x01;
export const ACK_VOLTAGE = "A";
export const ACK_EVENT = "K";
export const ACK_STOP = "S";
export const ACK_ERROR = "E";

/** Single-byte event notifications; keys are the game's haptic sample keys. */
export const HAPTIC_EVENT_BYTES: Record<string, number> = {
  "mechanism-unlock": 0x01,
  "landing-rubble": 0x02,
  "fire-burn": 0x03,
  "ghost-pass": 0x04,
  "chest-cue": 0x05,
  "ridge-unlock": 0x06,
  "projectile-pass": 0x07,
  "danger-area-expand": 0x08,
  rain: 0x09,
  fireworks: 0x0a,
  /** 完整时空触觉样本（5.09s 时间线），固件内置；其余事件的真实映射待替换。 */
  spatiotemporal: 0x0b
};

export const EVENT_NAMES: Record<number, string> = Object.fromEntries(
  Object.entries(HAPTIC_EVENT_BYTES).map(([name, byte]) => [byte, name])
);

export function sampleKeyToEventByte(sampleKey: string): number | undefined {
  if (sampleKey === "none") return undefined;
  return HAPTIC_EVENT_BYTES[sampleKey];
}

/** 电压设置帧：0xA5 0x01 <V>。V 被截断到 0..255。 */
export function encodeVoltageCommand(value: number): Uint8Array {
  const clamped = Math.max(0, Math.min(255, Math.round(value)));
  return new Uint8Array([CMD_VOLTAGE_HEAD, CMD_VOLTAGE_OP, clamped]);
}

/** Minimal Web Serial surface so this module also loads where the API is absent. */
type SerialPortLike = {
  open(options: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  getInfo(): { usbVendorId?: number; usbProductId?: number };
  writable?: { getWriter(): { write(data: Uint8Array): Promise<void> } } | null;
};

type SerialNavigatorLike = {
  serial?: {
    requestPort(options?: Record<string, never>): Promise<SerialPortLike>;
    getPorts(): Promise<SerialPortLike[]>;
  };
};

type StatusListener = (status: { connected: boolean; portLabel: string | null; enabled: boolean }) => void;

export class HapticSerialManager {
  private port: SerialPortLike | null = null;
  private writer: { write(data: Uint8Array): Promise<void> } | null = null;
  private listeners = new Set<StatusListener>();

  /** Operator-controlled master switch; off by default for safety. */
  enabled = false;

  supported(): boolean {
    return typeof navigator !== "undefined" && !!(navigator as unknown as SerialNavigatorLike).serial;
  }

  isConnected(): boolean {
    return this.port !== null;
  }

  subscribe(listener: StatusListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    const status = {
      connected: this.port !== null,
      portLabel: this.portLabel(),
      enabled: this.enabled
    };
    for (const listener of this.listeners) listener(status);
  }

  portLabel(): string | null {
    if (this.port === null) return null;
    const info = this.port.getInfo();
    if (info.usbVendorId !== undefined && info.usbProductId !== undefined) {
      return `USB ${info.usbVendorId.toString(16)}:${info.usbProductId.toString(16)}`;
    }
    return "串口";
  }

  /** 用户在设置页点击“选择串口”后调用（浏览器要求用户手势）。 */
  async requestPortAndConnect(): Promise<void> {
    const serial = (navigator as unknown as SerialNavigatorLike).serial;
    if (serial === undefined) throw new Error("当前浏览器不支持 Web Serial");
    const port = await serial.requestPort();
    await this.connect(port);
  }

  async connect(port: SerialPortLike): Promise<void> {
    await this.disconnect();
    await port.open({ baudRate: SERIAL_BAUD_RATE });
    this.port = port;
    this.writer = port.writable?.getWriter() ?? null;
    this.emit();
  }

  async disconnect(): Promise<void> {
    if (this.port === null) return;
    try {
      await this.writer?.write(new Uint8Array([CMD_STOP]));
    } catch {
      // The port may already be gone; closing is what matters.
    }
    this.writer = null;
    try {
      await this.port.close();
    } catch {
      // Ignore close errors from an already-detached device.
    }
    this.port = null;
    this.emit();
  }

  private async write(bytes: Uint8Array): Promise<void> {
    if (this.port === null || this.writer === null) throw new Error("串口未连接");
    await this.writer.write(bytes);
  }

  /** 电压设置（0..255；0 = 关闭输出）。 */
  async setVoltage(value: number): Promise<void> {
    await this.write(encodeVoltageCommand(value));
  }

  /** 单字节事件通知：固件收到即打断当前刺激并转入新事件。 */
  async sendEventByte(eventByte: number): Promise<void> {
    if (eventByte < 0 || eventByte > 0xff) throw new Error("事件字节超出范围");
    await this.write(new Uint8Array([eventByte]));
  }

  /** 立即停止（0x00）。 */
  async stop(): Promise<void> {
    await this.write(new Uint8Array([CMD_STOP]));
  }

  /**
   * 游戏事件钩子：把触觉样本键转换为事件字节并发送。
   * 仅在“已连接且操作员已开启输出”时生效；发送失败只写诊断，绝不阻塞游戏。
   */
  async dispatchSample(sampleKey: string): Promise<void> {
    if (!this.enabled || this.port === null) return;
    const eventByte = sampleKeyToEventByte(sampleKey);
    if (eventByte === undefined) return;
    try {
      await this.write(new Uint8Array([eventByte]));
    } catch {
      // A disconnected device must never break gameplay; the settings page
      // shows the connection state for the operator.
    }
  }
}

/** 全局单例：设置页与游戏事件共用同一条串口连接。 */
export const hapticSerial = new HapticSerialManager();
