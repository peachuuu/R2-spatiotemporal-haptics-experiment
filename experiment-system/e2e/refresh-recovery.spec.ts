import { expect, test, type Page } from "@playwright/test";

/**
 * Refresh recovery over the real store: after a reload mid-experiment the
 * operator resumes the same session at the exact step with the identical
 * condition order, allocation metadata and game assignment — nothing is
 * re-randomized.
 */

test.setTimeout(300_000);

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

test("refresh resumes the same session and allocation without re-randomizing", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel(/参与者编号/).fill("E2E-RESUME");
  await page.getByLabel(/昵称/).fill("恢复测试");
  await page.getByLabel(/年龄/).fill("22");
  await page.getByLabel("男").check();
  await page.getByLabel("从未").check();
  await page.getByRole("button", { name: /继续/ }).click();

  const scroll = page.getByTestId("consent-scroll");
  await scroll.evaluate(el => {
    el.scrollTop = el.scrollHeight;
  });
  await page.getByLabel(/我已阅读并理解/).check();
  await page.getByRole("button", { name: /继续/ }).click();

  // Calibration: skip to reach the practice step quickly.
  await page.getByRole("button", { name: /跳过此步骤/ }).click();
  await page.getByRole("button", { name: /确认跳过/ }).click();
  await expect(page.getByRole("heading", { name: /操作说明/ })).toBeVisible();

  const before = (await readSessionFromIndexedDb(page, "E2E-RESUME")) as {
    currentStepId: string;
    conditionOrder: string[];
    allocationMetadata: { blockId: number; position: number; methodVersion: string };
    gameAssignment: { timelineSeed: string; projectileSequenceId: string; areaSequenceId: string };
  };

  // Complete practice through the real bridge, land on condition A, then reload.
  const practiceFrame = page.frameLocator('iframe[data-testid="practice-frame"]');
  await expect(practiceFrame.getByRole("button", { name: "完成练习并继续" })).toBeVisible({
    timeout: 60_000
  });
  await practiceFrame.getByRole("button", { name: "完成练习并继续" }).click();
  await expect(page.getByRole("heading", { name: /条件 A/i })).toBeVisible({ timeout: 60_000 });

  const atCondition = (await readSessionFromIndexedDb(page, "E2E-RESUME")) as {
    currentStepId: string;
    conditionOrder: string[];
    allocationMetadata: { blockId: number; position: number; methodVersion: string };
    gameAssignment: { timelineSeed: string; projectileSequenceId: string; areaSequenceId: string };
  };
  expect(atCondition.currentStepId).toBe("condition-1");

  // The refresh: the gate offers the same session and resumes it exactly.
  await page.reload();
  await page.getByRole("button", { name: /继续会话 E2E-RESUME/ }).click();
  await expect(page.getByRole("heading", { name: /条件 A/i })).toBeVisible({ timeout: 60_000 });

  const after = (await readSessionFromIndexedDb(page, "E2E-RESUME")) as typeof before;
  expect(after.currentStepId).toBe("condition-1");
  expect(after.conditionOrder).toEqual(before.conditionOrder);
  expect(after.allocationMetadata).toEqual(before.allocationMetadata);
  expect(after.gameAssignment).toEqual(before.gameAssignment);
});
