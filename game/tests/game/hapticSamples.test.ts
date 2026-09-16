import { describe, expect, it } from "vitest";
import {
  areaAnchorOf,
  baseIdOfResolved,
  cueBaseSampleId,
  cuesForTimelineEvent,
  dueCues,
  isResolvedSampleId,
  isCueInteractionReady,
  isSampleBaseId,
  resolveConditionSampleId,
  SAMPLE_BASE_IDS,
  sampleDataStatus
} from "../../app/game/hapticSamples";

describe("condition-safe sample catalog", () => {
  it("scopes fired cue keys to the realized event, so repeated event families all stimulate", () => {
    const fired = new Set<string>();
    const g05 = dueCues(
      { id: "G05", kind: "chest-discovery" },
      1000,
      undefined,
      17,
      fired,
    )[0];
    fired.add(g05.cueKey);
    const g09 = dueCues(
      { id: "G09", kind: "chest-discovery" },
      2000,
      undefined,
      83,
      fired,
    )[0];
    const projectile = dueCues(
      { id: "G07-P01", kind: "projectile", parameters: { direction: "left", speed: "fast" } },
      0,
      undefined,
      undefined,
      fired,
    )[0];
    fired.add(projectile.cueKey);
    const nextProjectile = dueCues(
      { id: "G07-P02", kind: "projectile", parameters: { direction: "right", speed: "slow" } },
      0,
      undefined,
      undefined,
      fired,
    )[0];
    expect(g05.cueKey).not.toBe(g09.cueKey);
    expect(projectile.cueKey).not.toBe(nextProjectile.cueKey);
    expect(g09.baseSampleId).toBe("sth.g05.chest.right");
    expect(nextProjectile.baseSampleId).toBe("sth.g07.projectile.right.slow");
  });

  it("holds only G01 for its own E/O interaction; G06/G10 start after the preceding chest interaction", () => {
    expect(isCueInteractionReady("G01", false)).toBe(false);
    expect(isCueInteractionReady("G01", true)).toBe(true);
    expect(isCueInteractionReady("G06", false)).toBe(true);
    expect(isCueInteractionReady("G10", false)).toBe(true);
    expect(isCueInteractionReady("G04", false)).toBe(true);
  });
  it("uses readable, condition-qualified IDs for combat variants", () => {
    expect(cueBaseSampleId({ kind: "projectile", side: "left", speed: "fast" })).toBe("sth.g07.projectile.left.fast");
    expect(cueBaseSampleId({ kind: "projectile", side: "right", speed: "slow" })).toBe("sth.g07.projectile.right.slow");
    expect(cueBaseSampleId({ kind: "area", anchor: "a", speed: "fast" })).toBe("sth.g07.area.a.fast");
    expect(cueBaseSampleId({ kind: "area", anchor: "d", speed: "slow" })).toBe("sth.g07.area.d.slow");
    expect(resolveConditionSampleId("sth.g07.projectile.left.fast", "BH")).toBe("bh.g07.projectile.left.fast");
  });

  it("keeps STH IDs and changes only the condition token for BH", () => {
    expect(resolveConditionSampleId("sth.g01.unlock", "STH")).toBe("sth.g01.unlock");
    expect(resolveConditionSampleId("sth.g01.unlock", "BH")).toBe("bh.g01.unlock");
    expect(resolveConditionSampleId("sth.g07.projectile.left.fast", "STH")).toBe("sth.g07.projectile.left.fast");
    expect(resolveConditionSampleId("sth.g07.projectile.left.fast", "BH")).toBe("bh.g07.projectile.left.fast");
    for (const base of SAMPLE_BASE_IDS) {
      const bh = resolveConditionSampleId(base, "BH");
      expect(bh).toBe(base.replace(/^sth\./, "bh."));
      expect(bh.replace(/^bh\./, "sth.")).toBe(base);
    }
  });

  it("treats ids as case-sensitive and rejects non-canonical spellings", () => {
    expect(isSampleBaseId("sth.g07.projectile.left.fast")).toBe(true);
    expect(isSampleBaseId("sth.g07.projectile.left.Fast")).toBe(false);
    expect(isSampleBaseId("07Alf")).toBe(false);
    expect(isResolvedSampleId("bh.g07.projectile.left.fast")).toBe(true);
    expect(isResolvedSampleId("B07Alf")).toBe(false);
    expect(isResolvedSampleId("sth.g07.projectile.left.fast")).toBe(true);
    expect(baseIdOfResolved("bh.g05.chest.left")).toBe("sth.g05.chest.left");
    expect(baseIdOfResolved("sth.g05.chest.left")).toBe("sth.g05.chest.left");
    expect(baseIdOfResolved("nonsense")).toBeUndefined();
  });

  it("reports the documented data status without inventing availability", () => {
    expect(sampleDataStatus("sth.g01.unlock")).toBe("candidate");
    expect(sampleDataStatus("bh.g01.unlock")).toBe("candidate");
    expect(sampleDataStatus("sth.g12.fireworks")).toBe("candidate");
    expect(sampleDataStatus("bh.g12.fireworks")).toBe("candidate");
    expect(sampleDataStatus("sth.g07.projectile.left.fast")).toBe("candidate");
    expect(sampleDataStatus("bh.g07.projectile.left.fast")).toBe("candidate");
    expect(sampleDataStatus("sth.g07.area.a.fast")).toBe("candidate");
    expect(sampleDataStatus("bh.g07.area.d.slow")).toBe("candidate");
  });

  it("maps every cue point to a readable STH id", () => {
    expect(cueBaseSampleId({ kind: "g01-unlock" })).toBe("sth.g01.unlock");
    expect(cueBaseSampleId({ kind: "g02-rubble" })).toBe("sth.g02.rubble");
    expect(cueBaseSampleId({ kind: "g03-burn-start" })).toBe("sth.g03.fire");
    expect(cueBaseSampleId({ kind: "g04-ghost-pass" })).toBe("sth.g04.ghost");
    expect(cueBaseSampleId({ kind: "chest-cue", side: "left" })).toBe("sth.g05.chest.left");
    expect(cueBaseSampleId({ kind: "chest-cue", side: "right" })).toBe("sth.g05.chest.right");
    expect(cueBaseSampleId({ kind: "ridge-trace" })).toBe("sth.g06.ridge");
    expect(cueBaseSampleId({ kind: "chest-open" })).toBe("sth.g06.open");
    expect(cueBaseSampleId({ kind: "projectile", side: "left", speed: "fast" })).toBe("sth.g07.projectile.left.fast");
    expect(cueBaseSampleId({ kind: "projectile", side: "right", speed: "fast" })).toBe("sth.g07.projectile.right.fast");
    expect(cueBaseSampleId({ kind: "projectile", side: "left", speed: "slow" })).toBe("sth.g07.projectile.left.slow");
    expect(cueBaseSampleId({ kind: "projectile", side: "right", speed: "slow" })).toBe("sth.g07.projectile.right.slow");
    expect(cueBaseSampleId({ kind: "area", anchor: "a", speed: "fast" })).toBe("sth.g07.area.a.fast");
    expect(cueBaseSampleId({ kind: "area", anchor: "d", speed: "slow" })).toBe("sth.g07.area.d.slow");
    expect(cueBaseSampleId({ kind: "g08-rain" })).toBe("sth.g08.rain");
    expect(cueBaseSampleId({ kind: "g12-firework" })).toBe("sth.g12.fireworks");
  });

  it("resolves timeline events into cue points", () => {
    expect(cuesForTimelineEvent({ id: "G01" })).toEqual([{ kind: "g01-unlock" }]);
    expect(cuesForTimelineEvent({ id: "G02" })).toEqual([{ kind: "g02-rubble" }]);
    expect(cuesForTimelineEvent({ id: "G02-G03-PAUSE" })).toEqual([]);
    expect(cuesForTimelineEvent({ id: "G03" })).toEqual([{ kind: "g03-burn-start" }]);
    expect(cuesForTimelineEvent({ id: "G04" })).toEqual([{ kind: "g04-ghost-pass" }]);
    expect(cuesForTimelineEvent({ id: "G05", parameters: { chestSide: "left" } })).toEqual([
      { kind: "chest-cue", side: "left" }
    ]);
    expect(cuesForTimelineEvent({ id: "G09" })).toEqual([{ kind: "chest-cue", side: "right" }]);
    // G06/G10 only stimulate while the ridge-trace audio/animation plays.
    expect(cuesForTimelineEvent({ id: "G06" })).toEqual([{ kind: "ridge-trace" }]);
    expect(cuesForTimelineEvent({ id: "G10" })).toEqual([{ kind: "ridge-trace" }]);
    expect(cuesForTimelineEvent({ id: "G08" })).toEqual([{ kind: "g08-rain" }]);
    expect(cuesForTimelineEvent({ id: "G12" })).toEqual([{ kind: "g12-firework" }]);
  });

  it("resolves G07/G11 sub-events from realized attack parameters", () => {
    expect(
      cuesForTimelineEvent({ id: "G07-P03", kind: "projectile", parameters: { direction: "left", speed: "fast" } })
    ).toEqual([{ kind: "projectile", side: "left", speed: "fast" }]);
    expect(
      cuesForTimelineEvent({ id: "G11-P10", kind: "projectile", parameters: { direction: "right", speed: "slow" } })
    ).toEqual([{ kind: "projectile", side: "right", speed: "slow" }]);
    expect(
      cuesForTimelineEvent({ id: "G07-P05", kind: "area", parameters: { speed: "fast" } }, 45)
    ).toEqual([{ kind: "area", anchor: "b", speed: "fast" }]);
    expect(
      cuesForTimelineEvent({ id: "G11-P22", kind: "area", parameters: { speed: "slow" } }, 90)
    ).toEqual([{ kind: "area", anchor: "d", speed: "slow" }]);
    expect(cuesForTimelineEvent({ id: "G07-P01", kind: "area", parameters: { speed: "slow" } }, 33)).toEqual([]);
  });

  it("reuses the positioned chest cue for every added direct-open chest without a ridge cue", () => {
    expect(
      cuesForTimelineEvent(
        { id: "G07-CHEST01", kind: "chest-discovery", parameters: { directOpen: true } },
        undefined,
        83,
      ),
    ).toEqual([{ kind: "chest-cue", side: "right" }]);
    expect(
      cuesForTimelineEvent(
        { id: "G11-CHEST02", kind: "chest-discovery", parameters: { directOpen: true } },
        undefined,
        17,
      ),
    ).toEqual([{ kind: "chest-cue", side: "left" }]);
  });

  it("maps the four fixed anchors left to right", () => {
    expect(areaAnchorOf(10)).toBe("a");
    expect(areaAnchorOf(45)).toBe("b");
    expect(areaAnchorOf(55)).toBe("c");
    expect(areaAnchorOf(90)).toBe("d");
    expect(areaAnchorOf(33)).toBeUndefined();
    expect(areaAnchorOf(undefined)).toBeUndefined();
  });
});
