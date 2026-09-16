/**
 * Condition configuration, version 1.
 * Hidden internal condition IDs must never be shown to participants; the UI
 * only renders display labels "Condition A"/"B" and "Sample A"/"B".
 */

import type { ConditionId } from "../domain/types";

export const CONDITION_EVENT_IDS = [
  "event-01",
  "event-02",
  "event-03",
  "event-04",
  "event-05",
  "event-06",
  "event-07",
  "event-08",
  "event-09"
] as const;

export type ConditionEventId = (typeof CONDITION_EVENT_IDS)[number];

export const EVENT_LABELS: Record<ConditionEventId, string> = {
  "event-01": "事件一-碎石飞溅",
  "event-02": "事件二-火焰灼烧",
  "event-03": "事件三-幽灵飞过",
  "event-04": "事件四-寻找宝箱",
  "event-05": "事件五-指尖划过宝箱凸棱",
  "event-06": "事件六-飞行物来袭",
  "event-07": "事件七-危险区域扩张",
  "event-08": "事件八-下雨",
  "event-09": "事件九-烟花绽放"
};

/** 每个对比事件对应的游戏画面截图（public/event-screens/ 下，与文件名一致）。 */
export const EVENT_SCREENSHOTS: Record<ConditionEventId, string> = {
  "event-01": "/event-screens/event-01-G02-碎石飞溅.png",
  "event-02": "/event-screens/event-02-G03-火焰灼烧.png",
  "event-03": "/event-screens/event-03-G04-幽灵飞过.png",
  "event-04": "/event-screens/event-04-G05-寻找宝箱.png",
  "event-05": "/event-screens/event-05-G06-指尖划过宝箱凸棱.png",
  "event-06": "/event-screens/event-06-G07-飞行物来袭.png",
  "event-07": "/event-screens/event-07-G07-危险区域扩张.png",
  "event-08": "/event-screens/event-08-G08-下雨.png",
  "event-09": "/event-screens/event-09-G12-烟花绽放.png"
};

/**
 * 每个对比事件的触觉样本与配套音频（public/audio/ 下，与游戏 assets/music/new 同名）。
 * STH/BH 只替换样本 ID 的显式条件 token；音频与真实条件无关、两种样本共用同一份。
 * 多形态事件取固定代表性变体（经确认）：G05 左侧宝箱、G07 投射物左侧·快、G07 危险区 b·快。
 */
export type ComparisonEventSample = {
  /** STH 基础样本 ID；BH 由 resolvedSampleIdFor 派生。 */
  baseSampleId: string;
  /** 与触觉共同起播的主音频。 */
  audioPath: string;
  /** 后续冲击类音频：自共同起播点 offsetMs 后播放（如危险区冲击声）。 */
  secondaryAudio?: { path: string; offsetMs: number };
};

export const EVENT_SAMPLES: Record<ConditionEventId, ComparisonEventSample> = {
  "event-01": { baseSampleId: "sth.g02.rubble", audioPath: "/audio/g02-rubble-flight.wav" },
  "event-02": { baseSampleId: "sth.g03.fire", audioPath: "/audio/g03-fire.wav" },
  "event-03": { baseSampleId: "sth.g04.ghost", audioPath: "/audio/g04-ghost.wav" },
  "event-04": { baseSampleId: "sth.g05.chest.left", audioPath: "/audio/g05-g09-chest-cue.wav" },
  "event-05": { baseSampleId: "sth.g06.ridge", audioPath: "/audio/g06-g10-ridge-trace.wav" },
  "event-06": { baseSampleId: "sth.g07.projectile.left.fast", audioPath: "/audio/g07-g11-projectile-fast.wav" },
  "event-07": {
    baseSampleId: "sth.g07.area.b.fast",
    audioPath: "/audio/g07-g11-area-fast.wav",
    secondaryAudio: { path: "/audio/g07-g11-area-impact.wav", offsetMs: 1885 }
  },
  "event-08": { baseSampleId: "sth.g08.rain", audioPath: "/audio/g08-rain.wav" },
  "event-09": { baseSampleId: "sth.g12.fireworks", audioPath: "/audio/g12-fireworks.wav" }
};

/** 解析条件限定样本 ID：STH 保持原样，BH 仅替换显式条件 token。 */
export function resolvedSampleIdFor(baseSampleId: string, condition: "sth" | "bh"): string {
  if (!baseSampleId.startsWith("sth.")) throw new Error(`invalid STH base sample ID: ${baseSampleId}`);
  return condition === "sth" ? baseSampleId : `bh.${baseSampleId.slice(4)}`;
}

export type ConditionConfig = {
  id: ConditionId;
  /** Operator-facing description only. */
  internalName: string;
  /** Placeholder metadata; real tactile samples are produced outside this phase. */
  sampleDescription: string;
  events: readonly ConditionEventId[];
};

export const CONDITIONS: readonly ConditionConfig[] = [
  {
    id: "baseline",
    internalName: "Baseline haptic mapping",
    sampleDescription: "Placeholder tactile sample (not yet produced)",
    events: CONDITION_EVENT_IDS
  },
  {
    id: "spatiotemporal",
    internalName: "Spatiotemporal haptic mapping",
    sampleDescription: "Placeholder tactile sample (not yet produced)",
    events: CONDITION_EVENT_IDS
  }
];

export function getConditionConfig(id: ConditionId): ConditionConfig {
  const config = CONDITIONS.find(c => c.id === id);
  if (config === undefined) throw new Error(`unknown condition: ${id}`);
  return config;
}
