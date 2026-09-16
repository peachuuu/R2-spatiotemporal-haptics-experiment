import { describe, expect, it } from "vitest";
import { createCueCoordinator } from "../../src/adapters/CueCoordinator";
import type { CueMediaAdapter, CueRequest, DeviceStatus, HapticAdapter, PreparedCue } from "../../src/adapters/contracts";
import { MockHapticAdapter } from "../../src/adapters/MockHapticAdapter";

function fakeHaptic(calls: string[], prepared: PreparedCue): HapticAdapter {
  return {
    async getStatus(): Promise<DeviceStatus> {
      return { state: "ready" };
    },
    async prepareCue(request: CueRequest) {
      calls.push(`prepare:${request.eventId}`);
      return prepared;
    },
    async commitCue(eventId, cueAtMs) {
      calls.push(`commit:${eventId}:${cueAtMs}`);
    },
    async emergencyStop(reason) {
      calls.push(`stop:${reason}`);
    }
  };
}

function fakeMedia(calls: string[]): CueMediaAdapter {
  return {
    async notifyCue(cue) {
      calls.push(`media:${cue.eventId}:${cue.cueAtMs}`);
    }
  };
}

describe("CueCoordinator", () => {
  it("starts media only after haptic readiness and shares a cue time", async () => {
    const calls: string[] = [];
    const coordinator = createCueCoordinator(
      fakeHaptic(calls, { eventId: "boss-hit", readiness: "ready", readyAtMs: 1120, recommendedLeadMs: 0 }),
      fakeMedia(calls),
      () => 1000
    );
    const result = await coordinator.runCue({
      eventId: "boss-hit",
      patternId: "hit-left",
      conditionId: "baseline",
      requestedAtMs: 990
    });
    expect(result).toEqual({ ok: true, cueAtMs: 1120 });
    expect(calls).toEqual(["prepare:boss-hit", "commit:boss-hit:1120", "media:boss-hit:1120"]);
  });

  it("does not commit or start media when the device is unavailable", async () => {
    const calls: string[] = [];
    const coordinator = createCueCoordinator(
      fakeHaptic(calls, { eventId: "e1", readiness: "unavailable", readyAtMs: 0, recommendedLeadMs: 0, detail: "no device" }),
      fakeMedia(calls),
      () => 1000
    );
    const result = await coordinator.runCue({ eventId: "e1", patternId: "p", conditionId: "baseline", requestedAtMs: 990 });
    expect(result).toEqual({ ok: false, reason: "unavailable", detail: "no device" });
    expect(calls).toEqual(["prepare:e1"]);
  });

  it("honours recommendedLeadMs when computing the shared cue time", async () => {
    const calls: string[] = [];
    const coordinator = createCueCoordinator(
      fakeHaptic(calls, { eventId: "e2", readiness: "ready", readyAtMs: 950, recommendedLeadMs: 200 }),
      fakeMedia(calls),
      () => 1000
    );
    const result = await coordinator.runCue({
      eventId: "e2",
      patternId: "p",
      conditionId: "spatiotemporal",
      requestedAtMs: 990
    });
    expect(result).toEqual({ ok: true, cueAtMs: 1200 });
    expect(calls).toEqual(["prepare:e2", "commit:e2:1200", "media:e2:1200"]);
  });

  it("returns a structured failure when prepareCue throws", async () => {
    const failing: HapticAdapter = {
      async getStatus() {
        return { state: "error" };
      },
      async prepareCue() {
        throw new Error("serial port lost");
      },
      async commitCue() {},
      async emergencyStop() {}
    };
    const calls: string[] = [];
    const coordinator = createCueCoordinator(failing, fakeMedia(calls), () => 1000);
    const result = await coordinator.runCue({ eventId: "e3", patternId: "p", conditionId: "baseline", requestedAtMs: 0 });
    expect(result).toEqual({ ok: false, reason: "error", detail: "serial port lost" });
    expect(calls).toEqual([]);
  });

  it("mock haptic adapter prepares after a delay and logs emergency stops", async () => {
    const haptic = new MockHapticAdapter(() => 500, 0);
    const prepared = await haptic.prepareCue({ eventId: "e", patternId: "p", conditionId: "baseline", requestedAtMs: 0 });
    expect(prepared).toEqual({ eventId: "e", readiness: "ready", readyAtMs: 500, recommendedLeadMs: 0 });
    await haptic.emergencyStop("operator requested");
    expect(haptic.actions).toContain("emergency-stop:operator requested");
  });
});
