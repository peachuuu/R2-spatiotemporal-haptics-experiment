import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { CONDITION_EVENT_IDS } from "../src/protocol/conditions.v1";
import { CONDITION_QUESTIONS, FINAL_QUESTIONS } from "../src/protocol/questions.v1";
import type { Question } from "../src/protocol/questions.v1";

test.setTimeout(300_000);

async function startDryRun(page: Page, code: string) {
  await page.goto("/");
  await page.getByLabel(/参与者编号/).fill(code);
  await page.getByLabel(/昵称/).fill("测试者");
  await page.getByLabel(/年龄/).fill("22");
  await page.getByLabel("男").check();
  await page.getByLabel("从未").check();
  await page.getByRole("button", { name: /继续/ }).click();

  // Consent: scroll the text to the end and agree.
  await page.getByTestId("consent-scroll").evaluate(element => {
    element.scrollTop = element.scrollHeight;
  });
  await page.getByLabel(/我已阅读并理解/).check();
  await page.getByRole("button", { name: /继续/ }).click();
}

async function skipPlain(page: Page) {
  await page.getByRole("button", { name: /跳过此步骤/ }).click();
  await page.getByRole("button", { name: /确认跳过/ }).click();
}

async function answerRequired(page: Page, questions: readonly Question[]) {
  for (const question of questions) {
    if (!question.required) continue;
    const group = page.getByRole("group", { name: question.prompt });
    if (question.response.kind === "likert") {
      const middle = Math.round((question.response.min + question.response.max) / 2);
      await group.getByLabel(String(middle)).check();
    } else if (question.response.kind === "choice") {
      const first = question.response.options[0];
      if (first === undefined) throw new Error(`no options configured for ${question.id}`);
      await group.getByLabel(first.label).check();
    }
  }
  await page.getByRole("button", { name: /继续/ }).click();
}

async function completeComparison(page: Page) {
  for (const eventId of CONDITION_EVENT_IDS) {
    const card = page.getByTestId(`comparison-event-${eventId}`);
    const threes = card.getByLabel("3");
    await threes.nth(0).check();
    await threes.nth(1).check();
    await card.getByLabel("样本 A").check();
  }
  await page.getByRole("button", { name: /继续/ }).click();
}

test("operator can complete a dry-run with logged skips and the embedded practice step", async ({ page }) => {
  await startDryRun(page, "DEMO-001");

  await expect(page.getByRole("heading", { name: /阈值校准/ })).toBeVisible();
  await skipPlain(page);
  await expect(page.getByRole("heading", { name: /操作说明/ })).toBeVisible();

  // The practice step embeds the real game; complete it via the bridge.
  const practiceFrame = page.frameLocator('iframe[data-testid="practice-frame"]');
  await expect(practiceFrame.getByRole("button", { name: "完成练习并继续" })).toBeVisible({
    timeout: 60_000
  });
  await practiceFrame.getByRole("button", { name: "完成练习并继续" }).click();
  await expect(page.getByRole("heading", { name: /条件 a/i })).toBeVisible({ timeout: 60_000 });

  // Dry-run conditions can be skipped (production cannot); the skip is audited.
  await skipPlain(page);
  await expect(page.getByText(/条件后问卷/)).toBeVisible();
  await answerRequired(page, CONDITION_QUESTIONS);

  await expect(page.getByRole("heading", { name: /条件 b/i })).toBeVisible();
  await skipPlain(page);
  await expect(page.getByText(/条件后问卷/)).toBeVisible();
  await answerRequired(page, CONDITION_QUESTIONS);

  await expect(page.getByRole("heading", { name: /样本对比/ })).toBeVisible();
  await completeComparison(page);

  await expect(page.getByRole("heading", { name: /最终评估/, level: 2 })).toBeVisible();
  await answerRequired(page, FINAL_QUESTIONS);

  await expect(page.getByRole("heading", { name: /试验后访谈/, level: 2 })).toBeVisible();
  await page.getByRole("button", { name: /继续/ }).click();

  await expect(page.getByRole("heading", { name: /会话完成/ })).toBeVisible();
  await expect(page.getByText(/未填写/).first()).toBeVisible();
  await expect(page.getByText(/状态：已完成/)).toBeVisible();
});
