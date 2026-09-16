"use client";

import { useEffect, useRef, useState } from "react";
import { HapticSerialHost, type SerialPortLike } from "../game/hapticHost";
import {
  executeHostCommand,
  HOST_BRIDGE_SOURCE,
  HOST_BRIDGE_VERSION,
  parseHostCommandEnvelope,
  type HostResponseEnvelope,
  type HostStatus
} from "../game/hardwareHostBridge";
import { parseLaunchConfig } from "../game/launchConfig";

type SerialNavigatorLike = {
  serial?: {
    requestPort(options?: Record<string, never>): Promise<SerialPortLike>;
    addEventListener?(type: "disconnect", listener: (event: { port: SerialPortLike }) => void): void;
    removeEventListener?(type: "disconnect", listener: (event: { port: SerialPortLike }) => void): void;
  };
};

/** 必须短于固件 30 秒命令看门狗；GET_STATUS 不会产生刺激且可在 PLAYING 时执行。 */
export const ARM_IDLE_KEEPALIVE_MS = 5000;

/** A reply may only update UI while it belongs to the currently selected port. */
export function isCurrentConnectionEpoch(replyEpoch: number, currentEpoch: number): boolean {
  return replyEpoch === currentEpoch;
}

export function shouldMaintainArmedIdle(status: Pick<HostStatus, "connected" | "armed" | "busy">): boolean {
  return status.connected;
}

/** IO loss is immediate; a single missing reply is tolerated before releasing Web Serial. */
export function shouldReleaseUnresponsiveConnection(errorCode: string, consecutiveFailures = 1): boolean {
  if (errorCode === "IO" || errorCode === "NOT_CONNECTED") return true;
  return errorCode === "TIMEOUT" && consecutiveFailures >= 3;
}

/** A read stream that has ended is an unusable handle even before a command times out. */
export function shouldReleaseDisconnectedHost(hostIsConnected: boolean): boolean {
  return !hostIsConnected;
}

/** Web Serial can announce removal for another previously authorized device; ignore it. */
export function isSelectedSerialDisconnect(eventPort: unknown, selectedPort: unknown): boolean {
  return selectedPort !== null && eventPort === selectedPort;
}

/**
 * 持久 HardwareHost（?mode=serial-host&embedded=1&sessionId=…&parentOrigin=…）：
 * 整次 R2 会话中唯一持有 Web Serial 的 iframe。父页面命令经硬件桥路由到
 * HapticSerialHost；设备事件与状态变化实时回推。校准页与正式游戏永不直接
 * 访问 navigator.serial。
 */
export function HardwareHostPage() {
  // serial-host 不是游戏条件模式，直接解析参数（sessionId/parentOrigin 必填）。
  const searchParams = typeof window === "undefined" ? new URLSearchParams() : new URLSearchParams(window.location.search);
  const sessionId = searchParams.get("sessionId")?.trim() ?? "";
  const parentOrigin = searchParams.get("parentOrigin")?.trim() ?? "";
  const hostRef = useRef<HapticSerialHost | null>(null);
  if (hostRef.current === null) hostRef.current = new HapticSerialHost();
  const selectedPortRef = useRef<SerialPortLike | null>(null);
  const releasingUnresponsiveRef = useRef(false);
  const consecutiveTransportFailuresRef = useRef(0);
  const statusRefreshInFlightRef = useRef(false);
  /** 已推送给父页面的状态键；状态变化时（ARM/停止/播放完成）才再次推送。 */
  const lastPostedStatusKeyRef = useRef<string | null>(null);
  // Disconnect/reconnect is asynchronous.  This monotonically increasing
  // token prevents a late GET_STATUS or command reply from reviving the old
  // port's UI state after its Web Serial handle has been released.
  const connectionEpochRef = useRef(0);
  const [status, setStatus] = useState<HostStatus>({
    connected: false,
    armed: false,
    busy: false,
    voltageCode: 0,
    firmware: null,
    fault: 0
  });
  const [message, setMessage] = useState<string | null>(null);

  const post = (envelope: HostResponseEnvelope) => {
    window.parent.postMessage(envelope, parentOrigin);
  };

  const releaseUnresponsiveConnection = async (reason: string) => {
    if (releasingUnresponsiveRef.current) return;
    releasingUnresponsiveRef.current = true;
    const releaseEpoch = ++connectionEpochRef.current;
    try {
      await hostRef.current!.disconnect();
    } finally {
      if (!isCurrentConnectionEpoch(releaseEpoch, connectionEpochRef.current)) {
        releasingUnresponsiveRef.current = false;
        return;
      }
      const disconnected: HostStatus = { connected: false, armed: false, busy: false, voltageCode: 0, firmware: null, fault: 0 };
      selectedPortRef.current = null;
      consecutiveTransportFailuresRef.current = 0;
      setStatus(disconnected);
      lastPostedStatusKeyRef.current = null;
      setMessage(`设备通信失败（${reason}）：已释放串口。请重新选择串口并连接，再 ARM。`);
      post({ source: HOST_BRIDGE_SOURCE, protocolVersion: HOST_BRIDGE_VERSION, sessionId, txnId: 0, type: "HAPTIC_HOST_RESPONSE", payload: { kind: "STATUS_CHANGED", status: disconnected } });
      releasingUnresponsiveRef.current = false;
    }
  };

  const refreshStatus = async () => {
    if (statusRefreshInFlightRef.current) return;
    statusRefreshInFlightRef.current = true;
    const host = hostRef.current!;
    const requestEpoch = connectionEpochRef.current;
    try {
      if (shouldReleaseDisconnectedHost(host.isConnected())) {
        if (!isCurrentConnectionEpoch(requestEpoch, connectionEpochRef.current)) return;
        await releaseUnresponsiveConnection("浏览器串口读取流已结束");
        return;
      }
      const result = await host.getStatus(2500);
      if (!isCurrentConnectionEpoch(requestEpoch, connectionEpochRef.current)) return;
      if (!result.ok) {
        const isTransportFailure = result.error.code === "TIMEOUT" || result.error.code === "IO" || result.error.code === "NOT_CONNECTED";
        consecutiveTransportFailuresRef.current = isTransportFailure ? consecutiveTransportFailuresRef.current + 1 : 0;
        if (shouldReleaseUnresponsiveConnection(result.error.code, consecutiveTransportFailuresRef.current))
          await releaseUnresponsiveConnection(result.error.message);
        return;
      }
      consecutiveTransportFailuresRef.current = 0;
      const value = result.value;
      const next = {
        connected: true,
        armed: value.armed,
        busy: value.state === 4 || value.state === 5, // PREPARED/SCHEDULED
        voltageCode: value.voltageCode,
        fault: value.fault
      };
      setStatus(current => ({ ...current, ...next }));
      // ARM/停止/播放完成等状态变化必须同步给父页面（R2）：否则校准弹窗、
      // 样本对比页与终评页的 armed 标记停留在旧值，播放按钮永远禁用。
      const key = `${next.connected}|${next.armed}|${next.busy}|${next.voltageCode}|${next.fault}`;
      if (lastPostedStatusKeyRef.current !== key) {
        lastPostedStatusKeyRef.current = key;
        post({ source: HOST_BRIDGE_SOURCE, protocolVersion: HOST_BRIDGE_VERSION, sessionId, txnId: 0, type: "HAPTIC_HOST_RESPONSE", payload: { kind: "STATUS_CHANGED", status: { ...next, firmware: status.firmware } } });
      }
    } finally {
      statusRefreshInFlightRef.current = false;
    }
  };

  const connect = async () => {
    const serial = (navigator as unknown as SerialNavigatorLike).serial;
    if (serial === undefined) {
      setMessage("当前浏览器不支持 Web Serial（需 Chrome/Edge + localhost）。");
      return;
    }
    try {
      const connectEpoch = ++connectionEpochRef.current;
      const port = await serial.requestPort();
      const result = await hostRef.current!.connect(port, 2000);
      if (!isCurrentConnectionEpoch(connectEpoch, connectionEpochRef.current)) return;
      if (!result.ok) {
        setMessage(`连接失败：${result.error.message}`);
        return;
      }
      selectedPortRef.current = port;
      consecutiveTransportFailuresRef.current = 0;
      setStatus({
        connected: true,
        armed: false,
        busy: false,
        voltageCode: 0,
        firmware: result.value,
        fault: 0
      });
      setMessage("已连接。");
      post({ source: HOST_BRIDGE_SOURCE, protocolVersion: HOST_BRIDGE_VERSION, sessionId, txnId: 0, type: "HAPTIC_HOST_RESPONSE", payload: { kind: "STATUS_CHANGED", status: { connected: true, armed: false, busy: false, voltageCode: 0, firmware: result.value, fault: 0 } } });
    } catch (error) {
      setMessage(`连接取消或失败：${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const arm = async () => {
    const armEpoch = connectionEpochRef.current;
    const result = await hostRef.current!.arm(3000);
    if (!isCurrentConnectionEpoch(armEpoch, connectionEpochRef.current)) return;
    if (!result.ok) {
      const isTransportFailure = result.error.code === "TIMEOUT" || result.error.code === "IO" || result.error.code === "NOT_CONNECTED";
      consecutiveTransportFailuresRef.current = isTransportFailure ? consecutiveTransportFailuresRef.current + 1 : 0;
      setMessage(`ARM 失败：${result.error.message}`);
      if (shouldReleaseUnresponsiveConnection(result.error.code, consecutiveTransportFailuresRef.current))
        await releaseUnresponsiveConnection(result.error.message);
      return;
    }
    consecutiveTransportFailuresRef.current = 0;
    setMessage("已 ARM：输出已由操作者解锁。");
    await refreshStatus();
  };

  const stopAll = async () => {
    const stopEpoch = connectionEpochRef.current;
    const result = await hostRef.current!.emergencyStop(3000);
    if (!isCurrentConnectionEpoch(stopEpoch, connectionEpochRef.current)) return;
    if (!result.ok) {
      setMessage(`停止失败：${result.error.message}`);
      return;
    }
    setMessage("已停止：输出归零，全部电极高阻。");
    await refreshStatus();
  };

  const disconnect = async () => {
    ++connectionEpochRef.current;
    await hostRef.current!.disconnect();
    selectedPortRef.current = null;
    consecutiveTransportFailuresRef.current = 0;
    setStatus({ connected: false, armed: false, busy: false, voltageCode: 0, firmware: null, fault: 0 });
    lastPostedStatusKeyRef.current = null;
    setMessage("已断开（断开前已尽力发送 STOP）。");
    post({ source: HOST_BRIDGE_SOURCE, protocolVersion: HOST_BRIDGE_VERSION, sessionId, txnId: 0, type: "HAPTIC_HOST_RESPONSE", payload: { kind: "STATUS_CHANGED", status: { connected: false, armed: false, busy: false, voltageCode: 0, firmware: null, fault: 0 } } });
  };

  // COMPLETE 状态事件若迟到，UI 可能暂时仍显示“忙碌”；仍要在所有已 ARM 状态
  // 维持无刺激 GET_STATUS 心跳，防止固件 30 秒主机静默看门狗撤 ARM。
  useEffect(() => {
    if (!shouldMaintainArmedIdle(status)) return;
    const timer = window.setInterval(() => void refreshStatus(), ARM_IDLE_KEEPALIVE_MS);
    return () => window.clearInterval(timer);
  }, [status.connected, status.armed, status.busy]);

  useEffect(() => {
    const serial = (navigator as unknown as SerialNavigatorLike).serial;
    if (serial?.addEventListener === undefined) return;
    const onDisconnect = (event: { port: SerialPortLike }) => {
      if (!isSelectedSerialDisconnect(event.port, selectedPortRef.current)) return;
      void releaseUnresponsiveConnection("浏览器报告 COM 设备已断开");
    };
    serial.addEventListener("disconnect", onDisconnect);
    return () => serial.removeEventListener?.("disconnect", onDisconnect);
  }, [parentOrigin, sessionId]);

  useEffect(() => {
    const host = hostRef.current!;
    const offEvent = host.onDeviceEvent(event => {
      post({ source: HOST_BRIDGE_SOURCE, protocolVersion: HOST_BRIDGE_VERSION, sessionId, txnId: 0, type: "HAPTIC_HOST_RESPONSE", payload: { kind: "DEVICE_EVENT", event } });
      if (event.kind === "COMPLETE" || event.kind === "ERROR") void refreshStatus();
    });
    const onMessage = (event: MessageEvent) => {
      const envelope = parseHostCommandEnvelope({ origin: event.origin, source: event.source, data: event.data }, parentOrigin, sessionId);
      if ("error" in envelope) {
        // 非法信封：只回显错误，不执行任何命令
        if (event.origin === parentOrigin) {
          const txnId = isRecord(event.data) && typeof (event.data as { txnId?: unknown }).txnId === "number" ? (event.data as { txnId: number }).txnId : 0;
          post({ source: HOST_BRIDGE_SOURCE, protocolVersion: HOST_BRIDGE_VERSION, sessionId, txnId, type: "HAPTIC_HOST_RESPONSE", payload: { kind: "ERROR", code: "REJECTED", message: envelope.error } });
        }
        return;
      }
      const commandEpoch = connectionEpochRef.current;
      void executeHostCommand(host, envelope.payload)
        .then(async result => {
          post({ source: HOST_BRIDGE_SOURCE, protocolVersion: HOST_BRIDGE_VERSION, sessionId, txnId: envelope.txnId, type: "HAPTIC_HOST_RESPONSE", payload: { kind: "RESULT", result } });
          if (!result.ok) {
            const isTransportFailure = result.error.code === "TIMEOUT" || result.error.code === "IO" || result.error.code === "NOT_CONNECTED";
            consecutiveTransportFailuresRef.current = isTransportFailure ? consecutiveTransportFailuresRef.current + 1 : 0;
          } else consecutiveTransportFailuresRef.current = 0;
          if (!result.ok && shouldReleaseUnresponsiveConnection(result.error.code, consecutiveTransportFailuresRef.current)) {
            if (isCurrentConnectionEpoch(commandEpoch, connectionEpochRef.current))
              await releaseUnresponsiveConnection(result.error.message);
            return;
          }
          if (isCurrentConnectionEpoch(commandEpoch, connectionEpochRef.current)) await refreshStatus();
        })
        .catch(async error => {
          post({ source: HOST_BRIDGE_SOURCE, protocolVersion: HOST_BRIDGE_VERSION, sessionId, txnId: envelope.txnId, type: "HAPTIC_HOST_RESPONSE", payload: { kind: "ERROR", code: "INTERNAL", message: error instanceof Error ? error.message : String(error) } });
        });
    };
    window.addEventListener("message", onMessage);
    return () => {
      offEvent();
      window.removeEventListener("message", onMessage);
    };
  }, [parentOrigin, sessionId]);

  function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
  }

  return (
    <main className="pixel-app serial-host-page">
      <header>
        <div>
          <p>R2 · HARDWARE CONNECTION</p>
          <h1>硬件连接 <small>Hardware Connection</small></h1>
        </div>
      </header>
      <section className="serial-settings">
        <p className="serial-status" role="status">
          {status.connected
            ? `已连接（${status.firmware ? `固件 v${status.firmware.fwMajor}.${status.firmware.fwMinor} 样本表 v${status.firmware.sampleTableVersion}${status.firmware.dryRun ? " DRY_RUN" : ""}` : "固件未知"}）`
            : "未连接"}
          {" · "}
          {status.armed ? "已 ARM" : "未 ARM"}
          {" · "}
          输出等级 {status.voltageCode}
          {status.busy ? " · 忙碌" : ""}
          {status.fault !== 0 ? ` · 故障 ${status.fault}` : ""}
        </p>
        <div className="serial-actions">
          <button type="button" className="serial-btn" disabled={status.connected} onClick={() => void connect()}>
            选择串口并连接
          </button>
          <button type="button" className="serial-btn" disabled={!status.connected} onClick={() => void disconnect()}>
            断开连接
          </button>
          <button type="button" className="serial-btn" disabled={!status.connected || status.armed} onClick={() => void arm()}>
            ARM（解锁输出）
          </button>
          <button type="button" className="serial-btn serial-btn-danger" disabled={!status.connected} onClick={() => void stopAll()}>
            立即停止
          </button>
        </div>
        {message !== null && (
          <p className="serial-message" role="status">
            {message}
          </p>
        )}
        <p className="serial-note">
          本页面是实验会话内唯一的串口持有者；所有命令由 R2 协调器通过受校验的
          postMessage 下发（origin/session/协议版本/事务号/白名单）。请勿手动操作。
        </p>
      </section>
    </main>
  );
}
