import { expect, test, type Download, type Page } from "@playwright/test";
import JSZip from "jszip";

/**
 * Two-service end-to-end over the REAL postMessage bridge: the R2 experiment
 * page (5173) embeds the Spirit Ruins game (3001) in real iframes for the
 * practice step and both condition steps. postMessage is not mocked; the test
 * only fails if the real browser exchange works.
 *
 * Run with both services up (see playwright.config.ts webServer entries or
 * the repository-root `start-experiment.cmd`).
 */

test.setTimeout(600_000);

async function readDownloadBytes(download: Download): Promise<Uint8Array> {
  const stream = await download.createReadStream();
  const chunks: Uint8Array[] = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === "string" ? new TextEncoder().encode(chunk) : (chunk as Uint8Array));
  }
  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

async function fillBasicInfo(page: Page, code: string) {
  await page.getByLabel(/参与者编号/).fill(code);
  await page.getByLabel(/昵称/).fill("端到端测试");
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
  await expect(rows).toHaveCount(8);
  for (let i = 0; i < 8; i++) {
    await rows.nth(i).getByLabel(/输出等级/).fill("120");
    await rows.nth(i).getByRole("button", { name: "确定" }).click();
  }
  await page.getByRole("button", { name: /继续/ }).click();
}

async function answerQuestionnaireGroups(page: Page) {
  // Every required question is answered by selecting its first option; all
  // first options are valid values for their respective question types.
  // getByRole resolves implicit roles (fieldset -> group), unlike the CSS
  // [role="group"] attribute selector.
  const groups = page.getByRole("group");
  const count = await groups.count();
  for (let i = 0; i < count; i++) {
    const group = groups.nth(i);
    const radios = group.getByRole("radio");
    if ((await radios.count()) > 0) {
      await radios.first().check();
    }
  }
  await page.getByRole("button", { name: /继续/ }).click();
}

async function skipCurrentStep(page: Page) {
  await page.getByRole("button", { name: /跳过此步骤/ }).click();
  await page.getByRole("button", { name: /确认跳过/ }).click();
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

test("complete practice and both conditions through the real embedded game bridge", async ({ page }) => {
  await page.goto("/");

  // The participant entry never exposes a manual counterbalance selector.
  await expect(page.getByLabel(/AB（条件 A 先行）/)).toHaveCount(0);

  await fillBasicInfo(page, "E2E-001");
  await passConsent(page);
  await passCalibration(page);

  // --- Instruction step: the real practice game embedded as an iframe. ---
  await expect(page.getByRole("heading", { name: /操作说明/ })).toBeVisible();
  const practiceFrame = page.frameLocator('iframe[data-testid="practice-frame"]');
  // Real iframe content proves the game actually loaded (not a mock).
  await expect(practiceFrame.getByText("选择练习内容")).toBeVisible({ timeout: 60_000 });
  // PRACTICE_READY was consumed and surfaced by the R2 page.
  await expect(page.getByText(/练习已就绪/)).toBeVisible({ timeout: 60_000 });
  // Embedded practice hides local mode switching.
  await expect(practiceFrame.getByText("时空触觉模式")).toHaveCount(0);
  await expect(practiceFrame.getByText("基础触觉模式")).toHaveCount(0);

  // PRACTICE_COMPLETE via the real game button inside the iframe.
  await practiceFrame.getByRole("button", { name: "完成练习并继续" }).click();
  await expect(page.getByRole("heading", { name: /条件 A/i })).toBeVisible({ timeout: 60_000 });

  // --- Condition A: the real formal game embedded as an iframe. ---
  const conditionFrame = page.frameLocator('iframe[data-testid="condition-frame"]');
  // GAME_READY arrived and the parent sent START_RUN (status shows running).
  await expect(page.getByText(/条件游戏进行中/)).toBeVisible({ timeout: 60_000 });
  // Real G01 scene with the new R2 copy contract; no developer chrome inside the iframe.
  await expect(conditionFrame.getByText("打开机关，进入月萤遗迹")).toBeVisible({ timeout: 60_000 });
  await expect(conditionFrame.getByText("按手柄O键开始解锁")).toBeVisible();
  await expect(conditionFrame.getByText("Developer run")).toHaveCount(0);
  await expect(conditionFrame.getByText(/重新开始/)).toHaveCount(0);

  // Interact with the real game: start the G01 mechanism unlock.
  await conditionFrame.locator("body").click();
  await conditionFrame.locator("body").press("E");
  await expect(conditionFrame.getByText("沿机关边缘完成解锁")).toBeVisible({ timeout: 15_000 });

  // Real GAME_EVENT records flow through the bridge into the session store.
  // The condition order is randomly allocated, so read the first condition of
  // the stored order rather than assuming a fixed one.
  await expect.poll(
    async () => {
      const session = (await readSessionFromIndexedDb(page, "E2E-001")) as {
        conditionOrder?: string[];
        conditionRuns?: Record<string, { attempts?: Array<{ gameEvents?: unknown[] }> }>;
      };
      const firstCondition = session?.conditionOrder?.[0] ?? "";
      const events = session?.conditionRuns?.[firstCondition]?.attempts?.[0]?.gameEvents ?? [];
      return events.length;
    },
    { timeout: 30_000 }
  ).toBeGreaterThan(0);

  // Dry-run allows skipping the rest of the condition to reach the questionnaire.
  await skipCurrentStep(page);
  await expect(page.getByRole("heading", { name: /条件 A 后评估/ })).toBeVisible();
  await answerQuestionnaireGroups(page);

  // --- Condition B: same real bridge, distinct run id, same shared seed. ---
  await expect(page.getByRole("heading", { name: /条件 B/i })).toBeVisible();
  await expect(page.getByText(/条件游戏进行中/)).toBeVisible({ timeout: 60_000 });
  await expect(conditionFrame.getByText("打开机关，进入月萤遗迹")).toBeVisible({ timeout: 60_000 });
  await conditionFrame.locator("body").click();
  await conditionFrame.locator("body").press("E");
  await expect.poll(
    async () => {
      const session = (await readSessionFromIndexedDb(page, "E2E-001")) as {
        conditionOrder?: string[];
        conditionRuns?: Record<string, { attempts?: Array<{ gameEvents?: unknown[] }> }>;
      };
      const secondCondition = session?.conditionOrder?.[1] ?? "";
      const events = session?.conditionRuns?.[secondCondition]?.attempts?.[0]?.gameEvents ?? [];
      return events.length;
    },
    { timeout: 30_000 }
  ).toBeGreaterThan(0);

  await skipCurrentStep(page);
  await expect(page.getByRole("heading", { name: /条件 B 后评估/ })).toBeVisible();
  await answerQuestionnaireGroups(page);

  // --- Comparison: each card answers both likert ratings and 无偏好. ---
  await expect(page.getByRole("heading", { name: /样本对比/ })).toBeVisible();
  const cards = page.getByTestId(/comparison-event-/);
  const cardCount = await cards.count();
  for (let i = 0; i < cardCount; i++) {
    const card = cards.nth(i);
    const groups = card.getByRole("group");
    const groupCount = await groups.count();
    for (let g = 0; g < groupCount; g++) {
      const middle = groups.nth(g).getByLabel("3");
      if ((await middle.count()) > 0) await middle.check();
    }
    await card.getByLabel("无偏好").check();
  }
  await page.getByRole("button", { name: /继续/ }).click();

  // --- Final assessment. ---
  await expect(page.getByRole("heading", { name: /最终评估/, level: 2 })).toBeVisible();
  await page.getByLabel("触觉条件 A").check();
  await page.getByRole("group").filter({ has: page.getByRole("radio", { name: "4" }) }).first().getByLabel("4").check();
  await page.getByRole("button", { name: /继续/ }).click();

  // --- Interview (all optional) then completion. ---
  await expect(page.getByRole("heading", { name: /试验后访谈/, level: 2 })).toBeVisible();
  await page.getByRole("button", { name: /继续/ }).click();
  await expect(page.getByRole("heading", { name: /会话完成/ })).toBeVisible();

  // --- Unified export: one zip（编号-昵称-实验时间.zip）bundling JSON + five CSVs. ---
  const downloadPromise = page.waitForEvent("download", { timeout: 30_000 });
  await page.getByRole("button", { name: /导出全部数据/ }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^E2E-001-端到端测试-\d{8}-\d{4}\.zip$/);

  const zipBytes = await readDownloadBytes(download);
  const zip = await JSZip.loadAsync(zipBytes);
  expect(Object.keys(zip.files).sort()).toEqual([
    "audit-log.csv",
    "game-events.csv",
    "game-summary.csv",
    "haptic-cues.csv",
    "session.json",
    "subjective.csv"
  ]);

  // The exported JSON itself merges subjective and objective data under one session id.
  const exportedJsonText = await zip.file("session.json")!.async("string");
  expect(exportedJsonText).toBeTruthy();
  const exportedJson = JSON.parse(exportedJsonText) as {
    schemaVersion: number;
    conditionResponses: Record<string, Record<string, unknown>>;
    comparisonResponses: Record<string, unknown>;
    finalResponses: Record<string, unknown>;
    conditionRuns: Record<string, { attempts: Array<{ gameEvents: unknown[] }> }>;
  };
  expect(exportedJson.schemaVersion).toBe(3);
  expect(Object.keys(exportedJson.conditionResponses)).toHaveLength(2);
  expect(Object.keys(exportedJson.finalResponses).length).toBeGreaterThan(0);
  const exportedRuns = Object.values(exportedJson.conditionRuns);
  expect(exportedRuns).toHaveLength(2);
  for (const run of exportedRuns) {
    expect(run.attempts[0]?.gameEvents.length).toBeGreaterThan(0);
  }

  // The exported session JSON merges subjective and objective data under one session id.
  const session = (await readSessionFromIndexedDb(page, "E2E-001")) as {
    id: string;
    schemaVersion: number;
    counterbalanceCell: string;
    gameAssignment: { timelineSeed: string; projectileSequenceId: string; areaSequenceId: string };
    conditionOrder: string[];
    conditionRuns: Record<
      string,
      { displayCondition: string; timelineSeed: string; attempts: Array<{ status: string; gameEvents: unknown[] }> }
    >;
    conditionResponses: Record<string, unknown>;
  };
  expect(session.schemaVersion).toBe(3);
  expect(session.counterbalanceCell).toMatch(/^(AB|BA)$/);
  expect(session.gameAssignment.timelineSeed).toBeTruthy();
  const runs = Object.values(session.conditionRuns);
  expect(runs).toHaveLength(2);
  for (const run of runs) {
    expect(run.timelineSeed).toBe(session.gameAssignment.timelineSeed);
    expect(run.attempts.length).toBeGreaterThanOrEqual(1);
    expect(run.attempts[0]?.gameEvents.length).toBeGreaterThan(0);
  }
  expect(Object.keys(session.conditionResponses)).toHaveLength(2);
});
