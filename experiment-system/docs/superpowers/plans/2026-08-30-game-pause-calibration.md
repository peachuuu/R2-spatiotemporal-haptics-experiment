# 游戏暂停与就地阈值校准 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在事件边界暂停游戏，并在游戏与样本评估中复用安全的阈值校准控件。

**Architecture:** 时间线引擎新增等待继续的推进闸门；游戏页面只在事件自然结束后进入该闸门。R2 使用一个复用校准弹窗，通过现有硬件适配器控制，不直接拥有或重新连接串口。

**Tech Stack:** TypeScript, React, Vitest, Vite。

**Spec:** `docs/superpowers/specs/2026-08-30-game-pause-calibration-design.md`

## Global Constraints

- 不改动游戏事件、触觉样本、cue 调度、条件、试次数、问卷或串口持有关系。
- 暂停不得截断当前事件的音画触。
- 弹窗不得创建第二个 Web Serial 连接。

---

### Task 1: 时间线事件边界暂停

**Files:** `D:\SpiritRuins-Experiment\web\app\game\TimelineEngine.ts`, `D:\SpiritRuins-Experiment\web\tests\game\TimelineEngine.test.ts`

- [ ] 写出并运行失败测试：请求暂停不截断当前事件，结束时等待继续，继续后才启动下一事件。
- [ ] 实现 `requestPause()` 和 `continueAfterPause(atMs)` 的最小推进闸门。
- [ ] 重跑聚焦测试。

### Task 2: 游戏操作控件与日志

**Files:** `D:\SpiritRuins-Experiment\web\app\components\ExperimentPage.tsx`, `D:\SpiritRuins-Experiment\web\app\components\GameViewport.tsx`

- [ ] 接入按钮、等待继续遮罩和已有运行日志；不触碰 cue 调度。
- [ ] 运行游戏单元测试。

### Task 3: 复用校准弹窗

**Files:** `D:\R2\experiment-system\src\components\CalibrationDialog.tsx`, `D:\R2\experiment-system\src\screens\ConditionScreen.tsx`, `D:\R2\experiment-system\src\screens\FinalAssessmentScreen.tsx`, `D:\R2\experiment-system\tests\unit\CalibrationDialog.test.tsx`

- [ ] 写出并运行失败测试：打开后安全停止，渲染校准网格，关闭不推进游戏。
- [ ] 复用现有校准回调实现弹窗，并加入两处入口，不创建串口连接。
- [ ] 重跑聚焦测试。

### Task 4: 文档与回归

**Files:** `D:\R2\docs\R2-实验系统总说明.md`

- [ ] 更新操作步骤和安全边界。
- [ ] 运行 R2 与游戏完整测试和生产构建。
