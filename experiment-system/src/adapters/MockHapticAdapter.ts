import type { CueRequest, DeviceStatus, HapticAdapter, PreparedCue } from "./contracts";

/**
 * Deterministic mock. May only return simulated status and write a local
 * action log — never a real electrical-stimulation command.
 */
export class MockHapticAdapter implements HapticAdapter {
  /** Ordered log of adapter actions, for tests and inspection. */
  readonly actions: string[] = [];

  constructor(
    private readonly nowMs: () => number = () => performance.now(),
    private readonly prepareDelayMs: number = 120
  ) {}

  async getStatus(): Promise<DeviceStatus> {
    this.actions.push("get-status");
    return { state: "ready", detail: "mock device; no electrical output" };
  }

  async prepareCue(request: CueRequest): Promise<PreparedCue> {
    this.actions.push(`prepare:${request.eventId}`);
    if (this.prepareDelayMs > 0) await delay(this.prepareDelayMs);
    return {
      eventId: request.eventId,
      readiness: "ready",
      readyAtMs: this.nowMs(),
      recommendedLeadMs: 0
    };
  }

  async commitCue(eventId: string, cueAtMs: number): Promise<void> {
    this.actions.push(`commit:${eventId}:${cueAtMs}`);
  }

  async emergencyStop(reason: string): Promise<void> {
    this.actions.push(`emergency-stop:${reason}`);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
