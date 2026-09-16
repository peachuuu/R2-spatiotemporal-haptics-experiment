import { expect, test, type Page } from "@playwright/test";

/**
 * Plays the REAL G01-G12 game to completion inside the real iframe bridge and
 * proves that a validated RUN_COMPLETE advances the workflow into the
 * condition questionnaire without any operator action. No postMessage mocking
 * and no game timing is altered: the bot walks back and forth and presses the
 * interact key until the game finishes by itself.
 */

test.setTimeout(600_000);

async function fillBasicInfo(page: Page, code: string) {
  await page.goto("/");
  await page.getByLabel(/参与者编号/).fill(code);
  await page.getByLabel(/昵称/).fill("通关测试");
  await page.getByLabel(/年龄/).fill("22");
  await page.getByLabel("男").check();
  await page.getByLabel("从未").check();
  await page.getByRole("button", { name: /继续/ }).click();
}

async function passConsent(page: Page) {
  const scroll = page.getByTestId("consent-scroll");
  await scroll.evaluate(el => {
    el.scrollTop = el.scrollHeight;
  });
  await page.getByLabel(/我已阅读并理解/).check();
  await page.getByRole("button", { name: /继续/ }).click();
}

async function passCalibration(page: Page) {
  const rows = page.getByTestId("calibration-row");
  await expect(rows).toHaveCount(10);
  for (let i = 0; i < 10; i++) {
    await rows.nth(i).getByLabel(/输出等级/).fill("120");
    await rows.nth(i).getByRole("button", { name: "确定" }).click();
  }
  await page.getByRole("button", { name: /继续/ }).click();
}

async function readSessionFromIndexedDb(page: Page, participantCode: string) {
  return page.evaluate(async (code) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("electrotactile-study", 2);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<unknown>((resolve, reject) => {
        const tx = db.transaction("sessions", "readonly");
        const request = tx.objectStore("sessions").getAll();
        request.onsuccess = () => {
          const sessions = request.result as Array<{ participantCode?: string }>;
          resolve(sessions.find(session => session.participantCode === code) ?? null);
        };
        request.onerror = () => reject(request.error);
      });
    } finally {
      db.close();
    }
  }, participantCode);
}

test("a completed G01-G12 run advances to the questionnaire via the real bridge", async ({ page }) => {
  await fillBasicInfo(page, "E2E-FULL");
  await passConsent(page);
  await passCalibration(page);

  // Practice: complete through the real bridge.
  const practiceFrame = page.frameLocator('iframe[data-testid="practice-frame"]');
  await expect(practiceFrame.getByRole("button", { name: "完成练习并继续" })).toBeVisible({
    timeout: 60_000
  });
  await practiceFrame.getByRole("button", { name: "完成练习并继续" }).click();
  await expect(page.getByRole("heading", { name: /条件 A/i })).toBeVisible({ timeout: 60_000 });

  // The real formal game starts via GAME_READY -> START_RUN.
  const frame = page.frameLocator('iframe[data-testid="condition-frame"]');
  await expect(page.getByText(/条件游戏进行中/)).toBeVisible({ timeout: 60_000 });
  await expect(frame.getByText("打开机关，进入月萤遗迹")).toBeVisible({ timeout: 60_000 });

  // Drive the real game: focus the iframe, walk back and forth so both chests
  // (G05/G09) are found, and press the interact key periodically. The game
  // completes by itself and the R2 page advances automatically.
  await frame.locator("body").click();
  let direction = 1;
  let lastFlip = Date.now();
  let sawExitCountdown = false;
  const noticesSeen = new Set<string>();
  const deadline = Date.now() + 300_000;
  while (Date.now() < deadline) {
    if (await page.getByText(/条件后问卷/).isVisible().catch(() => false)) break;
    // After the G12 fireworks, the game shows a 3-second exit countdown before
    // reporting RUN_COMPLETE. The notice element only exists on side-scroll
    // events, so keep the probe cheap and tolerant.
    const notice = await frame.locator(".notice").textContent({ timeout: 300 }).catch(() => "");
    if (notice) noticesSeen.add(notice.trim());
    if (notice !== null && /s后进入后续问卷/.test(notice)) sawExitCountdown = true;
    if (Date.now() - lastFlip > 5_000) {
      direction = -direction;
      lastFlip = Date.now();
      await page.keyboard.up("a");
      await page.keyboard.up("d");
      await page.keyboard.down(direction === 1 ? "d" : "a");
    }
    await frame.locator("body").press("E");
    await page.waitForTimeout(1_100);
  }
  await page.keyboard.up("a");
  await page.keyboard.up("d");
  expect(sawExitCountdown, `countdown prompt never seen; notices: ${[...noticesSeen].join(" | ")}`).toBe(true);

  // RUN_COMPLETE must have advanced the step into the questionnaire by itself.
  await expect(page.getByRole("heading", { name: /条件 A 后评估/ })).toBeVisible({ timeout: 30_000 });

  const session = (await readSessionFromIndexedDb(page, "E2E-FULL")) as {
    conditionOrder?: string[];
    conditionRuns?: Record<
      string,
      {
        status: string;
        endedAt?: string;
        attempts: Array<{
          status: string;
          elapsedMs?: number;
          realizedStageOrder: string[];
          gameEvents: Array<{ eventId: string }>;
          timelineEvents: Array<{ timelineEventId: string; outcome: string }>;
        }>;
      }
    >;
  };
  const firstCondition = session?.conditionOrder?.[0] ?? "";
  const run = session?.conditionRuns?.[firstCondition];
  expect(run?.status).toBe("won");
  expect(run?.endedAt).toBeTruthy();
  const attempt = run?.attempts.at(-1);
  expect(attempt?.status).toBe("won");
  expect(attempt?.elapsedMs).toBeGreaterThan(0);
  expect(attempt?.realizedStageOrder).toContain("G12");
  expect(attempt?.gameEvents.length).toBeGreaterThan(20);
  // The timeline records (started/completed per event) include the G12 finale.
  expect(attempt?.timelineEvents.some(record => record.timelineEventId === "G12" && record.outcome === "completed")).toBe(true);
});
