import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "../../src/app/App";
import { advance } from "../../src/app/studyMachine";
import { createStudySession } from "../../src/domain/session";
import type { StepId } from "../../src/domain/types";
import { CONDITION_EVENT_IDS, resolvedSampleIdFor } from "../../src/protocol/conditions.v1";
import { finalQuestions } from "../../src/protocol/questions.v1";
import { IndexedDbStudyRepository } from "../../src/storage/IndexedDbStudyRepository";

const PROFILE = { nickname: "小测", age: 22, gender: "male", hapticExperience: "never" };

async function seedAt(repo: IndexedDbStudyRepository, participantCode: string, step: StepId) {
  let session = createStudySession({ participantCode, studyMode: "dry-run", allocation: { counterbalanceCell: "AB", metadata: { methodVersion: "balanced-block-v1", blockId: 1, position: 0 } }, gameAssignment: { timelineSeed: "SEED-T", projectileSequenceId: "S1", areaSequenceId: "A1" }, profile: PROFILE });
  const priorSteps: StepId[] = [
    "basic-info",
    "consent",
    "calibration",
    "instruction",
    "condition-1",
    "assessment-1",
    "condition-2",
    "assessment-2",
    "comparison",
    "final"
  ];
  for (const prior of priorSteps) {
    if (prior === step) break;
    session = advance(session, { stepId: prior, valid: true });
  }
  await repo.save(session);
  return session;
}

async function answerComparison() {
  const cards = screen.getAllByTestId(/comparison-event-/);
  expect(cards).toHaveLength(CONDITION_EVENT_IDS.length);
  for (const card of cards) {
    const threes = within(card).getAllByLabelText("3");
    await userEvent.click(threes[0]!);
    await userEvent.click(threes[1]!);
    await userEvent.click(within(card).getByLabelText("样本 A"));
  }
  await userEvent.click(screen.getByRole("button", { name: /继续/ }));
}

async function answerFinal() {
  const preference = screen.getByRole("group", { name: finalQuestions()[0]!.prompt });
  await userEvent.click(within(preference).getByLabelText("触觉条件 A"));
  const difference = screen.getByRole("group", { name: finalQuestions()[1]!.prompt });
  await userEvent.click(within(difference).getByLabelText("4"));
  await userEvent.click(screen.getByRole("button", { name: /继续/ }));
}

async function passInterview() {
  expect(await screen.findByRole("heading", { name: /试验后访谈/, level: 2 })).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: /继续/ }));
}

describe("completion flow", () => {
  it("explains why a partially answered comparison cannot continue", async () => {
    const repo = new IndexedDbStudyRepository();
    await seedAt(repo, "P004", "comparison");
    render(<App repository={repo} />);

    await userEvent.click(await screen.findByRole("button", { name: /继续会话 P004/ }));
    await screen.findByRole("heading", { name: /样本对比/ });
    await userEvent.click(screen.getByRole("button", { name: /继续/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent("仍有 27 项必答题未完成");
    expect(screen.getByRole("heading", { name: /样本对比/ })).toBeInTheDocument();
  });

  it("requires nine paired comparisons and completes after the interview", { timeout: 20000 }, async () => {
    const repo = new IndexedDbStudyRepository();
    const seeded = await seedAt(repo, "P001", "comparison");
    render(<App repository={repo} />);

    await userEvent.click(await screen.findByRole("button", { name: /继续会话 P001/ }));
    expect(await screen.findByRole("heading", { name: /样本对比/ })).toBeInTheDocument();

    await answerComparison();
    expect(await screen.findByRole("heading", { name: /最终评估/, level: 2 })).toBeInTheDocument();

    await answerFinal();
    await passInterview();
    expect(await screen.findByRole("heading", { name: /会话完成/ })).toBeInTheDocument();

    await waitFor(async () => {
      const stored = await repo.get(seeded.id);
      expect(stored?.status).toBe("complete");
      expect(stored?.currentStepId).toBe("completion");
      // 评分与偏好按真实条件（解析后样本 ID）存储：选择样本 A → 偏好等于 A 槽位的解析样本。
      const event06 = stored?.comparisonResponses["event-06"];
      expect(event06).toBeDefined();
      const sthId = event06!.baseSampleId;
      const bhId = resolvedSampleIdFor(sthId, "bh");
      expect(event06!.ratings[sthId]).toBe(3);
      expect(event06!.ratings[bhId]).toBe(3);
      expect(event06!.preference).toBe(resolvedSampleIdFor(sthId, event06!.order.a));
      expect(stored?.finalResponses.final_preference).toBe("a");
      expect(stored?.finalResponses.final_difference).toBe(4);
      expect(stored?.auditLog.some(event => event.type === "StepCompleted" && event.stepId === "final")).toBe(true);
      expect(stored?.auditLog.some(event => event.type === "StepCompleted" && event.stepId === "interview")).toBe(true);
    });
  });

  it("allows selecting '无偏好' for a comparison event", { timeout: 20000 }, async () => {
    const repo = new IndexedDbStudyRepository();
    await seedAt(repo, "P003", "comparison");
    render(<App repository={repo} />);

    await userEvent.click(await screen.findByRole("button", { name: /继续会话 P003/ }));
    await screen.findByRole("heading", { name: /样本对比/ });

    const card = screen.getByTestId("comparison-event-event-01");
    await userEvent.click(within(card).getByLabelText("无偏好"));
    expect(within(card).getByLabelText("无偏好")).toBeChecked();
    // 选择无偏好后理由输入框不显示
    expect(within(card).queryByRole("textbox")).not.toBeInTheDocument();

    // 再切回样本 A，理由输入框出现
    await userEvent.click(within(card).getByLabelText("样本 A"));
    expect(within(card).getByRole("textbox")).toBeInTheDocument();
  });

  it("appends an Exported audit event when downloading JSON", { timeout: 20000 }, async () => {
    const repo = new IndexedDbStudyRepository();
    const seeded = await seedAt(repo, "P002", "final");
    render(<App repository={repo} />);

    await userEvent.click(await screen.findByRole("button", { name: /继续会话 P002/ }));
    await answerFinal();
    await passInterview();
    await screen.findByRole("heading", { name: /会话完成/ });

    const createObjectURL = vi.fn(() => "blob:mock");
    const revokeObjectURL = vi.fn();
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    Object.defineProperty(URL, "createObjectURL", { configurable: true, writable: true, value: createObjectURL });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, writable: true, value: revokeObjectURL });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    try {
      await userEvent.click(screen.getByRole("button", { name: /下载 json/i }));
      await waitFor(async () => {
        const stored = await repo.get(seeded.id);
        expect(stored?.auditLog.some(event => event.type === "Exported" && event.detail.format === "json")).toBe(true);
      });
      expect(createObjectURL).toHaveBeenCalled();
    } finally {
      Object.defineProperty(URL, "createObjectURL", { configurable: true, writable: true, value: originalCreate });
      Object.defineProperty(URL, "revokeObjectURL", { configurable: true, writable: true, value: originalRevoke });
      vi.restoreAllMocks();
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });
});
