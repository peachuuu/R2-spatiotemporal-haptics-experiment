import { describe, expect, it } from "vitest";
import { stepTitle } from "../../src/components/StepFrame";
import { conditionMarker, createStudySession } from "../../src/domain/session";
import type { StudySession } from "../../src/domain/types";

function sessionWith(cell: "AB" | "BA"): StudySession {
  return createStudySession({
    participantCode: "P001",
    studyMode: "dry-run",
    allocation: {
      counterbalanceCell: cell,
      metadata: { methodVersion: "balanced-block-v1", blockId: 1, position: 0 }
    },
    gameAssignment: { timelineSeed: "SEED-T", projectileSequenceId: "S1", areaSequenceId: "A1" },
    profile: { nickname: "n", age: 22, gender: "male", hapticExperience: "never" }
  });
}

describe("condition markers", () => {
  it("maps baseline (BH) to ○ and spatiotemporal (STH) to ✦", () => {
    expect(conditionMarker("baseline")).toBe("○");
    expect(conditionMarker("spatiotemporal")).toBe("✦");
  });

  it("appends the operator marker to condition and assessment page titles", () => {
    const ab = sessionWith("AB"); // 先行条件为 baseline → 显示 A ○
    expect(stepTitle(ab, "condition-1")).toBe("条件 A ○");
    expect(stepTitle(ab, "assessment-1")).toBe("条件 A 后评估 ○");
    expect(stepTitle(ab, "condition-2")).toBe("条件 B ✦");
    expect(stepTitle(ab, "assessment-2")).toBe("条件 B 后评估 ✦");

    const ba = sessionWith("BA"); // 先行条件为 spatiotemporal → 显示 A ✦
    expect(stepTitle(ba, "condition-1")).toBe("条件 A ✦");
    expect(stepTitle(ba, "assessment-1")).toBe("条件 A 后评估 ✦");
    expect(stepTitle(ba, "condition-2")).toBe("条件 B ○");
    expect(stepTitle(ba, "assessment-2")).toBe("条件 B 后评估 ○");
  });

  it("leaves non-condition titles unchanged", () => {
    const ab = sessionWith("AB");
    expect(stepTitle(ab, "basic-info")).toBe("基本信息");
    expect(stepTitle(ab, "comparison")).toBe("样本对比");
    expect(stepTitle(ab, "completion")).toBe("会话完成");
  });
});
