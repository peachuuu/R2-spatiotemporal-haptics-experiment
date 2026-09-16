import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const downloads = vi.hoisted(() => ({ zip: vi.fn(async () => undefined) }));

vi.mock("../../src/storage/exportSession", async importOriginal => ({
  ...(await importOriginal<typeof import("../../src/storage/exportSession")>()),
  downloadSessionZip: downloads.zip
}));

import App from "../../src/app/App";
import { createStudySession } from "../../src/domain/session";
import { IndexedDbStudyRepository } from "../../src/storage/IndexedDbStudyRepository";

describe("debug export exit", () => {
  it("downloads the current partial session, audits it, and returns to the session gate", async () => {
    const repo = new IndexedDbStudyRepository();
    const seeded = createStudySession({
      participantCode: "DEBUG-001",
      studyMode: "dry-run",
      allocation: { counterbalanceCell: "AB", metadata: { methodVersion: "balanced-block-v1", blockId: 1, position: 0 } },
      gameAssignment: { timelineSeed: "SEED-T", projectileSequenceId: "S1", areaSequenceId: "A1" },
      profile: { nickname: "", age: 20, gender: "", hapticExperience: "" }
    });
    await repo.save(seeded);
    vi.stubGlobal("confirm", vi.fn(() => true));
    render(<App repository={repo} />);

    await userEvent.click(await screen.findByRole("button", { name: /继续会话 DEBUG-001/ }));
    await userEvent.click(screen.getByRole("button", { name: /调试：导出并退出/ }));

    await waitFor(async () => {
      expect(downloads.zip).toHaveBeenCalledTimes(1);
      const stored = await repo.get(seeded.id);
      expect(stored?.auditLog.at(-1)).toMatchObject({
        type: "Exported",
        detail: { kind: "debug_partial_exit", complete: false }
      });
    });
    expect(await screen.findByRole("heading", { name: /继续或开始会话/ })).toBeInTheDocument();
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
