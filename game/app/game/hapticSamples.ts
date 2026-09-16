/**
 * Canonical haptic sample catalog (design spec §7).
 *
 * - STH uses readable base IDs (`sth.g01.unlock`, …); BH replaces the
 *   leading condition token with `bh.`.
 * - Ids are case-sensitive; only the canonical spellings below exist.
 * - The game never holds waveform data: availability here is only the
 *   documented data status. The firmware is the authority and returns
 *   ERROR_SAMPLE_UNDEFINED for ids whose data has not been supplied.
 */

export type HapticCondition = "STH" | "BH";

export const SAMPLE_BASE_IDS = [
  "sth.g01.unlock",
  "sth.g02.rubble",
  "sth.g03.fire",
  "sth.g04.ghost",
  "sth.g05.chest.left",
  "sth.g05.chest.right",
  "sth.g06.open",
  "sth.g06.ridge",
  "sth.g07.projectile.left.fast",
  "sth.g07.projectile.right.fast",
  "sth.g07.projectile.left.slow",
  "sth.g07.projectile.right.slow",
  "sth.g07.area.a.fast",
  "sth.g07.area.a.slow",
  "sth.g07.area.b.fast",
  "sth.g07.area.b.slow",
  "sth.g07.area.c.fast",
  "sth.g07.area.c.slow",
  "sth.g07.area.d.fast",
  "sth.g07.area.d.slow",
  "sth.g08.rain",
  "sth.g12.fireworks"
] as const;

export type SampleBaseId = (typeof SAMPLE_BASE_IDS)[number];

const SAMPLE_BASE_ID_SET: ReadonlySet<string> = new Set(SAMPLE_BASE_IDS);

export function isSampleBaseId(value: string): value is SampleBaseId {
  return SAMPLE_BASE_ID_SET.has(value);
}

export function isResolvedSampleId(value: string): boolean {
  if (value.startsWith("bh.")) return isSampleBaseId(`sth.${value.slice(3)}`);
  return isSampleBaseId(value);
}

/** STH keeps the base ID; BH replaces only the explicit condition token. */
export function resolveConditionSampleId(baseId: SampleBaseId, condition: HapticCondition): string {
  return condition === "STH" ? baseId : baseId.replace(/^sth\./, "bh.");
}

/** Converts a resolved BH ID back to its STH base identifier. */
export function baseIdOfResolved(resolved: string): SampleBaseId | undefined {
  const base = resolved.startsWith("bh.") ? `sth.${resolved.slice(3)}` : resolved;
  return isSampleBaseId(base) ? base : undefined;
}

/**
 * Data status for operator-facing reports. `01` is the user-supplied 5.09 s
 * candidate (17 segments, 2.15 s normalised boundary) pending confirmation;
 * G06 opening remains intentionally unavailable; every other listed event ID
 * has a supplied waveform (BH is derived from its corresponding STH timing).
 */
export const SAMPLE_DATA_STATUS: Record<SampleBaseId, "candidate" | "unavailable"> = {
  "sth.g01.unlock": "candidate",
  "sth.g02.rubble": "candidate",
  "sth.g03.fire": "candidate",
  "sth.g04.ghost": "candidate",
  "sth.g05.chest.left": "candidate",
  "sth.g05.chest.right": "candidate",
  "sth.g06.open": "unavailable",
  "sth.g06.ridge": "candidate",
  "sth.g07.projectile.left.fast": "candidate",
  "sth.g07.projectile.right.fast": "candidate",
  "sth.g07.projectile.left.slow": "candidate",
  "sth.g07.projectile.right.slow": "candidate",
  "sth.g07.area.a.fast": "candidate",
  "sth.g07.area.a.slow": "candidate",
  "sth.g07.area.b.fast": "candidate",
  "sth.g07.area.b.slow": "candidate",
  "sth.g07.area.c.fast": "candidate",
  "sth.g07.area.c.slow": "candidate",
  "sth.g07.area.d.fast": "candidate",
  "sth.g07.area.d.slow": "candidate",
  "sth.g08.rain": "candidate",
  "sth.g12.fireworks": "candidate"
};

export function sampleDataStatus(resolvedId: string): "candidate" | "unavailable" {
  const baseId = baseIdOfResolved(resolvedId);
  return baseId === undefined ? "unavailable" : SAMPLE_DATA_STATUS[baseId];
}

// ---------------- Cue points (design spec §7.2) ----------------

export type CuePoint =
  | { kind: "g01-unlock" }
  | { kind: "g02-rubble" }
  | { kind: "g03-burn-start" }
  | { kind: "g04-ghost-pass" }
  | { kind: "chest-cue"; side: "left" | "right" }
  | { kind: "ridge-trace" } // G06/G10 食指划凸棱 (inner cue)
  | { kind: "chest-open" } // G06/G10 宝箱打开 (inner cue)
  | { kind: "projectile"; side: "left" | "right"; speed: "fast" | "slow" }
  | { kind: "area"; anchor: "a" | "b" | "c" | "d"; speed: "fast" | "slow" }
  | { kind: "g08-rain" }
  | { kind: "g12-firework" };

/** Base sample id for one resolved cue point; undefined = no sample in v2. */
export function cueBaseSampleId(cue: CuePoint): SampleBaseId | undefined {
  switch (cue.kind) {
    case "g01-unlock":
      return "sth.g01.unlock";
    case "g02-rubble":
      return "sth.g02.rubble";
    case "g03-burn-start":
      return "sth.g03.fire";
    case "g04-ghost-pass":
      return "sth.g04.ghost";
    case "chest-cue":
      return cue.side === "left" ? "sth.g05.chest.left" : "sth.g05.chest.right";
    case "ridge-trace":
      return "sth.g06.ridge";
    case "chest-open":
      return "sth.g06.open";
    case "projectile": {
      return `sth.g07.projectile.${cue.side}.${cue.speed}` as SampleBaseId;
    }
    case "area":
      return `sth.g07.area.${cue.anchor}.${cue.speed}` as SampleBaseId;
    case "g08-rain":
      return "sth.g08.rain";
    case "g12-firework":
      return "sth.g12.fireworks";
  }
}

// ---------------- Timeline-event -> cue points ----------------

export type TimelineEventLike = {
  id: string;
  kind?: string;
  parameters?: Record<string, string | number | boolean>;
};

/** Only G01 waits for its own E/O; G06/G10 begin after G05/G09 opens its chest. */
export function isCueInteractionReady(eventId: string, interactionActive: boolean) {
  return eventId !== "G01" || interactionActive;
}

/**
 * 事件内的显式 cue（设计规格 §7.2 + Phase 5）：每个 cue 带事件内偏移
 * （offsetMs，相对事件开始）与已解析的基础样本 ID。
 * - G03 的 02 对齐燃烧开始（castEndMs），不是施法蓄力；
 * - G04 的 03 对齐幽灵开始穿过（ghostStartMs）；
 * - G06/G10 仅在划凸棱音效/动画期间触发 ridge cue；开箱只播音画；
 * - G12 的 09 对齐第一枚烟花升空（bossDefeatMs）；
 * - 宝箱 04a/04b 由实际生成的宝箱侧别解析；
 * - G07/G11 锚点未知时 baseSampleId 为 undefined —— 正式模式必须失败关闭。
 */
export type TimelineCue = {
  cueKey: string;
  cue: CuePoint;
  offsetMs: number;
  baseSampleId: SampleBaseId | undefined;
};

import {
  G03_TIMING,
  G02_TIMING,
  G04_TIMING,
  G05_TIMING,
  G06_TIMING,
  G09_TIMING,
  G12_TIMING
} from "./eventTimeline";

const G03_CAST_END_MS = G03_TIMING.castEndMs;
const G02_RUBBLE_START_MS = G02_TIMING.rubbleStartMs;
const G04_AUDIO_START_MS = G04_TIMING.audioStartMs;
const G05_AUDIO_START_MS = G05_TIMING.audioStartMs;
const G09_TASK_MS = G09_TIMING.taskStartMs;
const G06_SETTLE_MS = G06_TIMING.settleEndMs;
const G12_BOSS_DEFEAT_MS = G12_TIMING.bossDefeatMs;

/** 事件内全部 cue（含偏移）；运行时按 offsetMs 判定是否到期。 */
export function eventCues(event: TimelineEventLike, areaCenter: number | undefined, chestX: number | undefined): TimelineCue[] {
  const id = event.id;
  if (id === "G01") return [{ cueKey: "g01", cue: { kind: "g01-unlock" }, offsetMs: 0, baseSampleId: "sth.g01.unlock" }];
  if (id === "G02")
    return [{ cueKey: "g02-rubble", cue: { kind: "g02-rubble" }, offsetMs: G02_RUBBLE_START_MS, baseSampleId: "sth.g02.rubble" }];
  if (id === "G02-G03-PAUSE" || id === "G07-G08-PAUSE") return [];
  if (id === "G03")
    return [{ cueKey: "g03-burn", cue: { kind: "g03-burn-start" }, offsetMs: G03_CAST_END_MS, baseSampleId: "sth.g03.fire" }];
  if (id === "G04")
    return [{ cueKey: "g04-ghost", cue: { kind: "g04-ghost-pass" }, offsetMs: G04_AUDIO_START_MS, baseSampleId: "sth.g04.ghost" }];
  if (event.kind === "chest-discovery" || id === "G05" || id === "G09") {
    // 侧别由实际生成的宝箱位置决定；未知时失败关闭（undefined）
    const side = chestX !== undefined ? (chestX < 50 ? "left" : "right") : undefined;
    return [
      {
        cueKey: "chest",
        cue: { kind: "chest-cue", side: side ?? "right" },
        offsetMs: Number(
          event.parameters?.cueStartMs ??
            (id === "G05" ? G05_AUDIO_START_MS : id === "G09" ? G09_TASK_MS : 0),
        ),
        baseSampleId: side === undefined ? undefined : cueBaseSampleId({ kind: "chest-cue", side })
      }
    ];
  }
  if (id === "06" || id === "G06" || id === "G10") {
    // G06/G10：仅划凸棱触觉与其音画同步；随后开箱不触发电刺激。
    return [
      { cueKey: "ridge", cue: { kind: "ridge-trace" }, offsetMs: G06_SETTLE_MS, baseSampleId: "sth.g06.ridge" }
    ];
  }
  if (id.startsWith("G07-") || id.startsWith("G11-")) {
    if (event.kind === "projectile") {
      const side = event.parameters?.direction === "left" ? "left" : "right";
      const speed = event.parameters?.speed === "fast" ? "fast" : "slow";
      const baseSampleId = cueBaseSampleId({ kind: "projectile", side, speed });
      return [{ cueKey: "projectile", cue: { kind: "projectile", side, speed }, offsetMs: 0, baseSampleId }];
    }
    if (event.kind === "area") {
      const anchor = areaAnchorOf(areaCenter);
      const speed = event.parameters?.speed === "fast" ? "fast" : "slow";
      return [
        {
          cueKey: "area",
          cue: { kind: "area", anchor: anchor ?? "a", speed },
          offsetMs: Number(event.parameters?.telegraphMs ?? 300),
          baseSampleId: anchor === undefined ? undefined : cueBaseSampleId({ kind: "area", anchor, speed })
        }
      ];
    }
  }
  if (id === "G08") return [{ cueKey: "rain", cue: { kind: "g08-rain" }, offsetMs: 0, baseSampleId: "sth.g08.rain" }];
  if (id === "G12")
    return [{ cueKey: "firework", cue: { kind: "g12-firework" }, offsetMs: G12_BOSS_DEFEAT_MS, baseSampleId: "sth.g12.fireworks" }];
  return [];
}

/** 当前事件内已到期且未触发的 cue（每帧调用；firedKeys 防止重复触发）。 */
export function dueCues(
  event: TimelineEventLike,
  elapsedWithinMs: number,
  areaCenter: number | undefined,
  chestX: number | undefined,
  firedKeys: ReadonlySet<string>
): TimelineCue[] {
  // `firedKeys` lives for one whole game run.  Prefixing with the realized
  // timeline event prevents G05 from suppressing G09, G06 from suppressing
  // G10, or one combat projectile/area from suppressing its successors.
  return eventCues(event, areaCenter, chestX)
    .map(cue => ({ ...cue, cueKey: `${event.id}:${cue.cueKey}` }))
    .filter(cue => !firedKeys.has(cue.cueKey) && elapsedWithinMs >= cue.offsetMs);
}

/**
 * Resolves the cue points carried by a timeline event.
 * - G02 rubble and all other documented game cues resolve to real samples.
 * - G06/G10 only expose ridge-trace; chest opening is audio-visual only.
 * - G07/G11 sub-events resolve side/speed/anchor from realized parameters.
 *   The realized area centre maps to the four fixed anchors:
 *   10 -> a, 45 -> b, 55 -> c, 90 -> d.
 */
export function cuesForTimelineEvent(event: TimelineEventLike, areaCenter?: number, chestX?: number): CuePoint[] {
  const id = event.id;
  if (id === "G01") return [{ kind: "g01-unlock" }];
  if (id === "G02") return [{ kind: "g02-rubble" }];
  if (id === "G03") return [{ kind: "g03-burn-start" }];
  if (id === "G04") return [{ kind: "g04-ghost-pass" }];
  if (event.kind === "chest-discovery" || id === "G05" || id === "G09") {
    const positionedX = chestX ?? (typeof event.parameters?.chestX === "number" ? event.parameters.chestX : undefined);
    const side = positionedX !== undefined
      ? (positionedX < 50 ? "left" : "right")
      : id === "G05"
        ? event.parameters?.chestSide
        : "right";
    return [{ kind: "chest-cue", side: side === "left" ? "left" : "right" }];
  }
  if (id === "G06" || id === "G10") return [{ kind: "ridge-trace" }];
  if (id === "G08") return [{ kind: "g08-rain" }];
  if (id === "G12") return [{ kind: "g12-firework" }];
  if (id.startsWith("G07-") || id.startsWith("G11-")) {
    if (event.kind === "projectile") {
      return [
        {
          kind: "projectile",
          side: event.parameters?.direction === "left" ? "left" : "right",
          speed: event.parameters?.speed === "fast" ? "fast" : "slow"
        }
      ];
    }
    if (event.kind === "area") {
      const anchor = areaAnchorOf(areaCenter);
      if (anchor === undefined) return [];
      return [{ kind: "area", anchor, speed: event.parameters?.speed === "fast" ? "fast" : "slow" }];
    }
  }
  return [];
}

/** The four fixed danger-area anchors, left to right. */
export function areaAnchorOf(center: number | undefined): "a" | "b" | "c" | "d" | undefined {
  switch (center) {
    case 10:
      return "a";
    case 45:
      return "b";
    case 55:
      return "c";
    case 90:
      return "d";
    default:
      return undefined;
  }
}
