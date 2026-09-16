"use client";

import { useEffect, useState } from "react";
import { hapticSerial, EVENT_NAMES, HAPTIC_EVENT_BYTES } from "../game/hapticSerial";

type SerialStatus = { connected: boolean; portLabel: string | null; enabled: boolean };

/**
 * 全局串口设置页（/?mode=serial）：
 * 选择本机串口并连接（波特率固定 115200，不向用户暴露）、电压设置、
 * 单字节事件测试按钮、启用开关与停止按钮。游戏内的事件→串口任务
 * 只有在“已连接 + 已启用”时才会真实发送。
 */
export function SerialSettingsPage() {
  const [status, setStatus] = useState<SerialStatus>(() => ({
    connected: hapticSerial.isConnected(),
    portLabel: hapticSerial.portLabel(),
    enabled: hapticSerial.enabled
  }));
  const [message, setMessage] = useState<string | null>(null);
  const [voltage, setVoltage] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => hapticSerial.subscribe(setStatus), []);

  const fail = (error: unknown) =>
    setMessage(`错误：${error instanceof Error ? error.message : String(error)}`);

  const connect = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await hapticSerial.requestPortAndConnect();
      setMessage("已连接。");
    } catch (error) {
      fail(error);
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    try {
      await hapticSerial.disconnect();
      setMessage("已断开，固件已收到停止命令。");
    } catch (error) {
      fail(error);
    } finally {
      setBusy(false);
    }
  };

  const sendVoltage = async () => {
    setBusy(true);
    try {
      await hapticSerial.setVoltage(voltage);
      setMessage(`电压设置已发送（${Math.max(0, Math.min(255, Math.round(voltage)))}）。`);
    } catch (error) {
      fail(error);
    } finally {
      setBusy(false);
    }
  };

  const sendEvent = async (byte: number) => {
    setBusy(true);
    try {
      await hapticSerial.sendEventByte(byte);
      setMessage(`事件已发送：0x${byte.toString(16).padStart(2, "0")} ${EVENT_NAMES[byte] ?? ""}`);
    } catch (error) {
      fail(error);
    } finally {
      setBusy(false);
    }
  };

  const stop = async () => {
    setBusy(true);
    try {
      await hapticSerial.stop();
      setMessage("已发送停止命令（0x00），固件将中止刺激并隔离全部电极。");
    } catch (error) {
      fail(error);
    } finally {
      setBusy(false);
    }
  };

  if (!hapticSerial.supported()) {
    return (
      <main className="pixel-app">
        <header>
          <div>
            <p>R2 · SERIAL SETTINGS</p>
            <h1>串口设置 <small>Serial Settings</small></h1>
          </div>
        </header>
        <section className="serial-settings" role="alert">
          <h2>当前浏览器不支持 Web Serial</h2>
          <p>
            请使用 Chrome 或 Edge，并确保页面通过 <b>localhost</b> 或 HTTPS 打开
            （本游戏开发服务器为 http://localhost:3001，可直接使用）。
          </p>
          <p>
            <a href="/">返回游戏</a>
          </p>
        </section>
      </main>
    );
  }

  return (
    <main className="pixel-app">
      <header>
        <div>
          <p>R2 · SERIAL SETTINGS</p>
          <h1>串口设置 <small>Serial Settings</small></h1>
        </div>
      </header>

      <section className="serial-settings">
        <p className="serial-status" role="status">
          {status.connected ? `已连接：${status.portLabel ?? "串口"}` : "未连接"}
          {" · "}
          {status.enabled ? "触觉输出：已启用" : "触觉输出：已禁用"}
        </p>

        <div className="serial-actions">
          <button type="button" className="serial-btn" disabled={busy || status.connected} onClick={() => void connect()}>
            选择串口并连接
          </button>
          <button type="button" className="serial-btn" disabled={busy || !status.connected} onClick={() => void disconnect()}>
            断开连接
          </button>
        </div>

        <label className="serial-field">
          <span>电压设置（0–255，0 = 关闭输出）</span>
          <input
            type="number"
            min={0}
            max={255}
            value={voltage}
            onChange={event => setVoltage(Number(event.target.value))}
          />
          <button type="button" className="serial-btn" disabled={busy || !status.connected} onClick={() => void sendVoltage()}>
            发送电压设置
          </button>
        </label>

        <fieldset className="serial-group">
          <legend>事件测试按钮（单字节事件通知，发送即打断当前刺激）</legend>
          {Object.entries(HAPTIC_EVENT_BYTES).map(([name, byte]) => (
            <button
              key={name}
              type="button"
              className="serial-btn"
              disabled={busy || !status.connected}
              onClick={() => void sendEvent(byte)}
            >
              {name} (0x{byte.toString(16).padStart(2, "0")})
            </button>
          ))}
        </fieldset>

        <label className="serial-field serial-enable">
          <input
            type="checkbox"
            checked={status.enabled}
            onChange={event => {
              hapticSerial.enabled = event.target.checked;
              setStatus({ ...status, enabled: hapticSerial.enabled });
            }}
          />
          <span>
            启用游戏事件→触觉输出（关闭时游戏运行完全不受影响；开启后游戏内触觉事件
            会实时发送到本串口）
          </span>
        </label>

        <div className="serial-actions">
          <button type="button" className="serial-btn serial-btn-danger" disabled={busy || !status.connected} onClick={() => void stop()}>
            立即停止刺激
          </button>
        </div>

        {message !== null && (
          <p className="serial-message" role="status">
            {message}
          </p>
        )}

        <p>
          <a href="/">返回游戏</a>
        </p>
      </section>
    </main>
  );
}
