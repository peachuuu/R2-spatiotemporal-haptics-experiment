import { describe, expect, it } from "vitest";
import { HapticSerialHost, type SerialPortLike } from "../../app/game/hapticHost";
import {
  DeviceOp,
  encodeFrame,
  ErrorCode,
  Op
} from "../../app/game/hapticProtocol";

/**
 * 虚拟串口设备：主机写到 writable 的帧进入 pendingWrites；测试把编码好的
 * 设备响应帧推入 readable 流。用于握手、事务匹配、超时、设备错误、
 * 断开与 STOP 优先级的端到端单元验证（不触碰真实串口）。
 */
class FakeSerialPort implements SerialPortLike {
  closed = false;
  writerLocked = false;
  writerReleased = false;
  pendingWrites: Uint8Array[] = [];
  signalUpdates: Array<{ dataTerminalReady?: boolean; requestToSend?: boolean }> = [];
  readonly readable: ReadableStream<Uint8Array>;
  private controller!: ReadableStreamDefaultController<Uint8Array>;

  constructor() {
    this.readable = new ReadableStream<Uint8Array>({
      start: controller => {
        this.controller = controller;
      }
    });
  }

  async open(_options: { baudRate: number }): Promise<void> {}
  async setSignals(signals: { dataTerminalReady?: boolean; requestToSend?: boolean }): Promise<void> {
    this.signalUpdates.push(signals);
  }
  async close(): Promise<void> {
    if (this.writerLocked) throw new Error("writer is still locked");
    this.closed = true;
  }
  getInfo() {
    return { usbVendorId: 0x2e8a, usbProductId: 0x0005 };
  }
  writable = {
    getWriter: () => {
      this.writerLocked = true;
      return {
      write: async (data: Uint8Array) => {
        this.pendingWrites.push(data);
      },
      releaseLock: () => {
        this.writerLocked = false;
        this.writerReleased = true;
      }
    };
    }
  };

  /** 把设备响应帧送入读取流（模拟设备回复）。 */
  pushDeviceFrame(opcode: number, txnId: number, payload: Uint8Array = new Uint8Array(0)): void {
    this.controller.enqueue(encodeFrame(opcode, txnId, payload));
  }

  pushRaw(bytes: Uint8Array): void {
    this.controller.enqueue(bytes);
  }

  closeReadable(): void {
    this.controller.close();
  }

  lastWrite(): { opcode: number; txnId: number; payload: Uint8Array } | null {
    const raw = this.pendingWrites.at(-1);
    if (raw === undefined || raw.length < 10) return null;
    return {
      opcode: raw[3],
      txnId: new DataView(raw.buffer, raw.byteOffset).getUint32(4, true),
      payload: raw.slice(10, 10 + new DataView(raw.buffer, raw.byteOffset).getUint16(8, true))
    };
  }
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0));
const ascii = (s: string) => Uint8Array.from([...s].map(c => c.charCodeAt(0)));
const le32 = (v: number) => new Uint8Array([v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff]);
const HELLO_ACK_PAYLOAD = new Uint8Array([0, 3, 1, 0]);

/** 连接并完成握手；返回已连接的主机。 */
async function connectedHost(port: FakeSerialPort, timeoutMs = 2000): Promise<HapticSerialHost> {
  const host = new HapticSerialHost();
  const connected = host.connect(port, timeoutMs);
  await flush();
  const hello = port.lastWrite();
  if (hello === null || hello.opcode !== Op.HELLO) throw new Error("expected HELLO write");
  port.pushDeviceFrame(DeviceOp.HELLO_ACK, hello.txnId, HELLO_ACK_PAYLOAD);
  const result = await connected;
  if (!result.ok) throw new Error(`handshake failed: ${result.error.message}`);
  return host;
}

describe("HapticSerialHost (protocol v2 transactions)", () => {
  it("performs a HELLO handshake and reports firmware capabilities", async () => {
    const port = new FakeSerialPort();
    const host = new HapticSerialHost();
    const connected = host.connect(port);
    await flush();
    const hello = port.lastWrite();
    expect(hello?.opcode).toBe(Op.HELLO);
    port.pushDeviceFrame(DeviceOp.HELLO_ACK, hello!.txnId, new Uint8Array([0, 3, 1, 0x01]));
    const result = await connected;
    expect(result).toEqual({
      ok: true,
      value: { fwMajor: 0, fwMinor: 3, sampleTableVersion: 1, dryRun: true }
    });
    expect(host.isConnected()).toBe(true);
  });

  it("asserts DTR and RTS before sending HELLO to the RP2 Nano", async () => {
    const port = new FakeSerialPort();
    const host = new HapticSerialHost();
    const connected = host.connect(port);
    await flush();
    expect(port.signalUpdates).toEqual([{ dataTerminalReady: true, requestToSend: true }]);
    const hello = port.lastWrite();
    port.pushDeviceFrame(DeviceOp.HELLO_ACK, hello!.txnId, HELLO_ACK_PAYLOAD);
    await connected;
  });

  it("fails with an explicit result when the device never answers", async () => {
    const port = new FakeSerialPort();
    const host = new HapticSerialHost();
    const connected = host.connect(port, 150);
    const result = await connected;
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("TIMEOUT");
    // 握手失败自动断开
    expect(host.isConnected()).toBe(false);
  });

  it("retries HELLO while the RP2 Nano is still stabilizing after the port opens", async () => {
    const port = new FakeSerialPort();
    const host = new HapticSerialHost();
    const connected = host.connect(port, 25);

    await new Promise(resolve => setTimeout(resolve, 35));
    const helloWrites = port.pendingWrites
      .map(raw => ({
        opcode: raw[3],
        txnId: new DataView(raw.buffer, raw.byteOffset).getUint32(4, true)
      }))
      .filter(frame => frame.opcode === Op.HELLO);
    expect(helloWrites).toHaveLength(2);
    port.pushDeviceFrame(DeviceOp.HELLO_ACK, helloWrites[1]!.txnId, HELLO_ACK_PAYLOAD);

    await expect(connected).resolves.toMatchObject({ ok: true });
    expect(host.isConnected()).toBe(true);
  });

  it("accepts ARM when its acknowledgement was lost but status confirms the device is armed", async () => {
    const port = new FakeSerialPort();
    const host = await connectedHost(port);
    const arming = host.arm(25);

    await new Promise(resolve => setTimeout(resolve, 35));
    const statusRequest = port.lastWrite()!;
    expect(statusRequest.opcode).toBe(Op.GET_STATUS);
    port.pushDeviceFrame(DeviceOp.STATUS, statusRequest.txnId, new Uint8Array([1, 1, 0, 0, 0]));

    await expect(arming).resolves.toEqual({ ok: true, value: undefined });
  });

  it("resolves transactions only on the matching transaction id", async () => {
    const port = new FakeSerialPort();
    const host = await connectedHost(port);

    const armPromise = host.arm(2000);
    await flush();
    const arm = port.lastWrite()!;
    // 先回一个错误事务号：不应解析 arm 事务
    port.pushDeviceFrame(DeviceOp.ARMED, arm.txnId + 1);
    await new Promise(r => setTimeout(r, 20));
    // 再回正确事务号
    port.pushDeviceFrame(DeviceOp.ARMED, arm.txnId);
    const result = await armPromise;
    expect(result).toEqual({ ok: true, value: undefined });
  });

  it("serializes ordinary commands so a keepalive cannot overlap a cue transaction", async () => {
    const port = new FakeSerialPort();
    const host = await connectedHost(port);
    const first = host.getStatus(2000);
    const firstWrite = port.lastWrite()!;
    const second = host.prepareSample("sth.g01.unlock", 2000);
    await flush();
    expect(port.pendingWrites).toHaveLength(2); // HELLO + first GET_STATUS only
    port.pushDeviceFrame(DeviceOp.STATUS, firstWrite.txnId, new Uint8Array([1, 1, 0, 0, 0]));
    await first;
    await flush();
    const secondWrite = port.lastWrite()!;
    expect(secondWrite.opcode).toBe(Op.PREPARE_SAMPLE);
    port.pushDeviceFrame(DeviceOp.PREPARED, secondWrite.txnId, new Uint8Array([...ascii("sth.g01.unlock"), ...le32(5085000)]));
    await expect(second).resolves.toMatchObject({ ok: true });
  });

  it("surfaces structured device errors with their names", async () => {
    const port = new FakeSerialPort();
    const host = await connectedHost(port);

    const prepare = host.prepareSample("07Alf", 2000);
    await flush();
    const sent = port.lastWrite()!;
    expect(sent.opcode).toBe(Op.PREPARE_SAMPLE);
    port.pushDeviceFrame(DeviceOp.ERROR, sent.txnId, new Uint8Array([ErrorCode.SAMPLE_UNDEFINED, ...ascii("07Alf")]));
    const result = await prepare;
    expect(result).toEqual({
      ok: false,
      error: {
        code: "DEVICE_ERROR",
        deviceError: ErrorCode.SAMPLE_UNDEFINED,
        deviceErrorName: "SAMPLE_UNDEFINED",
        message: "SAMPLE_UNDEFINED: 07Alf"
      }
    });
  });

  it("prepares, commits and receives STARTED plus the COMPLETE device event", async () => {
    const port = new FakeSerialPort();
    const host = await connectedHost(port);
    const events: string[] = [];
    host.onDeviceEvent(event => events.push(event.kind));

    const prepared = host.prepareSample("01", 2000);
    await flush();
    const prep = port.lastWrite()!;
    port.pushDeviceFrame(DeviceOp.PREPARED, prep.txnId, new Uint8Array([...ascii("01"), ...le32(5090000)]));
    const preparedResult = await prepared;
    expect(preparedResult).toEqual({ ok: true, value: { sampleId: "01", durationUs: 5090000 } });

    const started = host.commitAfter(150, 4000);
    await flush();
    const commit = port.lastWrite()!;
    expect(commit.opcode).toBe(Op.COMMIT_AFTER);
    port.pushDeviceFrame(DeviceOp.STARTED, commit.txnId, le32(12345678));
    const startedResult = await started;
    expect(startedResult).toEqual({ ok: true, value: { deviceStartUs: 12345678 } });

    // 自然结束的 COMPLETE 是设备主动事件（同一事务号）
    port.pushDeviceFrame(DeviceOp.COMPLETE, commit.txnId, new Uint8Array([...ascii("01"), ...le32(5100000)]));
    await new Promise(r => setTimeout(r, 20));
    expect(events).toContain("COMPLETE");
  });

  it("lets STOP pre-empt a pending commit transaction", async () => {
    const port = new FakeSerialPort();
    const host = await connectedHost(port);

    const prepared = host.prepareSample("01", 2000);
    await flush();
    const prep = port.lastWrite()!;
    port.pushDeviceFrame(DeviceOp.PREPARED, prep.txnId, new Uint8Array([...ascii("01"), ...le32(5090000)]));
    await prepared;

    const commit = host.commitAfter(500, 4000);
    await flush();
    // 挂起期间 STOP：STOP 自己完成，commit 被抢占
    const stop = host.emergencyStop(2000);
    await flush();
    const stopWrite = port.lastWrite()!;
    expect(stopWrite.opcode).toBe(Op.STOP);
    port.pushDeviceFrame(DeviceOp.STOPPED, stopWrite.txnId);
    const stopResult = await stop;
    expect(stopResult).toEqual({ ok: true, value: undefined });
    const commitResult = await commit;
    expect(commitResult.ok).toBe(false);
    if (!commitResult.ok) expect(commitResult.error.code).toBe("PROTOCOL");
  });

  it("disconnects with a best-effort STOP and releases the port", async () => {
    const port = new FakeSerialPort();
    const host = await connectedHost(port);

    await host.disconnect();
    expect(port.closed).toBe(true);
    expect(port.writerReleased).toBe(true);
    expect(host.isConnected()).toBe(false);
    // 断开后任何请求都返回显式失败而不是静默成功
    const status = await host.getStatus(300);
    expect(status.ok).toBe(false);
    if (!status.ok) expect(status.error.code).toBe("NOT_CONNECTED");
  });

  it("marks the host disconnected as soon as the browser read stream ends", async () => {
    const port = new FakeSerialPort();
    const host = await connectedHost(port);

    port.closeReadable();
    await flush();

    expect(host.isConnected()).toBe(false);
    const status = await host.getStatus(300);
    expect(status).toMatchObject({ ok: false, error: { code: "IO" } });
  });

  it("clears a truncated frame before reconnecting so the next HELLO can be decoded", async () => {
    const firstPort = new FakeSerialPort();
    const host = await connectedHost(firstPort);
    // A dropped USB read can leave a complete header that claims a 240-byte
    // payload. Without clearing the decoder, the next connection's HELLO is
    // appended to it and remains invisible until a nonexistent 252 bytes arrive.
    firstPort.pushRaw(new Uint8Array([0x52, 0x32, 1, DeviceOp.STATUS, 0, 0, 0, 0, 240, 0]));
    await flush();
    await host.disconnect();

    const secondPort = new FakeSerialPort();
    const reconnect = host.connect(secondPort, 150);
    await flush();
    const hello = secondPort.lastWrite();
    secondPort.pushDeviceFrame(DeviceOp.HELLO_ACK, hello!.txnId, HELLO_ACK_PAYLOAD);

    await expect(reconnect).resolves.toMatchObject({ ok: true });
  });

  it("encodes every v2 command with the expected opcode and payload", async () => {
    const port = new FakeSerialPort();
    const host = await connectedHost(port);

    const calibration = host.setCalibration(2, 100, 2000);
    await flush();
    let sent = port.lastWrite()!;
    expect(sent.opcode).toBe(Op.SET_CALIBRATION);
    expect([...sent.payload]).toEqual([2, 100]);
    port.pushDeviceFrame(DeviceOp.CALIBRATION_APPLIED, sent.txnId, new Uint8Array([2, 100]));
    await calibration;

    const startCalibration = host.startCalibration(2, 2000);
    await flush();
    sent = port.lastWrite()!;
    expect(sent.opcode).toBe(Op.START_CALIBRATION);
    expect([...sent.payload]).toEqual([2]);
    port.pushDeviceFrame(DeviceOp.CALIBRATION_STARTED, sent.txnId, new Uint8Array([2]));
    await startCalibration;

    const status = host.getStatus(2000);
    await flush();
    sent = port.lastWrite()!;
    expect(sent.opcode).toBe(Op.GET_STATUS);
    port.pushDeviceFrame(DeviceOp.STATUS, sent.txnId, new Uint8Array([1, 1, 0, 0, 0]));
    await status;

    const commit = host.commitAfter(150, 2000);
    await flush();
    sent = port.lastWrite()!;
    expect([...sent.payload]).toEqual([150, 0, 0, 0]);
    port.pushDeviceFrame(DeviceOp.STARTED, sent.txnId, le32(123));
    await commit;
  });
});
