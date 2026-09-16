import { useEffect, useMemo, useRef, useState } from "react";
import { createCueCoordinator } from "../adapters/CueCoordinator";
import { MockGameAdapter } from "../adapters/MockGameAdapter";
import { MockHapticAdapter } from "../adapters/MockHapticAdapter";
import type { DeviceStatus } from "../adapters/contracts";
import { useStudy } from "../app/StudyContext";
import type { ConditionId } from "../domain/types";
import { EVENT_LABELS, getConditionConfig } from "../protocol/conditions.v1";

type Props = {
  conditionId: ConditionId;
  sessionId: string;
  onFinish: (run: { startedAt: string; endedAt: string; events: string[] }) => void;
};

/**
 * 确定性占位场景。每个事件按钮都会对 Mock 适配器走完整的 cue 流程
 * （prepareCue → 共享 cue 时间 → commitCue → 通知媒体），并把事件 ID 加入运行时间线。
 */
export function MockConditionRunner({ conditionId, sessionId, onFinish }: Props) {
  const { logAdapter } = useStudy();
  const [deviceStatus, setDeviceStatus] = useState<DeviceStatus | null>(null);
  const [startedAt, setStartedAt] = useState<string | null>(null);
  const [events, setEvents] = useState<string[]>([]);
  const [triggering, setTriggering] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const startedRef = useRef(false);

  const game = useMemo(() => new MockGameAdapter(), []);
  const haptic = useMemo(() => new MockHapticAdapter(), []);
  const coordinator = useMemo(() => createCueCoordinator(haptic, { notifyCue: async () => undefined }), [haptic]);

  useEffect(() => {
    if (startedRef.current) return; // StrictMode 双重挂载保护
    startedRef.current = true;
    void (async () => {
      const status = await game.getStatus();
      setDeviceStatus(status);
      await logAdapter("game", "status", { conditionId, state: status.state });
      if (status.state !== "ready") {
        setError(`游戏适配器${status.state}：${status.detail ?? "无详情"}。无法运行条件。`);
        return;
      }
      const { startedAt: started } = await game.startCondition({ conditionId, sessionId });
      setStartedAt(started);
      await logAdapter("game", "start-condition", { conditionId });
    })();
  }, [conditionId, game, logAdapter, sessionId]);

  const triggerEvent = async (eventId: string) => {
    setTriggering(eventId);
    const result = await coordinator.runCue({
      eventId,
      patternId: `mock-${conditionId}`,
      conditionId,
      requestedAtMs: performance.now()
    });
    setTriggering(null);
    if (!result.ok) {
      setError(`触觉 cue ${result.reason}：${result.detail ?? "无详情"}。事件未记录。`);
      return;
    }
    await game.emitEvent({ eventId });
    setEvents(prev => [...prev, eventId]);
    await logAdapter("haptic", "cue-committed", { eventId, cueAtMs: result.cueAtMs });
  };

  const finish = async () => {
    const { endedAt } = await game.finishCondition();
    await logAdapter("game", "finish-condition", { conditionId });
    onFinish({ startedAt: startedAt ?? endedAt, endedAt, events });
  };

  const config = getConditionConfig(conditionId);
  const blocked = deviceStatus !== null && deviceStatus.state !== "ready";

  return (
    <div className="mock-runner">
      <p className="screen-intro">
        这是一个占位场景——不会运行真实游戏或产生触觉输出。请依次触发九个已配置事件，然后结束场景以记录条件时间线。
      </p>
      <p className="mock-status" role="status">
        模拟游戏：{startedAt === null ? "启动中…" : `自 ${startedAt} 起运行中`}
      </p>
      {error !== null && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      <div className="event-buttons">
        {config.events.map(eventId => (
          <button
            key={eventId}
            type="button"
            className="button button-secondary"
            disabled={triggering === eventId || events.includes(eventId) || blocked}
            onClick={() => void triggerEvent(eventId)}
          >
            {EVENT_LABELS[eventId] ?? eventId}
            {events.includes(eventId) ? " ✓ 已触发" : ""}
          </button>
        ))}
      </div>
      {events.length > 0 && <p className="event-timeline">已触发：{events.join(", ")}</p>}
      <button
        type="button"
        className="button button-primary"
        disabled={blocked || startedAt === null || triggering !== null}
        onClick={() => void finish()}
      >
        结束占位场景
      </button>
    </div>
  );
}
