import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { GAME_ORIGIN } from "./gameProtocol";
import { HardwareHostClient } from "./hardwareHostClient";

const HardwareHostContext = createContext<HardwareHostClient | null>(null);

export function useHardwareHostClient(): HardwareHostClient | null {
  return useContext(HardwareHostContext);
}

export function buildHardwareHostUrl(sessionId: string, parentOrigin: string): string {
  const params = new URLSearchParams({
    mode: "serial-host",
    embedded: "1",
    sessionId,
    parentOrigin
  });
  return `${GAME_ORIGIN}/?${params.toString()}`;
}

/**
 * 持久 HardwareHost：整次 R2 会话唯一持有 Web Serial 的 iframe。挂在
 * StudyShell 内、步骤内容之外——步骤切换/游戏 iframe 重建都不会卸载它。
 * sessionId 变化（新会话）时按 key 重挂载，旧连接由 iframe 卸载自然释放。
 */
export function HardwareHostFrame({ sessionId, children }: { sessionId: string | null; children: ReactNode }) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [hostWindow, setHostWindow] = useState<Window | null>(null);
  const [dockOpen, setDockOpen] = useState(false);

  useEffect(() => {
    // iframe 挂载后即可取得 contentWindow；轮询一次以覆盖懒加载
    const probe = () => {
      const win = iframeRef.current?.contentWindow ?? null;
      if (win !== null) setHostWindow(win);
    };
    probe();
    const timer = window.setInterval(probe, 500);
    return () => window.clearInterval(timer);
  }, [sessionId]);

  const client = useMemo(() => {
    if (sessionId === null || hostWindow === null) return null;
    return new HardwareHostClient(sessionId, GAME_ORIGIN, hostWindow);
  }, [sessionId, hostWindow]);

  useEffect(() => {
    client?.attach();
    return () => client?.detach();
  }, [client]);

  if (sessionId === null) {
    return <HardwareHostContext.Provider value={null}>{children}</HardwareHostContext.Provider>;
  }

  return (
    <HardwareHostContext.Provider value={client}>
      <div className="hardware-host-dock" data-testid="hardware-host-dock">
        <button
          type="button"
          className="button button-secondary hardware-host-toggle"
          onClick={() => setDockOpen(open => !open)}
          aria-expanded={dockOpen}
        >
          硬件连接{dockOpen ? " ▲" : " ▼"}
        </button>
        <iframe
          key={sessionId}
          ref={iframeRef}
          src={buildHardwareHostUrl(sessionId, location.origin)}
          title="电触觉硬件连接"
          allow="serial"
          className="hardware-host-frame"
          data-testid="hardware-host-frame"
          hidden={!dockOpen}
          aria-hidden={!dockOpen}
        />
      </div>
      {children}
    </HardwareHostContext.Provider>
  );
}
