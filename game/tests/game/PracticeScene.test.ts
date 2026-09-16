import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PracticeScene } from "../../app/components/PracticeScene";
import { PracticeTaskMenu } from "../../app/components/PracticeTaskMenu";
import { StudyEntry } from "../../app/components/StudyEntry";
import { parseLaunchConfig } from "../../app/game/launchConfig";

describe("practice entry and scene", () => {
  it("offers practice, STH, BH and NONE before entering a game condition", () => {
    const html = renderToStaticMarkup(
      createElement(StudyEntry, { searchOverride: "" }),
    );
    expect(html).toContain("练习模式");
    expect(html).toContain("时空触觉模式");
    expect(html).toContain("基础触觉模式");
    expect(html).toContain("无触觉测试模式");
  });

  it("hides local modes and shows completion for an embedded R2 practice", () => {
    const html = renderToStaticMarkup(
      createElement(PracticeScene, {
        launchConfig: parseLaunchConfig(
          "?mode=practice&embedded=1&sessionId=P-1&parentOrigin=http%3A%2F%2Flocalhost%3A5173",
        ),
      }),
    );
    expect(html).toContain("完成练习并继续");
    expect(html).not.toContain("时空触觉模式");
    expect(html).not.toContain("基础触觉模式");
    expect(html).not.toContain("无触觉测试模式");
    // Embedded practice fills the R2 iframe: no game title of its own.
    expect(html).toContain("embedded-game-page");
    expect(html).not.toContain("OPERATION PRACTICE");
    expect(html).not.toContain("操作练习");
  });

  it("keeps the local title in standalone practice", () => {
    const html = renderToStaticMarkup(
      createElement(PracticeScene, {
        selectedMode: "practice",
        onModeChange: () => undefined,
      }),
    );
    expect(html).toContain("OPERATION PRACTICE");
    expect(html).not.toContain("embedded-game-page");
  });

  it("shows a bounded configuration error instead of local mode controls", () => {
    const html = renderToStaticMarkup(
      createElement(StudyEntry, {
        searchOverride: "?mode=practice&embedded=1&sessionId=P-1",
      }),
    );
    expect(html).toContain("练习模式配置错误");
    expect(html).not.toContain("时空触觉模式");
  });

  it("renders all three repeatable practice task selectors over the shared scene", () => {
    const html = renderToStaticMarkup(
      createElement(PracticeScene, {
        selectedMode: "practice",
        onModeChange: () => undefined,
      }),
    );
    expect(html).toContain("飞行物来袭");
    expect(html).toContain("危险区域扩张");
    expect(html).toContain("寻找宝箱并进行交互");
    expect(html).toContain("boss-pixel.png");
    expect(html).toContain("hero-pixel.png");
    expect(html).toContain("PS5");
  });

  it("adds completion below the three tasks only for the embedded menu", () => {
    const local = renderToStaticMarkup(
      createElement(PracticeTaskMenu, {
        embedded: false,
        phase: "idle",
        focusedAction: "projectile",
        onFocus: () => undefined,
        onConfirm: () => undefined,
      }),
    );
    const embedded = renderToStaticMarkup(
      createElement(PracticeTaskMenu, {
        embedded: true,
        phase: "idle",
        focusedAction: "complete",
        onFocus: () => undefined,
        onConfirm: () => undefined,
      }),
    );
    expect(local).not.toContain("完成练习并继续");
    expect(embedded).toContain("完成练习并继续");
    expect(embedded.indexOf("完成练习并继续")).toBeGreaterThan(
      embedded.indexOf("寻找宝箱并进行交互"),
    );
  });

  it("locks every menu action while a practice event is active", () => {
    const html = renderToStaticMarkup(
      createElement(PracticeTaskMenu, {
        embedded: true,
        phase: "area-active",
        focusedAction: "area",
        activeTask: "area",
        onFocus: () => undefined,
        onConfirm: () => undefined,
      }),
    );
    expect((html.match(/disabled=""/g) ?? []).length).toBe(4);
    expect(html).toContain("selected");
  });
});
