import type { RunMode } from "./types";

export type TimelineScene =
  "mechanism" | "side-scroll" | "chest-detail" | "ending";
export type TimelineKind =
  | "mechanism"
  | "cinematic"
  | "combat-intro"
  | "combat-break"
  | "chest-discovery"
  | "chest"
  | "projectile"
  | "area"
  | "finale"
  | "ending";
export type TimelineEvent = {
  id: string;
  scene: TimelineScene;
  kind: TimelineKind;
  durationMs: number;
  transition: "auto" | "player-interact" | "combat-complete";
  visibility: "full" | "limited" | "restore";
  visualAsset?: string;
  audioAsset?: string;
  hapticSampleKey: string;
  parameters: Record<string, string | number | boolean>;
  skipAllowed: boolean;
};

export const CHEST_PLACEMENT = {
  leftX: 17,
  rightX: 83,
  splitX: 50,
  interactionRadius: 11,
} as const;

export function resolveOppositeChestX(playerX: number) {
  return playerX < CHEST_PLACEMENT.splitX
    ? CHEST_PLACEMENT.rightX
    : CHEST_PLACEMENT.leftX;
}

export function isPlayerWithinChestInteraction(
  playerX: number,
  chestX: number,
) {
  return Math.abs(playerX - chestX) <= CHEST_PLACEMENT.interactionRadius;
}

export function resolveEdgeLockAnchor(playerX: number) {
  return playerX <= 25 ? 10 : playerX <= 50 ? 45 : playerX <= 75 ? 55 : 90;
}

export const G01_TIMING = {
  startDelayMs: 400,
  edgeMs: 1000,
  traceEndMs: 4400,
  unlockConfirmMs: 600,
  // The 5.085 s unlock cue must finish before the entrance sound begins.
  enterSoundAtMs: 5085,
  transitionMs: 1040,
  totalMs: 6125,
} as const;

export const G01_ASSETS = {
  background: "/assets/events/G01/bgG01.png",
  finger: "/assets/events/G01/finger.png",
  unlockAudio: "/assets/music/new/g01-unlock.wav",
  enterAudio: "/assets/music/new/g01-enter-ruins.wav",
} as const;

export const G02_TIMING = {
  // At 30 fps, frame 23 lands at 766.7 ms; use 767 ms to align the landing audio.
  heroFallEndMs: 767,
  pauseEndMs: 1967,
  bossFallEndMs: 4767,
  impactEndMs: 5167,
  rubbleStartMs: 5167,
  rubbleRiseEndMs: 6667,
  rubbleHoldEndMs: 7667,
  rubbleEndMs: 9667,
  totalMs: 9667,
} as const;

export type G02Phase =
  | "hero-fall"
  | "pause"
  | "boss-fall"
  | "impact"
  | "rubble-rise"
  | "rubble-hold"
  | "rubble-fade"
  | "complete";
export function getG02Phase(elapsedMs: number): G02Phase {
  if (elapsedMs < G02_TIMING.heroFallEndMs) return "hero-fall";
  if (elapsedMs < G02_TIMING.pauseEndMs) return "pause";
  if (elapsedMs < G02_TIMING.bossFallEndMs) return "boss-fall";
  if (elapsedMs < G02_TIMING.impactEndMs) return "impact";
  if (elapsedMs < G02_TIMING.rubbleRiseEndMs) return "rubble-rise";
  if (elapsedMs < G02_TIMING.rubbleHoldEndMs) return "rubble-hold";
  if (elapsedMs < G02_TIMING.rubbleEndMs) return "rubble-fade";
  return "complete";
}

export const G02_ASSETS = {
  heroAudio: "/assets/music/new/g02-hero-drop.wav",
  bossAudio: "/assets/music/new/g02-boss-drop.wav",
  rubbleAudio: "/assets/music/new/g02-rubble-flight.wav",
  impactDust: "/assets/events/G02/g02-impact-dust.png",
} as const;

export const G03_TIMING = {
  castFrame2AtMs: 600,
  castEndMs: 1800,
  // Fire audio and the paired 30 Hz haptic sample both last 5.550 s.
  // Keep this event alive until they finish so G04 never prepares while G03
  // is still playing on the one-output hardware.
  burnEndMs: 7350,
  totalMs: 7350,
} as const;

export type G03Phase = "casting" | "burning" | "complete";
export function getG03Phase(elapsedMs: number): G03Phase {
  if (elapsedMs < G03_TIMING.castEndMs) return "casting";
  if (elapsedMs < G03_TIMING.burnEndMs) return "burning";
  return "complete";
}

export const G03_ASSETS = {
  bossFrames: Array.from(
    { length: 2 },
    (_, index) =>
      `/assets/events/G03/boss-cast-${String(index + 1).padStart(2, "0")}.png`,
  ),
  fireFrames: Array.from(
    { length: 6 },
    (_, index) => `/assets/events/G03/fire-${index + 1}.png`,
  ),
  castAudio: "/assets/music/new/g03-boss-cast.wav",
  fireAudio: "/assets/music/new/g03-fire.wav",
} as const;

export const G04_TIMING = {
  audioStartMs: 1000,
  ghostStartMs: 2000,
  audioDurationMs: 5880,
  ghostEndMs: 6880,
  totalMs: 6880,
} as const;

export type G04Phase =
  "silent-pause" | "audio-lead" | "ghost-pass" | "complete";
export function getG04Phase(elapsedMs: number): G04Phase {
  if (elapsedMs < G04_TIMING.audioStartMs) return "silent-pause";
  if (elapsedMs < G04_TIMING.ghostStartMs) return "audio-lead";
  if (elapsedMs < G04_TIMING.ghostEndMs) return "ghost-pass";
  return "complete";
}

export const G04_ASSETS = {
  ghost: "/assets/events/G04/ghost.png",
  audio: "/assets/music/new/g04-ghost.wav",
} as const;

export const G05_TIMING = {
  pauseEndMs: 1000,
  audioStartMs: 1000,
  cueStartMs: 1500,
} as const;

export const G09_TIMING = {
  taskStartMs: 2000,
  audioStartMs: 2000,
} as const;

export const G05_ASSETS = {
  chest: "/assets/events/G05+G09/chest-pixel.png",
  audio: "/assets/music/new/g05-g09-chest-cue.wav",
} as const;

export const G06_TIMING = {
  settleEndMs: 600,
  // The ridge animation follows the whole 3.483 s haptic sample from 0.600 s.
  traceEndMs: 4083,
  unlockEndMs: 4083,
  openAtMs: 4083,
  openEndMs: 5300,
  glowEndMs: 6300,
  totalMs: 6300,
} as const;

export const G06_ASSETS = {
  closed: "/assets/events/G06+G10/g06-chest-closed-v1.png",
  open: "/assets/events/G06+G10/g06-chest-open-v1.png",
  finger: "/assets/events/G06+G10/finger.png",
  traceAudio: "/assets/music/new/g06-g10-ridge-trace.wav",
  openAudio: "/assets/music/new/g06-g10-chest-open.wav",
} as const;

/** 新增战斗内宝箱：只播放开箱音画，不进入 G06/G10 划棱。 */
export const DIRECT_CHEST_TIMING = {
  cueStartMs: 0,
  openDurationMs: G06_TIMING.openEndMs - G06_TIMING.openAtMs,
  postOpenDelayMs: 1000,
  totalMs:
    G06_TIMING.openEndMs - G06_TIMING.openAtMs + 1000,
} as const;

export const G07_PROJECTILE_TIMING = {
  slowMs: 5000,
  fastMs: 3000,
} as const;

export const G07_AREA = {
  halfWidthPercent: 30,
  // Lock the offset target briefly before it begins expanding.
  telegraphMs: 300,
  slowExpansionMs: 2200,
  fastExpansionMs: 1765,
  slowMs: 2800,
  fastMs: 2365,
} as const;

// Each combat stage contains 24 fixed attack events: 16 projectiles and 8 areas.
// The HUD derives its value solely from the realized event order, not hit results.
export const BOSS_HP = {
  max: 100,
  attacksPerStage: 24,
  totalAttacks: 48,
  damagePerAttack: 100 / 48,
} as const;

export function getBossAttackCount(event?: TimelineEvent) {
  if (!event) return 0;
  const completedCount = Number(event.parameters.completedAttackCount);
  if (Number.isFinite(completedCount))
    return Math.max(0, Math.min(BOSS_HP.totalAttacks, completedCount));
  if (event.kind === "combat-intro")
    return event.parameters.stage === "B" ? BOSS_HP.attacksPerStage : 0;
  const ordinal = Number(event.parameters.stageOrdinal ?? 0);
  if (event.id.startsWith("G07-"))
    return Math.max(0, Math.min(BOSS_HP.attacksPerStage, ordinal));
  if (event.id.startsWith("G11-"))
    return Math.max(
      BOSS_HP.attacksPerStage,
      Math.min(BOSS_HP.totalAttacks, BOSS_HP.attacksPerStage + ordinal),
    );
  if (["G08", "G09", "G10"].includes(event.id)) return BOSS_HP.attacksPerStage;
  if (event.id === "G12") return BOSS_HP.totalAttacks;
  return 0;
}

export function getBossHpAfterAttacks(attackCount: number) {
  const clampedCount = Math.max(0, Math.min(BOSS_HP.totalAttacks, attackCount));
  return Math.max(
    0,
    Math.round((BOSS_HP.max - clampedCount * BOSS_HP.damagePerAttack) * 100) /
      100,
  );
}

export const G07_ASSETS = {
  projectile: "/assets/events/G07+G11/g07-projectile.png",
  projectileFastAudio: "/assets/music/new/g07-g11-projectile-fast.wav",
  projectileSlowAudio: "/assets/music/new/g07-g11-projectile-slow.wav",
  areaGroundFill: "/assets/events/G07+G11/g07-area-ground-fill-v1.png",
  areaMarkerFrames: "/assets/events/G07+G11/g07-area-marker-frames-v1.png",
  areaImpactFrames: "/assets/events/G07+G11/g07-area-impact-frames-v1.png",
  areaFastAudio: "/assets/music/new/g07-g11-area-fast.wav",
  areaSlowAudio: "/assets/music/new/g07-g11-area-slow.wav",
  areaImpactAudio: "/assets/music/new/g07-g11-area-impact.wav",
} as const;
export const G09_ASSETS = {
  chest: "/assets/events/G05+G09/chest-pixel.png",
  audio: "/assets/music/new/g05-g09-chest-cue.wav",
} as const;
export const G10_ASSETS = {
  closed: "/assets/events/G06+G10/g06-chest-closed-v1.png",
  open: "/assets/events/G06+G10/g06-chest-open-v1.png",
  finger: "/assets/events/G06+G10/finger.png",
  traceAudio: "/assets/music/new/g06-g10-ridge-trace.wav",
  openAudio: "/assets/music/new/g06-g10-chest-open.wav",
} as const;
export const G11_ASSETS = {
  projectile: "/assets/events/G07+G11/g07-projectile.png",
  projectileFastAudio: "/assets/music/new/g07-g11-projectile-fast.wav",
  projectileSlowAudio: "/assets/music/new/g07-g11-projectile-slow.wav",
} as const;
export const G08_ASSETS = {
  rainAudio: "/assets/music/new/g08-rain.wav",
} as const;
export const G12_ASSETS = { audio: "/assets/music/new/g12-fireworks.wav" } as const;
export const G12_TIMING = { bossDefeatMs: 3000, totalMs: 8000 } as const;

export const BOSS_X_PERCENT = 66;

export const G08_TIMING = { totalMs: 6500 } as const;

export function getProjectileX(event: TimelineEvent, elapsedMs: number) {
  const progress = Math.min(
    1,
    Math.max(0, elapsedMs / Math.max(1, event.durationMs)),
  );
  return event.parameters.direction === "left"
    ? -5 + progress * 110
    : 105 - progress * 110;
}

export function getAreaExpansionProgress(
  event: TimelineEvent,
  elapsedMs: number,
) {
  const telegraphMs = Number(event.parameters.telegraphMs ?? 0);
  const expansionMs = Number(
    event.parameters.expansionMs ?? Math.max(1, event.durationMs - telegraphMs),
  );
  return Math.min(
    1,
    Math.max(0, (elapsedMs - telegraphMs) / Math.max(1, expansionMs)),
  );
}

export function isAreaImpactHit(
  event: TimelineEvent,
  elapsedMs: number,
  playerX: number,
) {
  const impactAtMs = Number(event.parameters.impactAtMs ?? event.durationMs);
  const impactWindowMs = Number(event.parameters.impactWindowMs ?? 200);
  const center = Number(event.parameters.center ?? 50);
  const halfWidth = Number(event.parameters.halfWidth ?? 20);
  return (
    elapsedMs >= impactAtMs &&
    elapsedMs <= impactAtMs + impactWindowMs &&
    Math.abs(playerX - center) < halfWidth
  );
}

type G02RubbleParticle = {
  id: number;
  asset: string;
  startX: number;
  startY: number;
  targetX: number;
  targetY: number;
  size: number;
  delayMs: number;
  rotation: number;
  driftX: number;
  driftMidX: number;
  fallY: number;
  durationMs: number;
  layer: 4 | 9;
};

// Hand-composed rather than sampled from a grid. The field is intentionally
// dense around the guard, with a few small fragments reaching the far side.
const rubbleLayout = [
  [8, 14, 24, -210, -4, 4],
  [17, 27, 30, 145, 3, 4],
  [27, 10, 22, 310, -5, 4],
  [35, 31, 46, -260, -4, 9],
  [39, 57, 58, 185, -6, 9],
  [43, 18, 33, -125, 3, 4],
  [47, 45, 72, 275, -5, 9],
  [51, 7, 27, 160, 4, 4],
  [54, 64, 39, -330, -3, 9],
  [57, 29, 52, 215, 5, 4],
  [60, 49, 84, -170, -6, 9],
  [62, 13, 36, 345, 4, 4],
  [65, 37, 44, -285, -3, 9],
  [67, 22, 68, 130, 5, 4],
  [69, 59, 31, 255, -4, 9],
  [71, 8, 48, -200, 3, 4],
  [73, 43, 91, 325, -5, 9],
  [75, 26, 38, -150, 4, 4],
  [77, 55, 61, 230, 6, 9],
  [79, 12, 29, -315, -3, 4],
  [81, 35, 76, 170, 5, 9],
  [83, 19, 42, -245, -4, 4],
  [85, 47, 55, 295, 6, 9],
  [87, 7, 24, -110, 3, 4],
  [89, 29, 66, 205, 5, 9],
  [91, 59, 35, -340, -4, 9],
  [93, 16, 50, 265, 4, 4],
  [95, 39, 79, -190, 6, 9],
  [97, 25, 31, 335, 3, 4],
  [98, 52, 47, -275, 5, 9],
  [58, 70, 25, 120, -2, 9],
  [84, 66, 28, -220, 3, 9],
] as const;

export const G02_RUBBLE_PARTICLES: ReadonlyArray<G02RubbleParticle> =
  Array.from({ length: 48 }, (_, index) => {
    const layout = rubbleLayout[index % rubbleLayout.length];
    const secondary = index >= rubbleLayout.length;
    const targetOffset = secondary ? ((index % 5) - 2) * 1.35 : 0;
    return {
      id: index + 1,
      asset: `/assets/events/G02/rock-${String((index % 8) + 1).padStart(2, "0")}.png`,
      startX: BOSS_X_PERCENT + 1.5 + ((index * 7) % 9) * 0.55,
      startY: 77 + ((index * 5) % 7) * 0.42,
      targetX: Math.max(3, Math.min(98, layout[0] + targetOffset)),
      targetY: Math.max(4, layout[1] + (secondary ? ((index % 3) - 1) * 2 : 0)),
      size: layout[2] * (secondary ? 0.78 : 1.12),
      rotation: layout[3] + (secondary ? 75 : 0),
      driftX: layout[4],
      driftMidX: layout[4] * 0.42,
      fallY: 10 + (index % 6) * 1.5,
      durationMs: 3200 + ((index * 173) % 1200),
      layer: layout[5],
      delayMs: (index * 47) % 320,
    };
  });

const hapticSampleKeyFor = (id: string, kind: TimelineKind) => {
  if (kind === "projectile") return "projectile-pass";
  if (kind === "area") return "danger-area-expand";
  if (kind === "combat-intro" || kind === "combat-break") return "none";
  if (id === "G01") return "mechanism-unlock";
  if (id === "G02") return "landing-rubble";
  if (id === "G03") return "fire-burn";
  if (id === "G04") return "ghost-pass";
  if (kind === "chest-discovery") return "chest-cue";
  if (id === "G06" || id === "G10") return "ridge-unlock";
  if (id === "G08") return "rain";
  if (id === "G12") return "fireworks";
  return "none";
};
const event = (
  id: string,
  scene: TimelineScene,
  kind: TimelineKind,
  durationMs: number,
  visibility: TimelineEvent["visibility"],
  parameters: TimelineEvent["parameters"] = {},
  transition: TimelineEvent["transition"] = "auto",
): TimelineEvent => ({
  id,
  scene,
  kind,
  durationMs,
  transition,
  visibility,
  hapticSampleKey: hapticSampleKeyFor(id, kind),
  parameters,
  skipAllowed: true,
});

export function getEventPrompt(event: TimelineEvent, elapsedMs = 0) {
  const direction = event.parameters.direction === "left" ? "左侧" : "右侧";
  const speed = event.parameters.speed === "fast" ? "快速" : "常速";
  if (event.kind === "projectile") return "飞行物来袭，请注意躲避";
  if (event.kind === "area") return "危险区域扩张，请注意躲避";
  if (event.kind === "chest-discovery")
    return event.parameters.directOpen === true && event.parameters.opening === true
      ? "宝箱已找到，正在开启"
      : "在环境中寻找宝箱并按手柄O键进行交互";
  if (event.kind === "combat-break") return "";
  if (event.kind === "combat-intro")
    return `${Math.max(0, Math.ceil((event.durationMs - elapsedMs) / 1000))}秒后 boss开始攻击 请躲避相应飞行物及危险区域`;
  const prompts: Record<string, string> = {
    G01: "打开机关，进入月萤遗迹",
    G02: "守卫从高空坠落 · 石块向四周飞散",
    G03: "守卫施放魔火 · 玩家进入燃烧状态",
    G04: "幽灵群穿过遗迹 · 可见范围逐渐缩小",
    G05: "在环境中寻找宝箱并按手柄O键进行交互",
    G06: "沿横向凸棱划过 · 点亮机关并开启宝箱",
    G08: "雨水逐渐落下 · 可见范围正在恢复",
    G09: "在环境中寻找宝箱并按手柄O键进行交互",
    G10: "再次划过横向凸棱 · 开启第二个宝箱",
    G12: "游戏胜利！",
  };
  return prompts[event.id] ?? "遗迹事件开始";
}

export const TIMELINE_EVENTS: TimelineEvent[] = [
  event(
    "G01",
    "mechanism",
    "mechanism",
    G01_TIMING.totalMs,
    "full",
    { label: "打开机关，进入月萤遗迹", direction: "counterclockwise" },
    "player-interact",
  ),
  event("G02", "side-scroll", "cinematic", G02_TIMING.totalMs, "full", {
    effect: "boss-landing",
    bossX: BOSS_X_PERCENT,
    heroEntryMs: G02_TIMING.heroFallEndMs,
    bossEntryMs: G02_TIMING.pauseEndMs,
    rubbleStartMs: G02_TIMING.rubbleStartMs,
  }),
  event("G02-G03-PAUSE", "side-scroll", "combat-break", 2000, "full", {
    safeInterval: true,
    bridge: "G02-G03",
  }),
  event("G03", "side-scroll", "cinematic", G03_TIMING.totalMs, "full", {
    effect: "boss-cast-fire",
    castEndMs: G03_TIMING.castEndMs,
    burnEndMs: G03_TIMING.burnEndMs,
  }),
  event("G04", "side-scroll", "cinematic", G04_TIMING.totalMs, "limited", {
    effect: "ghost-pass",
    audioStartMs: G04_TIMING.audioStartMs,
    ghostStartMs: G04_TIMING.ghostStartMs,
    ghostEndMs: G04_TIMING.ghostEndMs,
  }),
  event(
    "G05",
    "side-scroll",
    "chest-discovery",
    0,
    "limited",
    {
      chestSide: "left",
      chestX: 17,
      audioStartMs: G05_TIMING.audioStartMs,
      cueStartMs: G05_TIMING.cueStartMs,
    },
    "player-interact",
  ),
  event("G06", "chest-detail", "chest", G06_TIMING.totalMs, "limited", {
    ridges: 1,
    direction: "left-to-right",
    returnVision: 10,
  }),
  event(
    "G07",
    "side-scroll",
    "cinematic",
    0,
    "limited",
    { stage: "A" },
    "combat-complete",
  ),
  event("G07-G08-PAUSE", "side-scroll", "combat-break", 2000, "limited", {
    safeInterval: true,
    bridge: "G07-G08",
    completedAttackCount: BOSS_HP.attacksPerStage,
  }),
  event("G08", "side-scroll", "cinematic", G08_TIMING.totalMs, "restore", {
    effect: "boss-shake",
    weather: "rain",
  }),
  event(
    "G09",
    "side-scroll",
    "chest-discovery",
    0,
    "full",
    { chestSide: "right", chestX: 83 },
    "player-interact",
  ),
  event("G10", "chest-detail", "chest", G06_TIMING.totalMs, "full", {
    ridges: 1,
    direction: "left-to-right",
  }),
  event(
    "G11",
    "side-scroll",
    "cinematic",
    0,
    "full",
    { stage: "B" },
    "combat-complete",
  ),
  event("G12", "side-scroll", "finale", G12_TIMING.totalMs, "full", {
    effect: "boss-defeated-fireworks",
  }),
];
const combatIntro = (stage: "A" | "B") =>
  event(
    `G${stage === "A" ? "07" : "11"}-READY`,
    "side-scroll",
    "combat-intro",
    3000,
    stage === "A" ? "limited" : "full",
    { stage, countdown: true },
  );
const combatBreak = (
  stage: "A" | "B",
  index: number,
  durationMs: number,
  completedStageAttacks: number,
) =>
  event(
    `G${stage === "A" ? "07" : "11"}-BREAK${String(index).padStart(2, "0")}`,
    "side-scroll",
    "combat-break",
    durationMs,
    stage === "A" ? "limited" : "full",
    {
      stage,
      safeInterval: true,
      completedAttackCount:
        (stage === "B" ? BOSS_HP.attacksPerStage : 0) + completedStageAttacks,
    },
  );
const directChestTrial = (stage: "A" | "B", index: number, completedAttackCount: number) =>
  event(
    `G${stage === "A" ? "07" : "11"}-CHEST0${index}`,
    "side-scroll",
    "chest-discovery",
    DIRECT_CHEST_TIMING.totalMs,
    stage === "A" ? "limited" : "full",
    {
      stage,
      directOpen: true,
      chestTrialIndex: index + 1,
      completedAttackCount:
        (stage === "B" ? BOSS_HP.attacksPerStage : 0) + completedAttackCount,
      cueStartMs: DIRECT_CHEST_TIMING.cueStartMs,
      audioStartMs: DIRECT_CHEST_TIMING.cueStartMs,
      openDurationMs: DIRECT_CHEST_TIMING.openDurationMs,
      postOpenDelayMs: DIRECT_CHEST_TIMING.postOpenDelayMs,
    },
    "player-interact",
  );
const hash = (value: string) =>
  [...value].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 2166136261);
const random = (seed: string) => {
  let n = hash(seed);
  return () => {
    n |= 0;
    n = (n + 0x6d2b79f5) | 0;
    let t = Math.imul(n ^ (n >>> 15), 1 | n);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
const projectileSamples = (["left", "right"] as const).flatMap((direction) =>
  (["slow", "fast"] as const).flatMap((speed) =>
    [1, 2, 3, 4].map((repeat) => ({ direction, speed, repeat })),
  ),
);
// Both speeds receive the same four absolute coordinates. The run seed only
// changes their order, preserving expansion speed as the sole comparison factor.
const areaAnchors = [10, 45, 55, 90] as const;
const areaSamples = (["slow", "fast"] as const).flatMap((speed) =>
  areaAnchors.map((anchorX, index) => ({ speed, repeat: index + 1, anchorX })),
);
const g07Attacks = () => {
  const projectiles = projectileSamples.map((sample, index) => ({
    ...event(
      `G07-P${String(index + 1).padStart(2, "0")}`,
      "side-scroll",
      "projectile",
      sample.speed === "fast"
        ? G07_PROJECTILE_TIMING.fastMs
        : G07_PROJECTILE_TIMING.slowMs,
      "limited",
    ),
    parameters: { stage: "A", ...sample },
  }));
  const areas = areaSamples.map((sample, index) => ({
    ...event(
      `G07-A${String(index + 1).padStart(2, "0")}`,
      "side-scroll",
      "area",
      sample.speed === "fast" ? G07_AREA.fastMs : G07_AREA.slowMs,
      "limited",
    ),
    parameters: {
      stage: "A",
      ...sample,
      targetMode: "fixed-anchor",
      halfWidth: G07_AREA.halfWidthPercent,
      telegraphMs: G07_AREA.telegraphMs,
      expansionMs:
        sample.speed === "fast"
          ? G07_AREA.fastExpansionMs
          : G07_AREA.slowExpansionMs,
      impactAtMs:
        G07_AREA.telegraphMs +
        (sample.speed === "fast"
          ? G07_AREA.fastExpansionMs
          : G07_AREA.slowExpansionMs) +
        120,
    },
  }));
  return { projectiles, areas };
};

const g11Attacks = () => {
  const projectiles = projectileSamples.map((sample, index) => ({
    ...event(
      `G11-P${String(index + 1).padStart(2, "0")}`,
      "side-scroll",
      "projectile",
      sample.speed === "fast"
        ? G07_PROJECTILE_TIMING.fastMs
        : G07_PROJECTILE_TIMING.slowMs,
      "full",
    ),
    parameters: { stage: "B", ...sample, stageOrdinal: index + 1 },
  }));
  const areas = areaSamples.map((sample, index) => ({
    ...event(
      `G11-A${String(index + 1).padStart(2, "0")}`,
      "side-scroll",
      "area",
      sample.speed === "fast" ? G07_AREA.fastMs : G07_AREA.slowMs,
      "full",
    ),
    parameters: {
      stage: "B",
      ...sample,
      targetMode: "fixed-anchor",
      halfWidth: G07_AREA.halfWidthPercent,
      telegraphMs: G07_AREA.telegraphMs,
      expansionMs:
        sample.speed === "fast"
          ? G07_AREA.fastExpansionMs
          : G07_AREA.slowExpansionMs,
      impactAtMs:
        G07_AREA.telegraphMs +
        (sample.speed === "fast"
          ? G07_AREA.fastExpansionMs
          : G07_AREA.slowExpansionMs) +
        120,
      stageOrdinal: projectiles.length + index + 1,
    },
  }));
  return [...projectiles, ...areas];
};

export function buildStageOrder(stage: "A" | "B", mode: RunMode, seed: string) {
  const number = (items: TimelineEvent[]) =>
    items.map((item, index) => ({
      ...item,
      parameters: { ...item.parameters, stageOrdinal: index + 1 },
    }));
  const r = random(`${seed}-${stage}-${mode}`);
  const shuffle = <T>(items: T[]) => {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  };
  const interleave = (
    projectileItems: TimelineEvent[],
    areaItems: TimelineEvent[],
  ) => {
    const projectiles = shuffle(projectileItems);
    const areas = shuffle(areaItems);
    const mixed: TimelineEvent[] = [];
    let projectileRun = 0;
    while (projectiles.length || areas.length) {
      const mustUseArea = projectileRun >= 2 && areas.length > 0;
      const mustUseProjectile =
        areas.length === 0 ||
        (mixed.at(-1)?.kind === "area" && projectiles.length > 0) ||
        projectiles.length > areas.length * 2;
      const chooseArea =
        mustUseArea ||
        (!mustUseProjectile &&
          areas.length > 0 &&
          r() < areas.length / (areas.length + projectiles.length));
      if (chooseArea) {
        mixed.push(areas.shift()!);
        projectileRun = 0;
      } else {
        mixed.push(projectiles.shift()!);
        projectileRun++;
      }
    }
    return mixed;
  };
  const addAreaGaps = (items: TimelineEvent[]) => {
    let gapIndex = 0;
    return items.flatMap((item, index) =>
      item.kind === "area" &&
      items[index + 1]?.kind !== "chest-discovery" &&
      items.slice(index + 1).some((next) => next.kind === "area")
        ? [
            item,
            combatBreak(
              stage,
              ++gapIndex,
              1000 + Math.floor(r() * 1001),
              Number(item.parameters.stageOrdinal ?? 0),
            ),
          ]
        : [item],
    );
  };
  const addChestTrials = (items: TimelineEvent[]) => {
    let completedAttacks = 0;
    let chestIndex = 0;
    return items.flatMap(item => {
      if (item.kind === "projectile" || item.kind === "area") completedAttacks++;
      if (![8, 16, 24].includes(completedAttacks)) return [item];
      return [item, directChestTrial(stage, ++chestIndex, completedAttacks)];
    });
  };
  if (stage === "A") {
    const { projectiles, areas } = g07Attacks();
    return [
      combatIntro(stage),
      ...addAreaGaps(addChestTrials(number(interleave(projectiles, areas)))),
    ];
  }
  const list = g11Attacks();
  return [
    combatIntro(stage),
    ...addAreaGaps(
      addChestTrials(
        number(
          interleave(
            list.filter((item) => item.kind === "projectile"),
            list.filter((item) => item.kind === "area"),
          ),
        ),
      ),
    ),
  ];
}
export function validateTimeline(events: TimelineEvent[]) {
  const ids = new Set<string>();
  const errors = events.flatMap((e) =>
    ids.has(e.id) ? [`duplicate:${e.id}`] : (ids.add(e.id), [] as string[]),
  );
  return { valid: errors.length === 0, errors };
}
