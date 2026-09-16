import { describe, expect, it, vi } from "vitest";
import { NoopHapticAdapter, type HapticAdapter } from "../../app/game/hapticAdapter";
import { currentHapticAdapter, emergencyStopAll, registerHapticAdapter } from "../../app/game/hapticRuntime";

describe("haptic runtime registry", () => {
  it("tracks the registered adapter for mode switches", () => {
    const adapter = new NoopHapticAdapter();
    registerHapticAdapter(adapter);
    expect(currentHapticAdapter()).toBe(adapter);
    registerHapticAdapter(null);
    expect(currentHapticAdapter()).toBeNull();
  });

  it("stops the active transaction before a mode switch", async () => {
    const stop = vi.fn().mockResolvedValue(undefined);
    const adapter: HapticAdapter = {
      mode: "sth",
      prepareCue: async () => ({ status: "hardware-unavailable", reason: "no host" }),
      commitCue: async () => ({ status: "error", reason: "no host" }),
      emergencyStop: stop
    };
    registerHapticAdapter(adapter);
    await emergencyStopAll("mode switch to NONE");
    expect(stop).toHaveBeenCalledWith("mode switch to NONE");
    registerHapticAdapter(null);
  });

  it("swallows adapter stop failures so the switch never blocks", async () => {
    registerHapticAdapter({
      mode: "bh",
      prepareCue: async () => ({ status: "prepared", outcome: "prepared", mode: "bh" }),
      commitCue: async () => ({ status: "committed" }),
      emergencyStop: async () => {
        throw new Error("port gone");
      }
    });
    await expect(emergencyStopAll("teardown")).resolves.toBeUndefined();
    registerHapticAdapter(null);
  });

  it("is a no-op when no adapter is registered", async () => {
    registerHapticAdapter(null);
    await expect(emergencyStopAll("idle")).resolves.toBeUndefined();
  });
});
