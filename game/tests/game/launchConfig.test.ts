import { describe, expect, it } from "vitest";
import { normalizeTopLevelPracticeSearch, parseLaunchConfig } from "../../app/game/launchConfig";
import { sensoryPolicies } from "../../app/game/sensoryPolicies";

describe("launch config validation", () => {
  it("rejects experiment mode without an allowed parent origin", () => {
    expect(() =>
      parseLaunchConfig(
        "?mode=experiment&sessionId=P1&runId=R1&condition=NH&projectileSequence=S1&areaSequence=A1&timelineSeed=T1",
      ),
    ).toThrow("parentOrigin is required");
  });

  it("requires a shared timeline seed for experiment mode", () => {
    expect(() =>
      parseLaunchConfig(
        "?mode=experiment&sessionId=P1&runId=R1&condition=NH&projectileSequence=S1&areaSequence=A1&parentOrigin=http://localhost:5173",
      ),
    ).toThrow("timelineSeed is required");
  });

  it("parses a complete experiment launch with timeline seed", () => {
    const config = parseLaunchConfig(
      "?mode=experiment&sessionId=P1&runId=R1&condition=BH&projectileSequence=S2&areaSequence=A3&timelineSeed=T-SHARED&parentOrigin=http://localhost:5173",
    );
    expect(config).toMatchObject({
      mode: "experiment",
      sessionId: "P1",
      runId: "R1",
      conditionId: "BH",
      projectileSequenceId: "S2",
      areaSequenceId: "A3",
      timelineSeed: "T-SHARED",
      parentOrigin: "http://localhost:5173",
    });
  });

  it("keeps a stable default practice timeline seed", () => {
    expect(parseLaunchConfig("?mode=practice").timelineSeed).toBe("PRACTICE-TIMELINE");
  });

  it("creates private practice IDs without requiring a parent origin", () => {
    expect(parseLaunchConfig("?mode=practice")).toMatchObject({
      mode: "practice",
      sessionId: "PRACTICE",
    });
  });

  it("parses an authenticated embedded practice launch", () => {
    expect(
      parseLaunchConfig(
        "?mode=practice&embedded=1&sessionId=P-07&parentOrigin=http%3A%2F%2Flocalhost%3A5173",
      ),
    ).toMatchObject({
      mode: "practice",
      embedded: true,
      sessionId: "P-07",
      parentOrigin: "http://localhost:5173",
    });
  });

  it("rejects embedded practice without a complete parent identity", () => {
    expect(() =>
      parseLaunchConfig("?mode=practice&embedded=1&sessionId=P-07"),
    ).toThrow("parentOrigin is required");
    expect(() =>
      parseLaunchConfig(
        "?mode=practice&embedded=1&sessionId=P-07&parentOrigin=not-an-origin",
      ),
    ).toThrow("parentOrigin is invalid");
  });

  it("drops incomplete embedded flags when practice is opened at the browser top level", () => {
    expect(
      normalizeTopLevelPracticeSearch(
        "?mode=practice&embedded=1&sessionId=",
        true,
      ),
    ).toBe("?mode=practice");
  });

  it("does not alter incomplete embedded flags inside an iframe", () => {
    expect(
      normalizeTopLevelPracticeSearch(
        "?mode=practice&embedded=1&sessionId=",
        false,
      ),
    ).toBe("?mode=practice&embedded=1&sessionId=");
  });

  it("keeps delivery disabled for NH and reserves distinct BH/STH adapter labels", () => {
    expect(sensoryPolicies.NH.hapticDelivery).toBe("disabled");
    expect(sensoryPolicies.BH).toMatchObject({
      hapticDelivery: "adapter-reserved",
      hapticVariant: "basic",
    });
    expect(sensoryPolicies.STH).toMatchObject({
      hapticDelivery: "adapter-reserved",
      hapticVariant: "spatiotemporal",
    });
  });
});
