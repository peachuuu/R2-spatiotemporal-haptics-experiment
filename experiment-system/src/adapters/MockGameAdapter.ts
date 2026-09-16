import type { ConditionId } from "../domain/types";
import type { DeviceStatus, GameAdapter } from "./contracts";

/** Placeholder scene: emits configured event IDs on operator click, completes only on explicit finish. */
export class MockGameAdapter implements GameAdapter {
  readonly actions: string[] = [];

  async getStatus(): Promise<DeviceStatus> {
    return { state: "ready", detail: "mock game; no build required" };
  }

  async startCondition(input: { conditionId: ConditionId; sessionId: string }): Promise<{ startedAt: string }> {
    this.actions.push(`start:${input.conditionId}`);
    return { startedAt: new Date().toISOString() };
  }

  async emitEvent(input: { eventId: string }): Promise<{ eventId: string; atMs: number }> {
    this.actions.push(`event:${input.eventId}`);
    return { eventId: input.eventId, atMs: performance.now() };
  }

  async finishCondition(): Promise<{ endedAt: string }> {
    this.actions.push("finish");
    return { endedAt: new Date().toISOString() };
  }
}
