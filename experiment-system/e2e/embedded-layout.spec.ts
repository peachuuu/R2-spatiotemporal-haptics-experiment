import { expect, test, type Page } from "@playwright/test";

/**
 * Embedded layout acceptance: measures the real iframe boxes and the game's
 * internal document metrics in Chromium at three desktop viewports. Asserts
 * geometry (getBoundingClientRect/clientWidth/clientHeight/scrollWidth/
 * scrollHeight) — never CSS strings. Bridge messages are exercised for real
 * along the way (PRACTICE_READY/COMPLETE, GAME_READY -> START_RUN).
 */

test.setTimeout(600_000);

const VIEWPORTS = [
  { width: 1920, height: 1080 },
  { width: 1440, height: 900 },
  { width: 1280, height: 720 }
] as const;

async function startSessionToPractice(page: Page, code: string) {
  await page.goto("/");
  await page.getByLabel(/参与者编号/).fill(code);
  await page.getByLabel(/昵称/).fill("布局测试");
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

  await page.getByRole("button", { name: /跳过此步骤/ }).click();
  await page.getByRole("button", { name: /确认跳过/ }).click();
  await expect(page.getByRole("heading", { name: /操作说明/ })).toBeVisible();
}

async function frameDocumentMetrics(page: Page, testId: string) {
  const handle = await page.locator(`iframe[data-testid="${testId}"]`).elementHandle();
  const frame = await handle.contentFrame();
  if (frame === null) throw new Error(`iframe ${testId} content frame is null`);
  return frame.evaluate(() => {
    const doc = document.documentElement;
    return {
      clientWidth: doc.clientWidth,
      clientHeight: doc.clientHeight,
      scrollWidth: doc.scrollWidth,
      scrollHeight: doc.scrollHeight
    };
  });
}

async function frameElementsInsideViewport(page: Page, testId: string, selectors: string[]) {
  const handle = await page.locator(`iframe[data-testid="${testId}"]`).elementHandle();
  const frame = await handle.contentFrame();
  if (frame === null) throw new Error(`iframe ${testId} content frame is null`);
  return frame.evaluate((sels) => {
    const doc = document.documentElement;
    const missing: string[] = [];
    const outside: Array<{ selector: string; rect: DOMRect }> = [];
    for (const selector of sels) {
      const el = document.querySelector(selector);
      if (!el) {
        missing.push(selector);
        continue;
      }
      const rect = el.getBoundingClientRect();
      const within =
        rect.width > 0 &&
        rect.height > 0 &&
        rect.top >= -2 &&
        rect.left >= -2 &&
        rect.bottom <= doc.clientHeight + 2 &&
        rect.right <= doc.clientWidth + 2;
      if (!within) outside.push({ selector, rect });
    }
    return { missing, outside };
  }, selectors);
}

for (const viewport of VIEWPORTS) {
  test(`game steps fill the iframe without internal scroll at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await startSessionToPractice(page, `LAY-${viewport.width}`);

    // --- Practice step ---
    const practiceWrap = await page.locator(".embedded-frame-wrap").boundingBox();
    expect(practiceWrap).not.toBeNull();
    // Target layout: iframe capped at ~1200px and centered.
    expect(practiceWrap!.width).toBeLessThanOrEqual(1201);
    if (viewport.width >= 1440) {
      expect(practiceWrap!.width).toBeGreaterThanOrEqual(1150);
    } else {
      expect(practiceWrap!.width).toBeGreaterThanOrEqual(1100);
    }

    // The real practice iframe is already loaded through the bridge.
    const practiceFrame = page.frameLocator('iframe[data-testid="practice-frame"]');
    await expect(practiceFrame.getByRole("button", { name: "完成练习并继续" })).toBeVisible({
      timeout: 60_000
    });

    const practiceMetrics = await frameDocumentMetrics(page, "practice-frame");
    expect(practiceMetrics.scrollWidth, "practice horizontal overflow").toBeLessThanOrEqual(practiceMetrics.clientWidth + 2);
    expect(practiceMetrics.scrollHeight, "practice vertical overflow").toBeLessThanOrEqual(practiceMetrics.clientHeight + 2);

    const practiceVisibility = await frameElementsInsideViewport(page, "practice-frame", [
      ".hud",
      ".boss",
      ".hero-anchor",
      ".practice-task-picker",
      ".notice"
    ]);
    expect(practiceVisibility.missing, `missing: ${practiceVisibility.missing.join(", ")}`).toEqual([]);
    expect(practiceVisibility.outside, `outside: ${JSON.stringify(practiceVisibility.outside)}`).toEqual([]);

    // Embedded practice hides the game's own title and mode switching.
    await expect(practiceFrame.getByText("OPERATION PRACTICE")).toHaveCount(0);
    await expect(practiceFrame.getByText("时空触觉模式")).toHaveCount(0);
    await expect(practiceFrame.getByText("基础触觉模式")).toHaveCount(0);
    await expect(practiceFrame.getByText("无触觉测试模式")).toHaveCount(0);

    // PRACTICE_READY was consumed by the parent (real bridge).
    await expect(page.getByText(/练习已就绪/)).toBeVisible({ timeout: 60_000 });

    // Complete practice through the real game button -> condition A.
    await practiceFrame.getByRole("button", { name: "完成练习并继续" }).click();
    await expect(page.getByRole("heading", { name: /条件 A/i })).toBeVisible({ timeout: 60_000 });

    // --- Condition step ---
    const conditionWrap = await page.locator(".embedded-frame-wrap").boundingBox();
    expect(conditionWrap).not.toBeNull();
    // Same visual size as the practice iframe.
    expect(Math.abs(conditionWrap!.width - practiceWrap!.width)).toBeLessThanOrEqual(2);
    expect(Math.abs(conditionWrap!.height - practiceWrap!.height)).toBeLessThanOrEqual(2);

    const conditionFrame = page.frameLocator('iframe[data-testid="condition-frame"]');
    // GAME_READY -> START_RUN through the real bridge.
    await expect(page.getByText(/条件游戏进行中/)).toBeVisible({ timeout: 60_000 });
    await expect(conditionFrame.getByText("打开机关，进入月萤遗迹")).toBeVisible({ timeout: 60_000 });

    const conditionMetrics = await frameDocumentMetrics(page, "condition-frame");
    expect(conditionMetrics.scrollWidth, "condition horizontal overflow").toBeLessThanOrEqual(conditionMetrics.clientWidth + 2);
    expect(conditionMetrics.scrollHeight, "condition vertical overflow").toBeLessThanOrEqual(conditionMetrics.clientHeight + 2);

    // G01 mechanism scene fully visible with its bottom hint text.
    const g01Visibility = await frameElementsInsideViewport(page, "condition-frame", [
      ".mechanism-scene",
      ".g01-copy"
    ]);
    expect(g01Visibility.missing, `missing: ${g01Visibility.missing.join(", ")}`).toEqual([]);
    expect(g01Visibility.outside, `outside: ${JSON.stringify(g01Visibility.outside)}`).toEqual([]);

    // Embedded formal mode hides game chrome (already covered by unit tests; re-proven here).
    await expect(conditionFrame.getByText("EXPERIMENTAL GAME")).toHaveCount(0);
    await expect(conditionFrame.getByText("Developer run")).toHaveCount(0);
    await expect(conditionFrame.getByText("无触觉测试模式")).toHaveCount(0);

    // --- Questionnaire step keeps the 960px reading width ---
    await page.getByRole("button", { name: /跳过此步骤/ }).click();
    await page.getByRole("button", { name: /确认跳过/ }).click();
    await expect(page.getByRole("heading", { name: /条件 A 后评估/ })).toBeVisible();
    const appWidth = await page.locator(".app").evaluate(el => el.getBoundingClientRect().width);
    expect(appWidth).toBeLessThanOrEqual(961);
  });
}

test("standalone local practice keeps its title and mode switching", async ({ page }) => {
  await page.goto("http://localhost:3001/?mode=practice");
  await expect(page.getByRole("heading", { name: /月萤遗迹/ })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("OPERATION PRACTICE")).toBeVisible();
  await expect(page.getByRole("button", { name: "练习模式" })).toBeVisible();
  await expect(page.getByRole("button", { name: "时空触觉模式" })).toBeVisible();
  await expect(page.getByRole("button", { name: "基础触觉模式" })).toBeVisible();
});
