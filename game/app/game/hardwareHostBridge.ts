/**
 * HardwareHost iframe 的消息桥（游戏侧）：整次 R2 会话中唯一能持有 Web Serial
 * 的页面。父页面（R2）通过 postMessage 下发白名单命令；本桥校验 origin、
 * source window、sessionId、协议版本、事务号与 payload 形状后，才路由到
 * HapticSerialHost（协议 v2）。任何校验失败只记录诊断并回复 ERROR。
 */

import type { HapticSerialHost, HapticResult } from "./hapticHost";
import { DEVICE_ERROR_NAMES } from "./hapticHost";

export const HOST_BRIDGE_VERSION = 1 as const;
export const HOST_BRIDGE_SOURCE = "r2-haptic-bridge" as const;
export const HOST_CONTROL_TIMEOUT_MS = 5000;
export const HOST_ARM_ATTEMPT_TIMEOUT_MS = 3000;

export type HostCommand =
  | { kind: "HELLO" }
  | { kind: "GET_STATUS" }
  | { kind: "ARM" }
  | { kind: "SET_CALIBRATION"; regionIndex: number; voltageCode: number }
  | { kind: "START_CALIBRATION"; regionIndex: number }
  | { kind: "PREPARE_SAMPLE"; sampleId: string }
  | { kind: "COMMIT_AFTER"; delayMs: number }
  | { kind: "STOP" };

export type HostCommandEnvelope = {
  source: typeof HOST_BRIDGE_SOURCE;
  protocolVersion: typeof HOST_BRIDGE_VERSION;
  sessionId: string;
  txnId: number;
  type: "HAPTIC_HOST_COMMAND";
  payload: HostCommand;
};

export type HostResponseEnvelope = {
  source: typeof HOST_BRIDGE_SOURCE;
  protocolVersion: typeof HOST_BRIDGE_VERSION;
  sessionId: string;
  txnId: number;
  type: "HAPTIC_HOST_RESPONSE" | "HAPTIC_HOST_EVENT";
  payload:
    | { kind: "RESULT"; result: unknown }
    | { kind: "DEVICE_EVENT"; event: unknown }
    | { kind: "STATUS_CHANGED"; status: HostStatus }
    | { kind: "ERROR"; code: string; message: string };
};

export type HostStatus = {
  connected: boolean;
  armed: boolean;
  busy: boolean;
  voltageCode: number;
  firmware: { fwMajor: number; fwMinor: number; sampleTableVersion: number; dryRun: boolean } | null;
  fault: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

const ALLOWED_COMMANDS = new Set([
  "HELLO",
  "GET_STATUS",
  "ARM",
  "SET_CALIBRATION",
  "START_CALIBRATION",
  "PREPARE_SAMPLE",
  "COMMIT_AFTER",
  "STOP"
]);

/** 校验父页面消息信封；非法来源/会话/版本/形状一律拒绝。 */
export function parseHostCommandEnvelope(
  event: { origin: string; source: unknown; data: unknown },
  parentOrigin: string,
  sessionId: string,
  parentWindow: unknown = typeof window === "undefined" ? null : window.parent
): HostCommandEnvelope | { error: string } {
  if (event.origin !== parentOrigin) return { error: "untrusted origin" };
  if (event.source !== null && event.source !== parentWindow) return { error: "untrusted source window" };
  if (!isRecord(event.data)) return { error: "data is not an object" };
  const data = event.data;
  if (data.source !== HOST_BRIDGE_SOURCE) return { error: "bad source" };
  if (data.protocolVersion !== HOST_BRIDGE_VERSION) return { error: "bad protocol version" };
  if (data.sessionId !== sessionId) return { error: "stale session" };
  if (data.type !== "HAPTIC_HOST_COMMAND") return { error: "not a command" };
  if (typeof data.txnId !== "number") return { error: "missing txn id" };
  if (!isRecord(data.payload) || typeof data.payload.kind !== "string") return { error: "bad payload" };
  if (!ALLOWED_COMMANDS.has(data.payload.kind)) return { error: `command not allowed: ${String(data.payload.kind)}` };
  return data as unknown as HostCommandEnvelope;
}

/** 把命令路由到 HapticSerialHost；结果一律序列化为可 postMessage 的明文结构。 */
export async function executeHostCommand(host: HapticSerialHost, command: HostCommand): Promise<HapticResult<unknown>> {
  switch (command.kind) {
    case "HELLO":
      return host.hello();
    case "GET_STATUS": {
      const result = await host.getStatus(3000);
      return result;
    }
    case "ARM":
      return host.arm(HOST_ARM_ATTEMPT_TIMEOUT_MS);
    case "SET_CALIBRATION": {
      if (!Number.isInteger(command.regionIndex) || command.regionIndex < 0) return { ok: false, error: { code: "PROTOCOL", message: "bad regionIndex" } };
      if (!Number.isInteger(command.voltageCode) || command.voltageCode < 0 || command.voltageCode > 255)
        return { ok: false, error: { code: "PROTOCOL", message: "bad voltageCode" } };
      return host.setCalibration(command.regionIndex, command.voltageCode, HOST_CONTROL_TIMEOUT_MS);
    }
    case "START_CALIBRATION":
      if (!Number.isInteger(command.regionIndex) || command.regionIndex < 0) return { ok: false, error: { code: "PROTOCOL", message: "bad regionIndex" } };
      return host.startCalibration(command.regionIndex, HOST_CONTROL_TIMEOUT_MS);
    case "PREPARE_SAMPLE": {
      if (command.sampleId.length === 0 || command.sampleId.length > 64) return { ok: false, error: { code: "PROTOCOL", message: "bad sampleId" } };
      return host.prepareSample(command.sampleId, HOST_CONTROL_TIMEOUT_MS);
    }
    case "COMMIT_AFTER": {
      if (!Number.isInteger(command.delayMs) || command.delayMs < 0 || command.delayMs > 5000)
        return { ok: false, error: { code: "PROTOCOL", message: "bad delayMs" } };
      return host.commitAfter(command.delayMs);
    }
    case "STOP":
      return host.emergencyStop();
  }
}

export function errorNameOf(code: number): string {
  return DEVICE_ERROR_NAMES[code] ?? `0x${code.toString(16)}`;
}
