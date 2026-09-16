import { expect, test, type Page } from "@playwright/test";

/**
 * NONE（无触觉测试模式）验收：
 * - 独立开发页显示“无触觉测试模式”按钮，NONE 全程不触碰 Web Serial；
 * - 完整 G01–G12 流程照常运行（画面、音频、输入、判定、时间线）；
 * - STH → NONE 切换先安全停止触觉事务，再把事件重置到该模式开始状态。
 * 通过把 Navigator.prototype.serial 换成会置位标记并抛错的 getter 来证明
 * “未请求串口权限、未访问串口”。
 */

test.setTimeout(600_000);

async function installSerialProbe(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, "serial", {
      configurable: true,
      get() {
        (window as unknown as { __serialTouched?: boolean }).__serialTouched = true;
        throw new Error("Web Serial must not be touched in NONE mode");
      }
    });
  });
}

async function serialTouched(page: Page): Promise<boolean> {
  return page.evaluate(() => (window as unknown as { __serialTouched?: boolean }).__serialTouched ?? false);
}

test("NONE mode plays the full G01-G12 flow without touching Web Serial", async ({ page }) => {
  await installSerialProbe(page);
  await page.goto("http://localhost:3001/");

  // 独立开发页提供无触觉测试模式入口。
  await expect(page.getByRole("button", { name: "练习模式" })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("button", { name: "时空触觉模式" })).toBeVisible();
  await expect(page.getByRole("button", { name: "基础触觉模式" })).toBeVisible();
  await page.getByRole("button", { name: "无触觉测试模式" }).click();

  // NONE 自动开始：G01 机关场景立即按原规则运行。
  await expect(page.getByText("打开机关，进入月萤遗迹")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("按手柄O键开始解锁")).toBeVisible();

  // 完整通关：来回走动 + 交互，直到 G12 完成横幅出现。
  await page.locator("body").click();
  let direction = 1;
  let lastFlip = Date.now();
  const deadline = Date.now() + 300_000;
  while (Date.now() < deadline) {
    if (await page.getByText(/G12 已完成/).isVisible().catch(() => false)) break;
    if (Date.now() - lastFlip > 5_000) {
      direction = -direction;
      lastFlip = Date.now();
      await page.keyboard.up("a");
      await page.keyboard.up("d");
      await page.keyboard.down(direction === 1 ? "d" : "a");
    }
    await page.keyboard.press("E");
    await page.waitForTimeout(1_100);
  }
  await page.keyboard.up("a");
  await page.keyboard.up("d");
  await expect(page.getByText(/G12 已完成/)).toBeVisible({ timeout: 30_000 });

  // 全程未触碰 Web Serial。
  expect(await serialTouched(page)).toBe(false);
});

test("switching STH -> NONE stops the haptic transaction and resets the event to the start", async ({ page }) => {
  await installSerialProbe(page);
  await page.goto("http://localhost:3001/");

  await page.getByRole("button", { name: "时空触觉模式" }).click();
  await expect(page.getByText("打开机关，进入月萤遗迹")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("按手柄O键开始解锁")).toBeVisible();
  await page.locator("body").press("E");
  await expect(page.getByText("沿机关边缘完成解锁")).toBeVisible();

  // 切换到 NONE：先安全停止触觉事务（emergencyStopAll），再重置到该模式的开始状态。
  await page.getByRole("button", { name: "无触觉测试模式" }).click();
  await expect(page.getByText("按手柄O键开始解锁")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("沿机关边缘完成解锁")).toHaveCount(0);

  expect(await serialTouched(page)).toBe(false);
});
