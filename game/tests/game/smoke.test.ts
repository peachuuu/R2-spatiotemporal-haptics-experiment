import { describe, expect, it } from "vitest";
import { parseLaunchConfig } from "../../app/game/launchConfig";

describe("launch config", () => {
  it("starts developer mode with explicit IDs", () => {
    expect(parseLaunchConfig("?mode=developer&sessionId=DEV-001&runId=DEV-001-R1&condition=STH&projectileSequence=S1&areaSequence=A1")).toMatchObject({
      mode: "developer",
      sessionId: "DEV-001",
      runId: "DEV-001-R1",
      conditionId: "STH",
      projectileSequenceId: "S1",
      areaSequenceId: "A1",
    });
  });
});
