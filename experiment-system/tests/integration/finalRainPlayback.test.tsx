import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import App from "../../src/app/App";
import { advance } from "../../src/app/studyMachine";
import { createStudySession } from "../../src/domain/session";
import type { StepId } from "../../src/domain/types";
import { IndexedDbStudyRepository } from "../../src/storage/IndexedDbStudyRepository";

async function seedFinal(repo: IndexedDbStudyRepository) {
  let session = createStudySession({
    participantCode: "FINAL-RAIN",
    studyMode: "dry-run",
    allocation: { counterbalanceCell: "AB", metadata: { methodVersion: "balanced-block-v1", blockId: 1, position: 0 } },
    gameAssignment: { timelineSeed: "SEED", projectileSequenceId: "S1", areaSequenceId: "A1" },
    profile: { nickname: "测试", age: 22, gender: "male", hapticExperience: "never" }
  });
  const prior: StepId[] = ["basic-info", "consent", "calibration", "instruction", "condition-1", "assessment-1", "condition-2", "assessment-2", "comparison"];
  for (const step of prior) session = advance(session, { stepId: step, valid: true });
  await repo.save(session);
  return session;
}

describe("final rain playback", () => {
  it("shows the same A/B markers as game conditions and exposes both rain playback controls", async () => {
    const repo = new IndexedDbStudyRepository();
    await seedFinal(repo);
    render(<App repository={repo} />);
    await userEvent.click(await screen.findByRole("button", { name: /继续会话 FINAL-RAIN/ }));

    expect(await screen.findByText("触觉条件 A ○")).toBeInTheDocument();
    expect(screen.getByText("触觉条件 B ✦")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "播放条件 A 的下雨触觉与音频" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "播放条件 B 的下雨触觉与音频" })).toBeDisabled();
  });
});
