/**
 * Session-wide haptic adapter registry. The active game surface registers its
 * adapter on mount; mode switches and teardown call emergencyStopAll() first
 * so a pending haptic transaction is always stopped safely before the game
 * event is reset to the new mode's start.
 */

import type { HapticAdapter } from "./hapticAdapter";

let currentAdapter: HapticAdapter | null = null;

export function registerHapticAdapter(adapter: HapticAdapter | null): void {
  currentAdapter = adapter;
}

export function currentHapticAdapter(): HapticAdapter | null {
  return currentAdapter;
}

/** 安全停止当前触觉事务（无适配器/无操作时静默成功）。 */
export async function emergencyStopAll(reason: string): Promise<void> {
  if (currentAdapter === null) return;
  try {
    await currentAdapter.emergencyStop(reason);
  } catch {
    // A stop failure must never block a mode switch; the firmware watchdog
    // remains the independent backstop.
  }
}
