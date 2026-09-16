import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ExperimentPage } from "../../app/components/ExperimentPage";
import { StudyEntry } from "../../app/components/StudyEntry";
import { parseLaunchConfig } from "../../app/game/launchConfig";

const experimentConfig = parseLaunchConfig(
  "?mode=experiment&sessionId=S-1&runId=S-1-C1&condition=BH&projectileSequence=S2&areaSequence=A3&timelineSeed=TS&parentOrigin=http%3A%2F%2Flocalhost%3A5173",
);
const developerConfig = parseLaunchConfig(
  "?mode=developer&sessionId=DEV-001&runId=DEV-001-R1&condition=STH&projectileSequence=S1&areaSequence=A1",
);

describe("embedded experiment page", () => {
  it("hides developer header, restart controls and dev notes in embedded experiment mode", () => {
    const html = renderToStaticMarkup(
      createElement(ExperimentPage, { configOverride: experimentConfig }),
    );
    expect(html).not.toContain("EXPERIMENTAL GAME");
    expect(html).not.toContain("重新开始");
    expect(html).not.toContain("开始游戏");
    expect(html).not.toContain("开发模式：事件固定顺序");
    expect(html).not.toContain("Developer run");
    expect(html).not.toContain("当前事件");
    // Embedded formal mode carries the iframe-filling layout class.
    expect(html).toContain("embedded-game-page");
  });

  it("keeps developer controls in standalone developer mode", () => {
    const html = renderToStaticMarkup(
      createElement(ExperimentPage, { configOverride: developerConfig }),
    );
    expect(html).toContain("EXPERIMENTAL GAME");
    expect(html).toContain("开始游戏");
    expect(html).toContain("Developer run");
    expect(html).not.toContain("embedded-game-page");
  });

  it("shows a bounded config error instead of crashing on a malformed experiment launch", () => {
    const html = renderToStaticMarkup(
      createElement(StudyEntry, {
        searchOverride:
          "?mode=experiment&sessionId=S&runId=R&condition=BH&projectileSequence=S1&areaSequence=A1&parentOrigin=http%3A%2F%2Flocalhost%3A5173",
      }),
    );
    expect(html).toContain("实验模式配置错误");
    expect(html).toContain("timelineSeed is required");
  });

  it("keeps Chinese keyboard instructions in embedded experiment mode", () => {
    const html = renderToStaticMarkup(
      createElement(ExperimentPage, { configOverride: experimentConfig }),
    );
    expect(html).toContain("A/D左右移动；空格跳跃；E交互");
  });
});
