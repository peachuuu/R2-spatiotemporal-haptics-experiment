import { describe, expect, it } from "vitest";
import {
  crc16Ccitt,
  decodeAscii,
  DeviceOp,
  encodeAscii,
  encodeFrame,
  ErrorCode,
  FrameDecoder,
  frameToHex,
  HAPTIC_PROTOCOL_VERSION,
  Op,
  parseComplete,
  parseError,
  parseHelloAck,
  parsePrepared,
  parseStarted,
  parseStatus,
  payloadCommitAfter,
  payloadPrepareSample,
  payloadSetCalibration
} from "../../app/game/hapticProtocol";

const hex = (bytes: Uint8Array) => Array.from(bytes, b => b.toString(16).padStart(2, "0")).join(" ");

describe("protocol v2 framing", () => {
  it("matches the frozen golden vectors byte for byte", () => {
    // Golden vectors are shared with the RP2040 firmware tests.
    expect(hex(encodeFrame(Op.HELLO, 1))).toBe("52 32 01 01 01 00 00 00 00 00 48 51");
    expect(hex(encodeFrame(Op.PREPARE_SAMPLE, 2, payloadPrepareSample("07Alf")))).toBe(
      "52 32 01 06 02 00 00 00 05 00 30 37 41 6c 66 ba 44"
    );
    expect(
      hex(encodeFrame(DeviceOp.PREPARED, 2, concatBytes(payloadPrepareSample("07Alf"), new Uint8Array([0x40, 0x0d, 0x03, 0x00]))))
    ).toBe("52 32 01 86 02 00 00 00 09 00 30 37 41 6c 66 40 0d 03 00 75 1f");
    expect(hex(encodeFrame(Op.COMMIT_AFTER, 3, payloadCommitAfter(150)))).toBe(
      "52 32 01 07 03 00 00 00 04 00 96 00 00 00 5a 7f"
    );
    expect(hex(encodeFrame(Op.STOP, 4))).toBe("52 32 01 08 04 00 00 00 00 00 85 39");
    expect(hex(encodeFrame(DeviceOp.ERROR, 5, concatBytes(new Uint8Array([ErrorCode.SAMPLE_UNDEFINED]), encodeAscii("01"))))).toBe(
      "52 32 01 8a 05 00 00 00 03 00 06 30 31 51 11"
    );
    expect(hex(encodeFrame(Op.SET_CALIBRATION, 6, payloadSetCalibration(2, 100)))).toBe(
      "52 32 01 04 06 00 00 00 02 00 02 64 be e3"
    );
  });

  it("encodes version, opcode, transaction id and little-endian payload length", () => {
    const frame = encodeFrame(Op.COMMIT_AFTER, 0x01020304, payloadCommitAfter(150));
    expect(frame[0]).toBe(0x52);
    expect(frame[1]).toBe(0x32);
    expect(frame[2]).toBe(HAPTIC_PROTOCOL_VERSION);
    expect(frame[3]).toBe(Op.COMMIT_AFTER);
    expect(new DataView(frame.buffer).getUint32(4, true)).toBe(0x01020304);
    expect(new DataView(frame.buffer).getUint16(8, true)).toBe(4);
    expect(Array.from(frame.subarray(10, 14))).toEqual([150, 0, 0, 0]);
  });

  it("computes the documented CRC16-CCITT check value", () => {
    // Standard check: CRC16-CCITT of "123456789" == 0x29B1.
    expect(crc16Ccitt(encodeAscii("123456789"))).toBe(0x29b1);
  });

  it("round-trips a PREPARE_SAMPLE frame with its case-sensitive sample id", () => {
    const events: Array<{ opcode: number; txnId: number; payload: Uint8Array }> = [];
    const decoder = new FrameDecoder(event => {
      if (event.kind === "frame") events.push({ opcode: event.frame.opcode, txnId: event.frame.txnId, payload: event.frame.payload });
    });
    decoder.push(encodeFrame(Op.PREPARE_SAMPLE, 42, payloadPrepareSample("07Alf")));
    expect(events).toHaveLength(1);
    expect(events[0]?.opcode).toBe(Op.PREPARE_SAMPLE);
    expect(events[0]?.txnId).toBe(42);
    expect(decodeAscii(events[0]!.payload)).toBe("07Alf");
  });

  it("decodes byte-by-byte fragmented input", () => {
    const frame = encodeFrame(Op.STOP, 7);
    const received: number[] = [];
    const decoder = new FrameDecoder(event => {
      if (event.kind === "frame") received.push(event.frame.opcode);
    });
    for (const byte of frame) decoder.push(new Uint8Array([byte]));
    expect(received).toEqual([Op.STOP]);
  });

  it("decodes two concatenated frames in one chunk", () => {
    const a = encodeFrame(Op.ARM, 1);
    const b = encodeFrame(Op.STOP, 2);
    const events: number[] = [];
    const decoder = new FrameDecoder(event => {
      if (event.kind === "frame") events.push(event.frame.opcode);
    });
    decoder.push(new Uint8Array([...a, ...b]));
    expect(events).toEqual([Op.ARM, Op.STOP]);
  });

  it("reports a bad CRC and resynchronises at the next MAGIC", () => {
    const good = encodeFrame(Op.STOP, 9);
    const corrupted = encodeFrame(Op.ARM, 8);
    corrupted[corrupted.length - 1] ^= 0xff; // flip CRC byte
    const stream = new Uint8Array([0xde, 0xad, ...corrupted, ...good]);
    const events: string[] = [];
    const decoder = new FrameDecoder(event => {
      events.push(event.kind === "frame" ? `frame:${event.frame.opcode}` : event.kind);
    });
    decoder.push(stream);
    expect(events).toEqual(["bad-crc", "frame:8"]);
  });

  it("reports unknown opcodes without breaking the stream", () => {
    const unknown = encodeFrame(0x7f as never, 1);
    const good = encodeFrame(Op.STOP, 2);
    const events: string[] = [];
    const decoder = new FrameDecoder(event => {
      events.push(event.kind === "frame" ? `frame:${event.frame.opcode}` : `unknown:${event.kind === "unknown-opcode" ? event.opcode : ""}`);
    });
    decoder.push(new Uint8Array([...unknown, ...good]));
    expect(events).toEqual(["unknown:127", "frame:8"]);
  });

  it("parses structured response payloads", () => {
    const prepared = parsePrepared(concatBytes(payloadPrepareSample("B07Alf"), new Uint8Array([0x40, 0x0d, 0x03, 0x00])));
    expect(prepared).toEqual({ sampleId: "B07Alf", durationUs: 0x00030d40 });
    const started = parseStarted(new Uint8Array([0x78, 0x56, 0x34, 0x12]));
    expect(started.deviceStartUs).toBe(0x12345678);
    const complete = parseComplete(concatBytes(encodeAscii("09"), new Uint8Array([0x10, 0x27, 0x00, 0x00])));
    expect(complete).toEqual({ sampleId: "09", elapsedUs: 0x2710 });
    const error = parseError(new Uint8Array([ErrorCode.SAMPLE_UNDEFINED, ...encodeAscii("01")]));
    expect(error).toEqual({ errorCode: ErrorCode.SAMPLE_UNDEFINED, detail: "01" });
    const hello = parseHelloAck(new Uint8Array([1, 2, 3, 0x01]));
    expect(hello).toEqual({ fwMajor: 1, fwMinor: 2, sampleTableVersion: 3, dryRun: true });
    const status = parseStatus(new Uint8Array([4, 1, 77, 2, ...encodeAscii("07"), 0]));
    expect(status).toEqual({ state: 4, armed: true, voltageCode: 77, preparedSample: "07", fault: 0 });
  });

  it("rejects payloads above the maximum frame length", () => {
    expect(() => encodeFrame(Op.PREPARE_SAMPLE, 1, new Uint8Array(241))).toThrow(/payload too long/);
  });

  it("keeps sample ids ASCII-only", () => {
    expect(() => encodeAscii("样本")).toThrow(/non-ASCII/);
  });

  it("renders frames as readable hex for diagnostics", () => {
    expect(frameToHex(encodeFrame(Op.HELLO, 1))).toBe("52 32 01 01 01 00 00 00 00 00 48 51");
  });
});

function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}
