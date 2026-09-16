import { describe, expect, it } from "vitest";
import {
  BOSS_HP,
  buildStageOrder,
  getAreaExpansionProgress,
  getBossAttackCount,
  getBossHpAfterAttacks,
  getEventPrompt,
  getG02Phase,
  getG03Phase,
  getG04Phase,
  getProjectileX,
  isAreaImpactHit,
  isPlayerWithinChestInteraction,
  resolveOppositeChestX,
  G02_RUBBLE_PARTICLES,
  G02_TIMING,
  G01_TIMING,
  G03_ASSETS,
  G03_TIMING,
  G04_ASSETS,
  G04_TIMING,
  G05_ASSETS,
  G05_TIMING,
  G06_ASSETS,
  G06_TIMING,
  DIRECT_CHEST_TIMING,
  G07_AREA,
  G07_PROJECTILE_TIMING,
  G08_TIMING,
  G09_ASSETS,
  G09_TIMING,
  TIMELINE_EVENTS,
  validateTimeline,
} from "../../app/game/eventTimeline";

describe("event timeline", () => {
  it("defines the corrected G01-G12 story", () => {
    expect(TIMELINE_EVENTS.map((event) => event.id)).toEqual([
      "G01",
      "G02",
      "G02-G03-PAUSE",
      "G03",
      "G04",
      "G05",
      "G06",
      "G07",
      "G07-G08-PAUSE",
      "G08",
      "G09",
      "G10",
      "G11",
      "G12",
    ]);
  });
  it("builds the requested sixteen projectile and eight area events for G07", () => {
    const stageA = buildStageOrder("A", "developer", "fixed");
    expect(stageA.filter((event) => event.kind === "projectile")).toHaveLength(
      16,
    );
    expect(stageA.filter((event) => event.kind === "area")).toHaveLength(8);
    const stageB = buildStageOrder("B", "developer", "fixed");
    expect(stageB.filter((event) => event.kind === "projectile")).toHaveLength(
      16,
    );
    expect(stageB.filter((event) => event.kind === "area")).toHaveLength(8);
  });
  it("shuffles G07 by run seed and remains reproducible", () => {
    expect(
      buildStageOrder("A", "developer", "x").map((event) => event.id),
    ).not.toEqual(
      buildStageOrder("A", "developer", "y").map((event) => event.id),
    );
    expect(
      buildStageOrder("A", "developer", "x").map((event) => event.id),
    ).toEqual(buildStageOrder("A", "developer", "x").map((event) => event.id));
    expect(
      buildStageOrder("A", "experiment", "p42").map((event) => event.id),
    ).toEqual(
      buildStageOrder("A", "experiment", "p42").map((event) => event.id),
    );
  });
  it("covers every G07 direction-speed-repeat and player-targeted area repetition exactly once", () => {
    const order = buildStageOrder("A", "experiment", "p42");
    const projectiles = order
      .filter((item) => item.kind === "projectile")
      .map(
        (item) =>
          `${item.parameters.direction}-${item.parameters.speed}-${item.parameters.repeat}`,
      );
    const areas = order
      .filter((item) => item.kind === "area")
      .map(
        (item) =>
          `${item.parameters.targetMode}-${item.parameters.speed}-${item.parameters.repeat}`,
      );
    expect(new Set(projectiles).size).toBe(16);
    expect(new Set(areas).size).toBe(8);
  });
  it("randomly interleaves projectile and area trials without long same-kind runs", () => {
    for (const stage of ["A", "B"] as const)
      for (const mode of ["developer", "experiment"] as const) {
        const attacks = buildStageOrder(stage, mode, "mixed-order").filter(
          (item) => item.kind === "projectile" || item.kind === "area",
        );
        expect(
          attacks.some(
            (item, index) => index > 0 && item.kind !== attacks[index - 1].kind,
          ),
        ).toBe(true);
        expect(
          attacks.every(
            (item, index) =>
              item.kind !== "area" || attacks[index - 1]?.kind !== "area",
          ),
        ).toBe(true);
        expect(
          attacks.every(
            (item, index) =>
              item.kind !== "projectile" ||
              attacks[index - 1]?.kind !== "projectile" ||
              attacks[index - 2]?.kind !== "projectile",
          ),
        ).toBe(true);
      }
  });
  it("adds a three-second warning before each combat phase without affecting attack ordinals", () => {
    for (const stage of ["A", "B"] as const) {
      const order = buildStageOrder(stage, "experiment", "p42");
      expect(order[0]).toMatchObject({
        kind: "combat-intro",
        durationMs: 3000,
      });
      expect(
        order
          .filter((event) => typeof event.parameters.stageOrdinal === "number")
          .map((event) => event.parameters.stageOrdinal),
      ).toEqual(Array.from({ length: 24 }, (_, index) => index + 1));
      const gaps = order.filter((event) => event.kind === "combat-break");
      // A chest inserted immediately after an area replaces that area's
      // random 1–2 s break with the chest's explicit post-open 1 s gap.
      expect(gaps.length).toBeGreaterThanOrEqual(5);
      expect(gaps.length).toBeLessThanOrEqual(7);
      expect(
        gaps.every(
          (event) => event.durationMs >= 1000 && event.durationMs <= 2000,
        ),
      ).toBe(true);
    }
  });
  it("uses 48 fixed attacks to reduce the guard from 100% to exactly 0%", () => {
    expect(BOSS_HP.damagePerAttack).toBeCloseTo(100 / 48);
    expect(getBossHpAfterAttacks(0)).toBe(100);
    expect(getBossHpAfterAttacks(24)).toBe(50);
    expect(getBossHpAfterAttacks(48)).toBe(0);
    const stageA = buildStageOrder("A", "experiment", "hp-check");
    const breakEvent = stageA.find((item) => item.kind === "combat-break")!;
    expect(getBossAttackCount(breakEvent)).toBeGreaterThan(0);
    const stageB = buildStageOrder("B", "experiment", "hp-check");
    expect(getBossAttackCount(stageB[0])).toBe(24);
  });
  it("gives major cinematics at least five seconds", () => {
    for (const id of ["G02", "G03", "G04", "G08", "G12"])
      expect(
        TIMELINE_EVENTS.find((event) => event.id === id)?.durationMs,
      ).toBeGreaterThanOrEqual(5000);
  });
  it("keeps G02 ordered while shortening the pause before the guard fall", () => {
    expect(
      TIMELINE_EVENTS.find((event) => event.id === "G02")?.durationMs,
    ).toBe(9667);
    expect([
      getG02Phase(0),
      getG02Phase(766),
      getG02Phase(767),
      getG02Phase(1966),
      getG02Phase(1967),
      getG02Phase(4766),
      getG02Phase(4767),
      getG02Phase(5166),
      getG02Phase(5167),
      getG02Phase(6666),
      getG02Phase(6667),
      getG02Phase(7666),
      getG02Phase(7667),
      getG02Phase(9666),
      getG02Phase(9667),
    ]).toEqual([
      "hero-fall",
      "hero-fall",
      "pause",
      "pause",
      "boss-fall",
      "boss-fall",
      "impact",
      "impact",
      "rubble-rise",
      "rubble-rise",
      "rubble-hold",
      "rubble-hold",
      "rubble-fade",
      "rubble-fade",
      "complete",
    ]);
    expect(G02_TIMING.rubbleEndMs - G02_TIMING.rubbleStartMs).toBe(4500);
    expect(G02_TIMING.pauseEndMs - G02_TIMING.heroFallEndMs).toBe(1200);
  });
  it("builds a deterministic full-screen G02 debris field with future asset slots", () => {
    expect(G02_RUBBLE_PARTICLES).toHaveLength(48);
    expect(
      new Set(G02_RUBBLE_PARTICLES.map((particle) => particle.asset)),
    ).toEqual(
      new Set(
        Array.from(
          { length: 8 },
          (_, index) =>
            `/assets/events/G02/rock-${String(index + 1).padStart(2, "0")}.png`,
        ),
      ),
    );
    expect(
      Math.min(...G02_RUBBLE_PARTICLES.map((particle) => particle.targetX)),
    ).toBeLessThanOrEqual(8);
    expect(
      Math.max(...G02_RUBBLE_PARTICLES.map((particle) => particle.targetX)),
    ).toBeGreaterThanOrEqual(94);
    expect(
      Math.min(...G02_RUBBLE_PARTICLES.map((particle) => particle.targetY)),
    ).toBeLessThanOrEqual(8);
    expect(
      new Set(G02_RUBBLE_PARTICLES.map((particle) => particle.targetX)).size,
    ).toBeGreaterThanOrEqual(28);
    expect(
      new Set(G02_RUBBLE_PARTICLES.map((particle) => particle.targetY)).size,
    ).toBeGreaterThanOrEqual(24);
    expect(
      new Set(G02_RUBBLE_PARTICLES.map((particle) => particle.startX)).size,
    ).toBeGreaterThan(4);
    expect(
      new Set(G02_RUBBLE_PARTICLES.map((particle) => particle.durationMs)).size,
    ).toBeGreaterThan(12);
    expect(
      Math.min(...G02_RUBBLE_PARTICLES.map((particle) => particle.startX)),
    ).toBeGreaterThanOrEqual(65.5);
    expect(
      new Set(G02_RUBBLE_PARTICLES.map((particle) => particle.layer)),
    ).toEqual(new Set([4, 9]));
  });
  it("runs G03 casting before the burn stage and reserves split-frame assets", () => {
    expect(
      TIMELINE_EVENTS.find((event) => event.id === "G03")?.durationMs,
    ).toBe(7350);
    expect([
      getG03Phase(0),
      getG03Phase(1799),
      getG03Phase(1800),
      getG03Phase(7349),
      getG03Phase(7350),
    ]).toEqual(["casting", "casting", "burning", "burning", "complete"]);
    expect(G03_TIMING.burnEndMs - G03_TIMING.castEndMs).toBe(5550);
    expect(G03_ASSETS.bossFrames).toHaveLength(2);
    expect(G03_ASSETS.fireFrames).toHaveLength(6);
    expect(G03_ASSETS.fireFrames[0]).toBe("/assets/events/G03/fire-1.png");
    expect(G03_ASSETS.castAudio).toBe("/assets/music/new/g03-boss-cast.wav");
    expect(G03_ASSETS.fireAudio).toBe("/assets/music/new/g03-fire.wav");
    expect(G03_TIMING.totalMs).toBe(7350);
  });
  it("delays G04 audio and lets the ghost cross during the remaining audio", () => {
    expect(
      TIMELINE_EVENTS.find((event) => event.id === "G04")?.durationMs,
    ).toBe(6880);
    expect([
      getG04Phase(0),
      getG04Phase(999),
      getG04Phase(1000),
      getG04Phase(1999),
      getG04Phase(2000),
      getG04Phase(6879),
      getG04Phase(6880),
    ]).toEqual([
      "silent-pause",
      "silent-pause",
      "audio-lead",
      "audio-lead",
      "ghost-pass",
      "ghost-pass",
      "complete",
    ]);
    expect(G04_TIMING.ghostEndMs - G04_TIMING.ghostStartMs).toBe(
      G04_TIMING.audioDurationMs - 1000,
    );
    expect(G04_ASSETS.ghost).toBe("/assets/events/G04/ghost.png");
    expect(G04_ASSETS.audio).toBe("/assets/music/new/g04-ghost.wav");
  });
  it("starts the G05 breathing cue half a second after its delayed audio", () => {
    expect(G05_TIMING.audioStartMs).toBe(1000);
    expect(G05_TIMING.cueStartMs - G05_TIMING.audioStartMs).toBe(500);
    expect(G05_ASSETS.chest).toBe("/assets/events/G05+G09/chest-pixel.png");
    expect(G05_ASSETS.audio).toBe("/assets/music/new/g05-g09-chest-cue.wav");
  });
  it("places G05 and G09 on the side opposite the player and uses that position for interaction", () => {
    expect(resolveOppositeChestX(20)).toBe(83);
    expect(resolveOppositeChestX(49.99)).toBe(83);
    expect(resolveOppositeChestX(50)).toBe(17);
    expect(resolveOppositeChestX(80)).toBe(17);
    expect(isPlayerWithinChestInteraction(72, 83)).toBe(true);
    expect(isPlayerWithinChestInteraction(71.99, 83)).toBe(false);
    expect(isPlayerWithinChestInteraction(28, 17)).toBe(true);
  });
  it("reserves generated G06 frames and the complete unlock timing", () => {
    expect(
      TIMELINE_EVENTS.find((event) => event.id === "G06")?.durationMs,
    ).toBe(G06_TIMING.totalMs);
    expect(G06_TIMING.totalMs).toBe(6300);
    expect(G06_TIMING.traceEndMs).toBe(4083);
    expect(G06_TIMING.openAtMs).toBe(4083);
    expect(G06_ASSETS.closed).toContain("g06-chest-closed-v1.png");
    expect(G06_ASSETS.open).toContain("g06-chest-open-v1.png");
    expect(G06_ASSETS.openAudio).toContain("g06-g10-chest-open.wav");
  });
  it("inserts three direct-open chest trials after attacks 8, 16 and 24 in both visibility stages", () => {
    for (const stage of ["A", "B"] as const) {
      const order = buildStageOrder(stage, "experiment", "chest-order");
      const chests = order.filter((event) => event.kind === "chest-discovery");
      expect(chests.map((event) => event.id)).toEqual(
        [1, 2, 3].map(index => `G${stage === "A" ? "07" : "11"}-CHEST0${index}`),
      );
      expect(
        chests.map(chest =>
          order
            .slice(0, order.indexOf(chest))
            .filter(event => event.kind === "projectile" || event.kind === "area").length,
        ),
      ).toEqual([8, 16, 24]);
      expect(chests.map(event => event.parameters.chestTrialIndex)).toEqual([2, 3, 4]);
      expect(chests.every(event => event.parameters.directOpen === true)).toBe(true);
      expect(chests.every(event => event.durationMs === DIRECT_CHEST_TIMING.totalMs)).toBe(true);
      // The two in-combat chests resume directly into an attack; no random
      // combat-break may add another delay after the specified one second.
      expect(order[order.indexOf(chests[0]!) + 1]?.kind).toMatch(/projectile|area/);
      expect(order[order.indexOf(chests[1]!) + 1]?.kind).toMatch(/projectile|area/);
    }
  });
  it("starts G01 entry audio only after its shared audio-visual-haptic cue ends", () => {
    expect(G01_TIMING.enterSoundAtMs).toBe(5085);
    expect(G01_TIMING.totalMs).toBe(6125);
  });
  it("uses readable projectile timings and area boundaries slower than the player", () => {
    const stage = buildStageOrder("A", "experiment", "p42");
    const projectileDurations = new Set(
      stage
        .filter((item) => item.kind === "projectile")
        .map((item) => item.durationMs),
    );
    const areaDurations = new Set(
      stage
        .filter((item) => item.kind === "area")
        .map((item) => item.durationMs),
    );
    expect(projectileDurations).toEqual(
      new Set([G07_PROJECTILE_TIMING.slowMs, G07_PROJECTILE_TIMING.fastMs]),
    );
    expect(G07_PROJECTILE_TIMING.fastMs).toBe(3000);
    expect(
      G07_PROJECTILE_TIMING.slowMs / G07_PROJECTILE_TIMING.fastMs,
    ).toBeGreaterThan(1.6);
    expect(areaDurations).toEqual(new Set([G07_AREA.slowMs, G07_AREA.fastMs]));
    expect(G07_AREA.telegraphMs).toBe(300);
    expect(G07_AREA.slowMs).toBeGreaterThanOrEqual(
      G07_AREA.telegraphMs + G07_AREA.slowExpansionMs + 120,
    );
    expect(G07_AREA.fastMs).toBeGreaterThanOrEqual(
      G07_AREA.telegraphMs + G07_AREA.fastExpansionMs + 120,
    );
    expect(G07_AREA.halfWidthPercent).toBe(30);
    expect(
      stage
        .filter((item) => item.kind === "area")
        .every((item) => item.parameters.halfWidth === 30),
    ).toBe(true);
    expect(G07_AREA.slowExpansionMs).toBe(2200);
    expect(G07_AREA.fastExpansionMs).toBe(1765);
    expect(
      G07_AREA.halfWidthPercent / (G07_AREA.fastExpansionMs / 1000),
    ).toBeCloseTo(17, 1);
    expect(
      G07_AREA.halfWidthPercent / (G07_AREA.slowExpansionMs / 1000),
    ).toBeLessThan(18);
    const areas = stage.filter((item) => item.kind === "area");
    expect(
      areas.every((item) => item.parameters.targetMode === "fixed-anchor"),
    ).toBe(true);
    expect(new Set(areas.map((item) => item.parameters.anchorX))).toEqual(
      new Set([10, 45, 55, 90]),
    );
    for (const speed of ["slow", "fast"])
      expect(
        new Set(
          areas
            .filter((item) => item.parameters.speed === speed)
            .map((item) => item.parameters.anchorX),
        ),
      ).toEqual(new Set([10, 45, 55, 90]));
  });
  it("shares projectile and area formulas with the event hit tests", () => {
    const stage = buildStageOrder("A", "developer", "hit-test");
    const slow = stage.find(
      (item) =>
        item.kind === "projectile" &&
        item.parameters.speed === "slow" &&
        item.parameters.direction === "left",
    )!;
    const fast = stage.find(
      (item) =>
        item.kind === "projectile" &&
        item.parameters.speed === "fast" &&
        item.parameters.direction === "left",
    )!;
    expect(getProjectileX(fast, 1000)).toBeGreaterThan(
      getProjectileX(slow, 1000),
    );
    const baseArea = stage.find((item) => item.kind === "area")!;
    const area = {
      ...baseArea,
      parameters: { ...baseArea.parameters, center: 42 },
    };
    const impactAt = Number(area.parameters.impactAtMs);
    expect(getAreaExpansionProgress(area, G07_AREA.telegraphMs - 1)).toBe(0);
    expect(
      getAreaExpansionProgress(
        area,
        G07_AREA.telegraphMs + Number(area.parameters.expansionMs),
      ),
    ).toBe(1);
    expect(isAreaImpactHit(area, impactAt - 1, 42)).toBe(false);
    expect(isAreaImpactHit(area, impactAt, 71)).toBe(true);
    expect(isAreaImpactHit(area, impactAt, 73)).toBe(false);
    expect(isAreaImpactHit(area, impactAt + 200, 42)).toBe(true);
    expect(isAreaImpactHit(area, impactAt + 201, 42)).toBe(false);
  });
  it("provides a concise prompt for base and expanded combat events", () => {
    expect(getEventPrompt(TIMELINE_EVENTS[1])).toContain("守卫从高空坠落");
    const projectile = buildStageOrder("A", "developer", "prompt").find(
      (item) => item.kind === "projectile",
    )!;
    expect(getEventPrompt(projectile)).toBe("飞行物来袭，请注意躲避");
    const area = buildStageOrder("A", "developer", "prompt").find(
      (item) => item.kind === "area",
    )!;
    expect(getEventPrompt(area)).toBe("危险区域扩张，请注意躲避");
    expect(
      getEventPrompt(buildStageOrder("A", "developer", "prompt")[0], 1200),
    ).toContain("2秒后 boss开始攻击");
    expect(
      getEventPrompt(TIMELINE_EVENTS.find((event) => event.id === "G05")!),
    ).toBe("在环境中寻找宝箱并按手柄O键进行交互");
    expect(
      getEventPrompt(TIMELINE_EVENTS.find((event) => event.id === "G09")!),
    ).toBe("在环境中寻找宝箱并按手柄O键进行交互");
  });
  it("reserves stable haptic sample labels without changing audiovisual events", () => {
    expect(
      TIMELINE_EVENTS.find((event) => event.id === "G02")?.hapticSampleKey,
    ).toBe("landing-rubble");
    expect(
      buildStageOrder("A", "experiment", "labels").find(
        (event) => event.kind === "projectile",
      )?.hapticSampleKey,
    ).toBe("projectile-pass");
    expect(
      buildStageOrder("A", "experiment", "labels").find(
        (event) => event.kind === "area",
      )?.hapticSampleKey,
    ).toBe("danger-area-expand");
  });
  it("restores vision throughout the full G08 rain duration", () => {
    expect(
      TIMELINE_EVENTS.find((event) => event.id === "G08")?.durationMs,
    ).toBe(G08_TIMING.totalMs);
    expect(G08_TIMING.totalMs).toBe(6500);
  });
  it("delays the G09 chest task and its cue audio until two seconds after rain", () => {
    expect(G09_TIMING.taskStartMs).toBe(2000);
    expect(G09_TIMING.audioStartMs).toBe(2000);
    expect(G09_ASSETS.audio).toBe("/assets/music/new/g05-g09-chest-cue.wav");
  });
  it("rejects duplicate timeline ids", () =>
    expect(
      validateTimeline([TIMELINE_EVENTS[0], TIMELINE_EVENTS[0]]).valid,
    ).toBe(false));
});
