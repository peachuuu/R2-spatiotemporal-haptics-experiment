import type { AreaSequenceId, GameEventId, ProjectileSequenceId } from "./types";

export type IntroCue = { eventId: "boss-landing" | "boss-casting" | "fire-wall" | "ghost-pass"; atMs: number };
export type ProjectileTrial = { eventId: `projectile-${"left" | "right"}-${"low" | "middle" | "high"}`; spawnX: number; y: number; velocity: number; telegraphMs: number; trialIndex: number };
export type AreaTrial = { eventId: "area-rune"; x: number; radius: number; activeMs: number; trialIndex: number };

const projectileKinds = {
  P1: { eventId: "projectile-right-low", spawnX: 106, y: .8, velocity: -25 }, P2: { eventId: "projectile-left-low", spawnX: -6, y: .8, velocity: 25 },
  P3: { eventId: "projectile-right-middle", spawnX: 106, y: 1.25, velocity: -28 }, P4: { eventId: "projectile-left-middle", spawnX: -6, y: 1.25, velocity: 28 },
  P5: { eventId: "projectile-right-high", spawnX: 106, y: 1.65, velocity: -26 }, P6: { eventId: "projectile-left-high", spawnX: -6, y: 1.65, velocity: 26 },
} as const;
/** 六种经过平衡的飞行物顺序；只调整数组内 P1–P6 的顺序，不要改 P 编号。 */
export const PROJECTILE_ORDERS = { S1: ["P1", "P2", "P6", "P3", "P5", "P4"], S2: ["P2", "P3", "P1", "P4", "P6", "P5"], S3: ["P3", "P4", "P2", "P5", "P1", "P6"], S4: ["P4", "P5", "P3", "P6", "P2", "P1"], S5: ["P5", "P6", "P4", "P1", "P3", "P2"], S6: ["P6", "P1", "P5", "P2", "P4", "P3"] } as const;
/** 四种经过平衡的范围攻击顺序；数字是场景中的横向百分比位置。 */
export const AREA_ORDERS = { A1: [24, 38, 77, 63], A2: [38, 63, 24, 77], A3: [63, 77, 38, 24], A4: [77, 24, 63, 38] } as const;
export const EVENT_CATALOG: Record<GameEventId, { label: string; assetKey?: string; startMs?: number; durationMs?: number }> = {
  "boss-landing": { label: "守卫落地与碎石冲击", assetKey: "rubble-burst-v2.png", startMs: 700, durationMs: 1350 },
  "boss-casting": { label: "守卫蓄力", assetKey: "boss-cast-frames.png", startMs: 2180, durationMs: 1000 },
  "fire-wall": { label: "遗迹火焰爆发", assetKey: "fire-frames.png", startMs: 3180, durationMs: 3820 },
  "ghost-pass": { label: "幽灵掠过与视野收缩", assetKey: "ghost-pixel.png", startMs: 8000 },
  "chest-cue": { label: "宝箱线索", assetKey: "chest-pixel.png" },
  "chest-opened": { label: "宝箱开启" },
  "chest-found": { label: "找到宝箱" },
  "projectile-left-low": { label: "左侧低位飞行物", assetKey: "fireball-pixel.png" },
  "projectile-right-low": { label: "右侧低位飞行物", assetKey: "fireball-pixel.png" },
  "projectile-left-middle": { label: "左侧中位飞行物", assetKey: "fireball-pixel.png" },
  "projectile-right-middle": { label: "右侧中位飞行物", assetKey: "fireball-pixel.png" },
  "projectile-left-high": { label: "左侧高位飞行物", assetKey: "fireball-pixel.png" },
  "projectile-right-high": { label: "右侧高位飞行物", assetKey: "fireball-pixel.png" },
  "area-rune": { label: "范围符文攻击", assetKey: "vfx-atlas.png", durationMs: 1800 },
  "player-hit": { label: "玩家受击" }, "projectile-evaded": { label: "飞行物闪避" },
  "area-escaped": { label: "离开范围攻击" }, "counter-window": { label: "反击窗口", durationMs: 1200 },
  "counter-hit": { label: "反击命中" }, "boss-defeated": { label: "守卫被击败" },
  "run-paused": { label: "游戏暂停" }, "run-resumed": { label: "游戏继续" },
  "run-aborted": { label: "游戏中止" }, "run-timeout": { label: "游戏超时" },
  "input-keyboard": { label: "键鼠输入" }, "input-gamepad": { label: "手柄输入" },
  "haptic-cue-prepared": { label: "触觉 cue 已就绪" }, "haptic-cue-skipped": { label: "触觉 cue 已跳过（NONE）" }, "haptic-cue-unavailable": { label: "触觉样本不可用" },
};

/**
 * 设计侧唯一需要经常调整的编排表：保留 eventId 不变，只改顺序或数值。
 * 游戏引擎依据这些规则推进，不依赖页面组件中的硬编码时间。
 */
export const ENCOUNTER_FLOW = {
  introOrder: ["boss-landing", "boss-casting", "fire-wall", "ghost-pass"] as const,
  exploration: { chestX: 17, interactAtOrBelowX: 28, vision: 11, combatVision: 18 },
  combat: { initialDelayMs: 700, gapAfterTrialMs: 700, projectileCounterWindowMs: 1200, bossCastMs: 500, areaBossCastMs: 550 },
  phases: [
    { phaseId: "intro", eventIds: ["boss-landing", "boss-casting", "fire-wall", "ghost-pass"] },
    { phaseId: "explore", eventIds: ["chest-cue", "chest-opened"] },
    { phaseId: "projectiles", eventIds: ["projectile-left-low", "projectile-right-low", "projectile-left-middle", "projectile-right-middle", "projectile-left-high", "projectile-right-high"] },
    { phaseId: "areas", eventIds: ["area-rune"] },
  ],
} as const;

const intro = ENCOUNTER_FLOW.introOrder.map((eventId) => ({ eventId, atMs: EVENT_CATALOG[eventId].startMs ?? 0 }));

export const getIntroCues = (elapsedMs: number): IntroCue[] => intro.filter((cue) => cue.atMs <= elapsedMs).map((cue) => ({ ...cue }));
export const getProjectileTrials = (sequenceId: ProjectileSequenceId): ProjectileTrial[] => PROJECTILE_ORDERS[sequenceId].map((id, index) => ({ ...projectileKinds[id], telegraphMs: 500, trialIndex: index + 1 }));
export const getAreaTrials = (sequenceId: AreaSequenceId): AreaTrial[] => AREA_ORDERS[sequenceId].map((x, index) => ({ eventId: "area-rune", x, radius: 20, activeMs: 1800, trialIndex: index + 1 }));
