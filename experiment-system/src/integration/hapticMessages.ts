/**
 * R2 ↔ HardwareHost 语义消息契约。
 *
 * - 信封（postMessage）：source/protocolVersion/sessionId/txnId + 方向。
 * - COMMAND 方向 payload 是白名单命令；
 * - RESPONSE 方向 payload 是桥级包装：RESULT（内含设备级语义响应）、
 *   DEVICE_EVENT、STATUS_CHANGED 或桥级 ERROR。
 * 设备级语义（HELLO_ACK/ARMED/PREPARED/...）通过 RESULT.result 承载。
 */

export const HAPTIC_BRIDGE_VERSION = 1 as const;
export const HAPTIC_BRIDGE_SOURCE = "r2-haptic-bridge" as const;

/** 设备状态（STATUS.state，镜像固件状态机）。 */
export const DEVICE_STATES = [
  "DISCONNECTED",
  "CONNECTED_SAFE",
  "ARMED_IDLE",
  "PREPARING",
  "PREPARED",
  "SCHEDULED",
  "PLAYING",
  "FAULT"
] as const;
export type DeviceState = (typeof DEVICE_STATES)[number];

/** 设备级语义响应（RESULT.result 的内容）。 */
export type HostResponse =
  | {
      kind: "HELLO_ACK";
      fwMajor: number;
      fwMinor: number;
      sampleTableVersion: number;
      dryRun: boolean;
    }
  | { kind: "STATUS"; state: number; armed: boolean; voltageCode: number; preparedSample: string | null; fault: number }
  | { kind: "ARMED" }
  | { kind: "CALIBRATION_APPLIED"; regionIndex: number; voltageCode: number }
  | { kind: "CALIBRATION_STARTED"; regionIndex: number }
  | { kind: "PREPARED"; sampleId: string; durationUs: number }
  | { kind: "STARTED"; deviceStartUs: number }
  | { kind: "COMPLETE"; sampleId: string; elapsedUs: number }
  | { kind: "STOPPED" }
  | { kind: "ERROR"; errorCode: number; errorName: string; detail: string };

/** 桥级 RESPONSE 载荷。 */
export type HostBridgeResponsePayload =
  | { kind: "RESULT"; result: unknown }
  | { kind: "DEVICE_EVENT"; event: unknown }
  | { kind: "STATUS_CHANGED"; status: unknown }
  | { kind: "ERROR"; code: string; message: string };

export type HostCommandPayload =
  | { kind: "HELLO" }
  | { kind: "GET_STATUS" }
  | { kind: "ARM" }
  | { kind: "SET_CALIBRATION"; regionIndex: number; voltageCode: number }
  | { kind: "START_CALIBRATION"; regionIndex: number }
  | { kind: "PREPARE_SAMPLE"; sampleId: string }
  | { kind: "COMMIT_AFTER"; delayMs: number }
  | { kind: "STOP" };

export type HostEnvelope<T> = {
  source: typeof HAPTIC_BRIDGE_SOURCE;
  protocolVersion: typeof HAPTIC_BRIDGE_VERSION;
  sessionId: string;
  txnId: number;
  type: "HAPTIC_HOST_COMMAND" | "HAPTIC_HOST_RESPONSE";
  payload: T;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** 拒绝外来来源、版本或会话的消息。 */
export function isHostEnvelope<T = unknown>(
  data: unknown,
  sessionId: string,
  direction: "COMMAND" | "RESPONSE"
): data is HostEnvelope<T> {
  if (!isRecord(data)) return false;
  if (data.source !== HAPTIC_BRIDGE_SOURCE) return false;
  if (data.protocolVersion !== HAPTIC_BRIDGE_VERSION) return false;
  if (data.sessionId !== sessionId) return false;
  if (typeof data.txnId !== "number") return false;
  return data.type === (direction === "COMMAND" ? "HAPTIC_HOST_COMMAND" : "HAPTIC_HOST_RESPONSE");
}

export type CommandEnvelope = HostEnvelope<HostCommandPayload>;
export type ResponseEnvelope = HostEnvelope<HostBridgeResponsePayload>;

/** 事务相关：响应只解析自己的事务号；期望载荷 kind 不匹配视为 mismatch。 */
export function matchTransaction(
  envelope: ResponseEnvelope,
  expectedTxnId: number,
  expectedPayloadKind?: string
): { kind: "match"; payload: HostBridgeResponsePayload } | { kind: "mismatch" } {
  if (envelope.txnId !== expectedTxnId) return { kind: "mismatch" };
  if (expectedPayloadKind !== undefined && envelope.payload.kind !== expectedPayloadKind) return { kind: "mismatch" };
  return { kind: "match", payload: envelope.payload };
}

export const STOP_KIND = "STOP" as const;
export const STOPPED_KIND = "STOPPED" as const;

export function isStopResponse(payload: HostResponse): payload is { kind: "STOPPED" } {
  return payload.kind === STOPPED_KIND;
}
