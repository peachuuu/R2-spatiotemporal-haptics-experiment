import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import App from "../../src/app/App";
import { advance } from "../../src/app/studyMachine";
import { createStudySession } from "../../src/domain/session";
import type { StepId } from "../../src/domain/types";
import { IndexedDbStudyRepository } from "../../src/storage/IndexedDbStudyRepository";

async function seedAt(repo: IndexedDbStudyRepository, participantCode: string, step: StepId) {
  let session = createStudySession({
    participantCode,
    studyMode: "dry-run",
    allocation: {
      counterbalanceCell: "AB",
      metadata: { methodVersion: "balanced-block-v1", blockId: 1, position: 0 }
    },
    gameAssignment: { timelineSeed: "SEED-T", projectileSequenceId: "S1", areaSequenceId: "A1" },
    profile: { nickname: "小测", age: 22, gender: "male", hapticExperience: "never" }
  });
  for (const prior of ["basic-info", "consent", "calibration", "instruction"] as const) {
    if (prior === step) break;
    session = advance(session, { stepId: prior, valid: true });
  }
  await repo.save(session);
  return session;
}

describe("global table of contents", () => {
  it("jumps to any step, including unstarted and onboarding steps", async () => {
    const repo = new IndexedDbStudyRepository();
    const seeded = await seedAt(repo, "P001", "condition-1");
    render(<App repository={repo} />);

    await userEvent.click(await screen.findByRole("button", { name: /继续会话 P001/ }));
    await screen.findByRole("heading", { name: /条件 a/i });

    await userEvent.click(screen.getByRole("button", { name: "目录" }));

    expect(screen.getByRole("button", { name: /样本对比/ })).toBeEnabled();
    expect(screen.getByRole("button", { name: /基本信息/ })).toBeEnabled();
    expect(screen.getByRole("button", { name: /知情同意/ })).toBeEnabled();

    await userEvent.click(screen.getByRole("button", { name: /阈值校准/ }));
    expect(await screen.findByRole("heading", { name: /阈值校准/ })).toBeInTheDocument();

    await waitFor(async () => {
      const stored = await repo.get(seeded.id);
      expect(stored?.currentStepId).toBe("calibration");
      expect(stored?.auditLog.some(event => event.type === "StepEntered" && event.stepId === "calibration")).toBe(true);
    });
  });

  it("opens the table of contents from basic info and starts a navigable draft", async () => {
    const repo = new IndexedDbStudyRepository();
    render(<App repository={repo} />);

    await userEvent.click(await screen.findByRole("button", { name: "目录" }));
    const comparison = await screen.findByRole("button", { name: /样本对比/ });
    expect(comparison).toBeEnabled();
    await userEvent.click(comparison);
    expect(await screen.findByRole("heading", { name: /样本对比/ })).toBeInTheDocument();
  });
});
