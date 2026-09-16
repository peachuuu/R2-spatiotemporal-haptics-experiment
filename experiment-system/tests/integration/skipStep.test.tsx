import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import App from "../../src/app/App";
import { advance } from "../../src/app/studyMachine";
import { createStudySession } from "../../src/domain/session";
import type { StepId, StudyMode } from "../../src/domain/types";
import { IndexedDbStudyRepository } from "../../src/storage/IndexedDbStudyRepository";

async function seedSessionAt(repo: IndexedDbStudyRepository, participantCode: string, step: StepId, mode: StudyMode = "dry-run") {
  let session = createStudySession({
    participantCode,
    studyMode: mode,
    allocation: {
      counterbalanceCell: "AB",
      metadata: { methodVersion: "balanced-block-v1", blockId: 1, position: 0 }
    },
    gameAssignment: { timelineSeed: "SEED-T", projectileSequenceId: "S1", areaSequenceId: "A1" },
    profile: { nickname: "小测", age: 22, gender: "male", hapticExperience: "never" }
  });
  for (const prior of ["basic-info", "consent"] as const) {
    if (prior === step) return { session, seeded: false };
    session = advance(session, { stepId: prior, valid: true });
  }
  await repo.save(session);
  return { session, seeded: true };
}

describe("dry-run skip flow", () => {
  it("skips calibration without requiring a reason", async () => {
    const repo = new IndexedDbStudyRepository();
    const { session } = await seedSessionAt(repo, "P001", "calibration");
    render(<App repository={repo} />);

    await userEvent.click(await screen.findByRole("button", { name: /继续会话 P001/ }));
    expect(await screen.findByRole("heading", { name: /阈值校准/ })).toBeInTheDocument();
    expect(screen.getByText(/干跑 \/ 仅模拟/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /跳过此步骤/ }));
    await userEvent.click(screen.getByRole("button", { name: /确认跳过/ }));

    expect(await screen.findByRole("heading", { name: /操作说明/ })).toBeInTheDocument();
    await waitFor(async () => {
      const stored = await repo.get(session.id);
      expect(stored?.skippedSteps[0]?.reason).toBe("not specified");
      expect(stored?.skippedSteps[0]?.skippedAt).toBeTruthy();
      expect(stored?.auditLog.some(event => event.type === "StepSkipped" && event.stepId === "calibration")).toBe(true);
    });
  });

  it("hides the skip control and mock badge in production mode", async () => {
    const repo = new IndexedDbStudyRepository();
    await seedSessionAt(repo, "P002", "calibration", "production");
    render(<App repository={repo} />);

    await userEvent.click(await screen.findByRole("button", { name: /继续会话 P002/ }));
    expect(await screen.findByRole("heading", { name: /阈值校准/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /跳过此步骤/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/干跑 \/ 仅模拟/)).not.toBeInTheDocument();
  });
});
