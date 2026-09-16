import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import App from "../../src/app/App";
import { GAME_ORIGIN } from "../../src/integration/gameProtocol";
import { IndexedDbStudyRepository } from "../../src/storage/IndexedDbStudyRepository";

it("persists profile, consent, and eight calibration-region records before condition one", { timeout: 20000 }, async () => {
  const repo = new IndexedDbStudyRepository();
  render(<App repository={repo} />);

  // Basic information: code, nickname, age, gender, haptic experience.
  // The counterbalance cell is allocated by the system — there is no manual selector.
  expect(screen.queryByLabelText(/AB（条件 A 先行）/)).not.toBeInTheDocument();
  await userEvent.type(await screen.findByLabelText(/参与者编号/), "P001");
  await userEvent.type(screen.getByLabelText(/昵称/), "小测");
  await userEvent.type(screen.getByLabelText(/年龄/), "22");
  await userEvent.click(screen.getByLabelText("男"));
  await userEvent.click(screen.getByLabelText("从未"));
  await userEvent.click(screen.getByRole("button", { name: /继续/ }));

  // Consent: scroll to end and agree (no initials anymore)
  const scroll = await screen.findByTestId("consent-scroll");
  Object.defineProperty(scroll, "scrollHeight", { value: 1200, configurable: true });
  Object.defineProperty(scroll, "clientHeight", { value: 300, configurable: true });
  scroll.scrollTop = 900;
  fireEvent.scroll(scroll);
  await userEvent.click(screen.getByLabelText(/我已阅读并理解/));
  await userEvent.click(screen.getByRole("button", { name: /继续/ }));

  // Calibration: enter a voltage and confirm it for each of the eight regions.
  const rows = await screen.findAllByTestId("calibration-row");
  expect(rows).toHaveLength(8);
  for (const row of rows) {
    await userEvent.type(within(row).getByLabelText(/输出等级/), "120");
    await userEvent.click(within(row).getByRole("button", { name: "确定" }));
  }
  await userEvent.click(screen.getByRole("button", { name: /继续/ }));

  // Instruction: the real practice game is embedded; advancement comes only
  // from the authenticated PRACTICE_COMPLETE message.
  expect(await screen.findByRole("heading", { name: /操作说明/ })).toBeInTheDocument();
  await screen.findByTestId("practice-frame");
  expect(screen.queryByRole("button", { name: /继续/ })).not.toBeInTheDocument();

  const [created] = await repo.listIncomplete();
  const sessionId = created!.id;
  act(() => {
    window.dispatchEvent(
      new MessageEvent("message", {
        origin: GAME_ORIGIN,
        source: null,
        data: { source: "spirit-ruins", protocolVersion: 1, sessionId, type: "PRACTICE_READY" }
      })
    );
  });
  expect(await screen.findByText(/练习已就绪/)).toBeInTheDocument();
  act(() => {
    window.dispatchEvent(
      new MessageEvent("message", {
        origin: GAME_ORIGIN,
        source: null,
        data: { source: "spirit-ruins", protocolVersion: 1, sessionId, type: "PRACTICE_COMPLETE" }
      })
    );
  });

  // Condition one follows
  expect(await screen.findByRole("heading", { name: /条件 a/i })).toBeInTheDocument();

  await waitFor(async () => {
    const sessions = await repo.listIncomplete();
    expect(sessions).toHaveLength(1);
    const stored = sessions[0];
    expect(stored?.participantProfile).toEqual({
      nickname: "小测",
      age: 22,
      gender: "male",
      hapticExperience: "never"
    });
    expect(stored?.consent?.version).toBeTruthy();
    expect(stored?.calibration).toHaveLength(8);
    expect(stored?.calibration.every(r => r.thresholdVoltage === 120 && r.selectedVoltage === 120)).toBe(true);
    expect(stored?.currentStepId).toBe("condition-1");
    expect(stored?.allocationMetadata?.methodVersion).toBe("balanced-block-v1");
    expect(stored?.gameAssignment?.timelineSeed).toBeTruthy();
    expect(stored?.auditLog.some(event => event.type === "ConsentGranted")).toBe(true);
    expect(stored?.auditLog.some(event => event.type === "AdapterAction" && event.detail.action === "apply-voltage")).toBe(true);
  });
});
