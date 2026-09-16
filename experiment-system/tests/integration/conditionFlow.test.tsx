import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import App from "../../src/app/App";
import { advance } from "../../src/app/studyMachine";
import { createStudySession } from "../../src/domain/session";
import type { StepId, StudySession } from "../../src/domain/types";
import { GAME_ORIGIN, GAME_PROTOCOL_VERSION } from "../../src/integration/gameProtocol";
import type { Question } from "../../src/protocol/questions.v1";
import { conditionQuestions } from "../../src/protocol/questions.v1";
import { IndexedDbStudyRepository } from "../../src/storage/IndexedDbStudyRepository";

async function seedAt(repo: IndexedDbStudyRepository, participantCode: string, step: StepId, cell: "AB" | "BA" = "BA") {
  let session = createStudySession({
    participantCode,
    studyMode: "dry-run",
    allocation: {
      counterbalanceCell: cell,
      metadata: { methodVersion: "balanced-block-v1", blockId: 1, position: cell === "AB" ? 0 : 1 }
    },
    gameAssignment: { timelineSeed: "FLOW-SEED", projectileSequenceId: "S1", areaSequenceId: "A1" },
    profile: { nickname: "小测", age: 22, gender: "male", hapticExperience: "never" }
  });
  for (const prior of ["basic-info", "consent", "calibration", "instruction"] as const) {
    if (prior === step) break;
    session = advance(session, { stepId: prior, valid: true });
  }
  await repo.save(session);
  return session;
}

/** Simulates an authenticated message arriving from the real game iframe. */
function gameMessage(sessionId: string, runId: string, type: string, payload: unknown = {}) {
  act(() => {
    window.dispatchEvent(
      new MessageEvent("message", {
        origin: GAME_ORIGIN,
        source: null,
        data: { source: "spirit-ruins", protocolVersion: GAME_PROTOCOL_VERSION, sessionId, runId, type, payload }
      })
    );
  });
}

function winPayload(sessionId: string, runId: string, conditionId: "BH" | "STH") {
  return {
    status: "won",
    elapsedMs: 120000,
    sessionId,
    runId,
    conditionId,
    projectileSequenceId: "S1",
    areaSequenceId: "A1",
    timelineSeed: "FLOW-SEED",
    events: [],
    realizedStageOrder: ["G01", "G02"],
    timelineEvents: [{ timelineEventId: "G01", timelineOrder: 0, outcome: "completed", atMs: 5000 }]
  };
}

async function answerRequired(questions: readonly Question[], container: HTMLElement = document.body) {
  for (const question of questions) {
    if (!question.required) continue;
    const group = within(container).getByRole("group", { name: question.prompt });
    if (question.response.kind === "likert") {
      const middle = Math.round((question.response.min + question.response.max) / 2);
      // 选项标签可能是纯数字（HXI）或「数字 + 锚点文字」（PXI），直接按 input 值定位。
      await userEvent.click(within(group).getByDisplayValue(String(middle)));
    } else if (question.response.kind === "choice") {
      const first = question.response.options[0];
      if (first === undefined) throw new Error(`no options configured for ${question.id}`);
      await userEvent.click(within(group).getByLabelText(first.label));
    }
  }
}

describe("embedded condition flow", () => {
  it("does not show the assessment until a validated RUN_COMPLETE arrives", { timeout: 20000 }, async () => {
    const repo = new IndexedDbStudyRepository();
    const seeded = await seedAt(repo, "P001", "condition-1"); // BA: spatiotemporal runs first as Condition A
    render(<App repository={repo} />);

    await userEvent.click(await screen.findByRole("button", { name: /继续会话 P001/ }));
    expect(await screen.findByRole("heading", { name: /条件 a/i })).toBeInTheDocument();
    expect(screen.queryByText(/条件后问卷/)).not.toBeInTheDocument();
    await screen.findByTestId("condition-frame");

    const runId = `${seeded.id}-C1`;
    // Stale or mismatched messages are ignored and must not advance the step.
    gameMessage(seeded.id, runId, "RUN_COMPLETE", { ...winPayload(seeded.id, runId, "STH"), timelineSeed: "WRONG" });
    gameMessage(seeded.id, "OTHER-RUN", "RUN_COMPLETE", winPayload(seeded.id, runId, "STH"));
    expect(screen.queryByText(/条件后问卷/)).not.toBeInTheDocument();

    // The real game lifecycle: READY → (parent sends START_RUN) → events → complete.
    gameMessage(seeded.id, runId, "GAME_READY");
    expect(await screen.findByText(/条件游戏进行中/)).toBeInTheDocument();
    // React/dev remounts may publish READY more than once. A duplicate must
    // not regress the already-started runner back to "正在启动".
    gameMessage(seeded.id, runId, "GAME_READY");
    expect(screen.getByText(/条件游戏进行中/)).toBeInTheDocument();
    expect(screen.queryByText(/游戏已就绪，正在启动/)).not.toBeInTheDocument();
    gameMessage(seeded.id, runId, "GAME_EVENT", {
      sessionId: seeded.id,
      runId,
      conditionId: "STH",
      projectileSequenceId: "S1",
      areaSequenceId: "A1",
      eventId: "boss-landing",
      outcome: "shown",
      atMs: 100,
      phase: "intro"
    });
    gameMessage(seeded.id, runId, "RUN_COMPLETE", winPayload(seeded.id, runId, "STH"));

    expect(await screen.findByText(/条件后问卷/)).toBeInTheDocument();

    await answerRequired(conditionQuestions());
    await userEvent.click(screen.getByRole("button", { name: /继续/ }));
    expect(await screen.findByRole("heading", { name: /条件 b/i })).toBeInTheDocument();
  });

  it("surfaces non-won terminal results as a recoverable error and completes after retry", { timeout: 20000 }, async () => {
    const repo = new IndexedDbStudyRepository();
    const seeded = await seedAt(repo, "P003", "condition-1"); // BA: spatiotemporal first
    render(<App repository={repo} />);

    await userEvent.click(await screen.findByRole("button", { name: /继续会话 P003/ }));
    await screen.findByRole("heading", { name: /条件 a/i });
    await screen.findByTestId("condition-frame");

    const runId = `${seeded.id}-C1`;
    gameMessage(seeded.id, runId, "GAME_READY");
    // A timeout terminal must never advance the workflow silently.
    gameMessage(seeded.id, runId, "RUN_COMPLETE", {
      ...winPayload(seeded.id, runId, "STH"),
      status: "timeout"
    });
    expect(await screen.findByText(/游戏未完成本条件（状态：timeout），请重试。/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /重试加载条件游戏/ })).toBeInTheDocument();
    expect(screen.queryByText(/条件后问卷/)).not.toBeInTheDocument();

    // The failed terminal interrupts the current attempt and keeps history.
    await waitFor(async () => {
      const stored = await repo.get(seeded.id);
      expect(stored?.conditionRuns.spatiotemporal?.attempts.at(-1)?.status).toBe("interrupted");
    });

    // Retry opens a fresh attempt; a validated win then completes and advances.
    await userEvent.click(screen.getByRole("button", { name: /重试加载条件游戏/ }));
    await screen.findByTestId("condition-frame");
    gameMessage(seeded.id, runId, "GAME_READY");
    gameMessage(seeded.id, runId, "RUN_COMPLETE", winPayload(seeded.id, runId, "STH"));

    expect(await screen.findByText(/条件后问卷/)).toBeInTheDocument();
    await waitFor(async () => {
      const stored = await repo.get(seeded.id);
      expect(stored?.conditionRuns.spatiotemporal?.attempts).toHaveLength(2);
      expect(stored?.conditionRuns.spatiotemporal?.attempts.at(-1)?.status).toBe("won");
      expect(stored?.conditionRuns.spatiotemporal?.status).toBe("won");
    });
  });

  it("stores runs, attempts and responses under the hidden condition ids for BA order", { timeout: 20000 }, async () => {
    const repo = new IndexedDbStudyRepository();
    const seeded = await seedAt(repo, "P002", "condition-1");
    render(<App repository={repo} />);

    await userEvent.click(await screen.findByRole("button", { name: /继续会话 P002/ }));
    await screen.findByRole("heading", { name: /条件 a/i });
    await screen.findByTestId("condition-frame");

    const runA = `${seeded.id}-C1`;
    gameMessage(seeded.id, runA, "GAME_READY");
    gameMessage(seeded.id, runA, "GAME_EVENT", {
      sessionId: seeded.id,
      runId: runA,
      conditionId: "STH",
      projectileSequenceId: "S1",
      areaSequenceId: "A1",
      eventId: "boss-landing",
      outcome: "shown",
      atMs: 100,
      phase: "intro"
    });
    gameMessage(seeded.id, runA, "RUN_COMPLETE", winPayload(seeded.id, runA, "STH"));
    await screen.findByText(/条件后问卷/);
    await answerRequired(conditionQuestions());
    await userEvent.click(screen.getByRole("button", { name: /继续/ }));

    await screen.findByRole("heading", { name: /条件 b/i });
    await screen.findByTestId("condition-frame");
    const runB = `${seeded.id}-C2`;
    gameMessage(seeded.id, runB, "GAME_READY");
    gameMessage(seeded.id, runB, "RUN_COMPLETE", winPayload(seeded.id, runB, "BH"));
    await screen.findByText(/条件后问卷/);
    await answerRequired(conditionQuestions());
    await userEvent.click(screen.getByRole("button", { name: /继续/ }));

    expect(await screen.findByRole("heading", { name: /样本对比/ })).toBeInTheDocument();

    await waitFor(async () => {
      const stored = await repo.get(seeded.id);
      expect(stored?.conditionRuns.spatiotemporal?.displayCondition).toBe("A");
      expect(stored?.conditionRuns.baseline?.displayCondition).toBe("B");
      expect(stored?.conditionRuns.spatiotemporal?.status).toBe("won");
      expect(stored?.conditionRuns.spatiotemporal?.attempts).toHaveLength(1);
      expect(stored?.conditionRuns.spatiotemporal?.attempts[0]?.status).toBe("won");
      expect(stored?.conditionRuns.spatiotemporal?.attempts[0]?.elapsedMs).toBe(120000);
      expect(stored?.conditionRuns.spatiotemporal?.attempts[0]?.gameEvents).toHaveLength(1);
      expect(stored?.conditionRuns.baseline?.startedAt).toBeTruthy();
      expect(stored?.conditionRuns.baseline?.endedAt).toBeTruthy();
      expect(stored?.conditionResponses.spatiotemporal?.comfort_electro).toBe(4);
      expect(stored?.conditionResponses.baseline).toBeDefined();
      expect(stored?.currentStepId).toBe("comparison");
    });
  });
});
