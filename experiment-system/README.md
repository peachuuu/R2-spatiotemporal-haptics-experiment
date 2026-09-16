# 实验流程系统（R2）

系统功能、数据保存、导出字段、恢复策略与待实现边界见 [R2 实验系统总说明](../docs/R2-实验系统总说明.md)。

电触觉游戏实验（空间位置游戏触觉设计，实验代号 R2）的独立本地实验流程系统。它无需游戏构建、触觉样本或连接硬件即可跑完完整实验流程——从参与者登记到数据导出的十个阶段。游戏、校准、触觉三处集成点全部位于类型化适配器契约之后，当前实现均为确定性 Mock。

> **安全提示：本版本不包含任何真实电刺激。** 任何浏览器操作都不会接触硬件或网络端点。
> `MockHapticAdapter` 只返回模拟状态并写入本地日志。生产模式下若适配器报告不可用，
> 界面会报错并阻止完成——绝不假装成功。

构建规格：`../experiment-workflow-system.md`（该文档既是规格也是实施计划）。

## 快速开始

```bash
npm install                  # 安装依赖
npm run dev                  # 本地运行 http://localhost:5173
```

质量保障：

```bash
npm test                     # 单元 + 集成测试（Vitest + Testing Library）
npm run test:coverage        # 覆盖率报告（v8）
npm run typecheck            # TypeScript 严格类型检查
npm run build                # 类型检查 + 生产构建（dist/）
npm run e2e                  # Playwright 验收测试（需先 `npx playwright install chromium`）
```

## 实验流程

| # | 阶段 | 干跑模式可跳过 |
|---|---|---|
| 1 | 基本信息（参与者编号、昵称、年龄、性别、触觉经验、模式、反平衡单元） | 否 |
| 2 | 知情同意（滚动阅读、勾选同意） | 否 |
| 3 | 阈值校准（8 个手部区域：电压输入 + 确定施加 + 开始/停止校准开关） | 是 |
| 4 | 操作说明（仅实验目标文字） | 是 |
| 5 | 条件 A 占位场景（9 个事件 + 结束场景） | 是 |
| 6 | 条件 A 后问卷（完整 HXI 20 题 + 2 道电触觉问题） | 是 |
| 7 | 条件 B 占位场景 | 是 |
| 8 | 条件 B 后问卷 | 是 |
| 9 | 跨条件样本对比（9 对事件：事件截图 + 触觉/音频试听 + 适宜程度评分 + 偏好 + 选填理由） | 是 |
| 10 | 最终评估（样本 A/B 占位展示 + 总体偏好 + 差异感知 + 总体理由） | 是 |
| 11 | 试验后访谈（5 道开放题，全部选填） | 是 |
| 12 | 完成页（数据导出） | 否 |

隐藏的条件顺序在会话开始时一次性确定：反平衡单元 `AB` 先运行 `baseline` 再运行
`spatiotemporal`；`BA` 则相反。参与者只能看到显示标签 `条件 A/B` 和 `样本 A/B`——内部映射绝不暴露。

## 操作员指南

### 干跑模式与生产模式

- **干跑（仅模拟）**：界面持续显示 `干跑 / 仅模拟` 徽章，每个可操作阶段都有 `跳过此步骤`
  按钮。点击跳过会弹出对话框：选择原因（`硬件不可用`、`游戏不可用`、`样本不可用`、
  `操作员演示`、`其他`——选择"其他"需填写 1–280 个字符的说明），勾选
  **我确认本次会话为干跑**，然后确认。跳过操作连同原因与时间戳写入审计日志。
- **生产模式**：没有跳过控件，也没有模拟徽章。若适配器报告不可用，界面显示错误且无法完成该步骤。

### 会话恢复

每次操作都会即时持久化到本地 IndexedDB。实验中（校准、条件、问卷任一环节）刷新页面，
会出现 `继续会话 <编号>`，从已保存的精确步骤恢复且不改变条件顺序。任何界面的
`保存并退出` 会返回会话列表；`开始另一个会话` 会把其他进行中的会话标记为 `abandoned`。

### 数据

- 存储：仅浏览器本地 IndexedDB（`electrotactile-study` → `sessions`），不上传任何数据。
  不记录身份信息——唯一的参与者标识是操作员录入的不透明编号
  （2–32 位大写字母、数字、连字符或下划线）。
- 导出：完成页提供单文件 JSON/主观 CSV，以及核心 ZIP `{编号}_{YYYYMMDD-HHmm}.zip`。
  ZIP 保留 `raw/`（session、game-events、haptic-cues、audit-log）和 `qc/data-quality.csv`，并在
  `analysis/` 中提供原始主观长表、四行 `objective-summary.csv` 与五工作表 `subjective.xlsx`。
  汇总与工作簿只读取已持久化会话数据，不影响游戏或硬件；静态量表键仍不进入被试 ZIP。每次下载都会追加一条 `Exported` 审计事件。
  只有最终评估校验通过后会话才标记为 `complete`；跳过过步骤的会话导出状态为进行中
  （不完整），完成页会明确提示。
- 审计日志：每个有意义的动作（`SessionStarted`、`ConsentGranted`、`StepEntered`、
  `StepCompleted`、`StepSkipped`、`AdapterStatus`、`AdapterAction`、`Exported`）都带
  ISO 8601 UTC 时间戳追加记录，并随会话一并导出。

### 校准

8 个手部区域（左/右手掌、拇指食指、中指无名指、小指）固定行，每行包含：一个电压输入框（0–100 V）、`确定` 按钮
（点下后实际电压调整为输入值并记录 `AdapterAction`）、`开始校准`/`停止校准` 开关
（控制电触觉样本的通断——本版本为模拟，不接触任何硬件）。全部区域确认电压后
才能继续。**校准数值属于安全敏感配置：仅存储，绝不用于驱动硬件（本版本）。**

## 架构

```text
src/
  domain/          types.ts（数据契约 §4）、session.ts（纯构造器/辅助函数）
  protocol/        版本化实验内容：consent.v1、instructions.v1、questions.v1、conditions.v1
  adapters/        contracts.ts（HapticAdapter/GameAdapter/CalibrationAdapter/CueMediaAdapter）、
                   Mock* 适配器、CueCoordinator（两阶段硬件时序契约 §3.3）
  app/             studyMachine.ts（纯流程控制器 + 步骤校验）、
                   StudyContext.tsx（持久化桥接）、App.tsx（路由）
  storage/         StudyRepository、IndexedDbStudyRepository、exportSession（纯 JSON/CSV 序列化）
  components/      StepFrame、SkipStepDialog、Questionnaire、CalibrationGrid、MockConditionRunner
  screens/         每个实验阶段一个界面
```

所有问卷措辞来自 `src/protocol/` 的版本化配置——组件绝不内嵌题目文本。每个量表旁保留
来源引用元数据（`questions.v1.ts`）。未来新增条件只需扩展 `ConditionId` 和
`conditions.v1.ts`；组件与状态机跟随配置，不做分支。

硬件时序契约（§3.3）：`CueCoordinator` 先调用 `prepareCue`，只有
`readiness === "ready"` 后才计算共同开始时间
`cueAtMs = max(now, readyAtMs) + recommendedLeadMs`，随后调用 `commitCue` 并以相同事件 ID
和 `cueAtMs` 通知媒体/游戏适配器。未来接入必须检查双手手套上位机工程与 `demo.ino`，
并只在 `HapticAdapter` 接口之后实现真实握手。

## 生产数据采集前需要的外部输入

1. 伦理批准的知情同意文本、伦理审批编号（如有）及确切的同意书版本号。
2. 正式的问卷中文措辞、HXI 及所有改编条目的使用许可/引用决定、反向计分规则（如有）。
3. 硬件方提供的最终手指清单、电压单位/范围、安全上限、校准停止规则和急停流程。
4. 检查上位机工程与 `demo.ino` 后确定的实际指令/应答协议。
5. 最终条件映射、事件/样本标识、媒体素材、游戏完成信号，以及样本 A/B 呈现是否需要顺序随机化。
6. 撤回同意、中断会话以及本地数据保留/删除的操作政策。

本版本的同意书与问卷措辞为**草稿种子内容**——未经伦理批准，也非正式翻译。

## 整合运行（R2 × Spirit Ruins）

本系统现在是唯一实验入口；Spirit Ruins 游戏（仓库根目录的 `game/`，
固定端口 `http://localhost:3001`）仅作为 iframe 嵌入练习与两个正式条件步骤。

一条命令启动完整系统（CMD）：

```bat
..\start-experiment.cmd
```

启动器会：检查 Node 与两个项目目录 → 首次运行自动 `npm ci` → 检查 5173/3001
端口占用 → 以隐藏窗口启动两个 dev server → 轮询健康检查 → 打开
`http://localhost:5173`。日志位于仓库根目录的 `logs/game.log` 与
`logs/experiment.log`。关闭启动窗口或 Ctrl+C 只停止启动器自己启动的进程。

### 整合架构要点

- **双服务、单入口**：参与者只打开 `http://localhost:5173`；不要直接打开游戏 URL
  （`embedded=1` 仅在 iframe 内有效，直接打开会降级为本地练习模式）。
- **条件随机化**：系统按“两会话一块”的平衡块自动分配 AB/BA（Web Crypto 随机，
  IndexedDB 原子事务持久化）；操作员不再手动选择反平衡单元。
- **两条件一致性**：同一会话共享 `timelineSeed`、`projectileSequence`、
  `areaSequence`，仅触觉策略不同（`baseline→BH`、`spatiotemporal→STH`）；
  参与者只看到条件 A/B。
- **iframe 通信**：全部消息校验 origin、`source === "spirit-ruins"`、
  `protocolVersion === 1` 与会话/运行身份；不匹配的消息被忽略并写入诊断审计。
  练习步骤消费 `PRACTICE_READY/PRACTICE_COMPLETE/PRACTICE_ERROR`；正式条件
  等待 `GAME_READY` 后发送唯一一次 `START_RUN`，逐事件持久化 `GAME_EVENT`，
  仅接受校验通过的 `RUN_COMPLETE` 后才进入问卷。
- **恢复**：每步即时写入 IndexedDB；刷新后按 sessionId 恢复到精确步骤且不
  重新随机化。中断/失败的尝试保留为 attempt 历史，重试不会覆盖。
- **会后整理**：下载核心 ZIP 后，日常分析可直接使用其中的 `analysis/*_objective-summary.csv` 与
  `analysis/*_subjective.xlsx`；如需逐试次系统端派生表，再在本目录执行
  `npm run derive:data -- "C:\\下载目录\\P001_YYYYMMDD-HHmm.zip"`；结果写入
  `derived/` 下的 `objective-trials`、`hxi`、`pxi`、`game-summary` CSV，静态对照表在
  `references/`，不随参与者文件下载。

### 质量保障（新增）

```bash
npm test                     # 含协议、随机分配、恢复与数据合并测试
npm run test:derive          # 核心 ZIP → 系统端派生表命令测试
npx tsc --noEmit             # 严格类型检查
npm run build                # 生产构建
npm run e2e                  # 两服务真实 iframe 端到端（复用运行中的 5173/3001）
powershell -NoProfile -ExecutionPolicy Bypass -File ..\scripts\test-startup.ps1  # 启动器助手测试
```

游戏侧对应命令（仓库根目录的 `game/`）：`npm run test:unit`、`npm run build`。
游戏 dev server 固定端口 3001（`vite.config.ts` 中 `server.port/strictPort`）。
R2 侧游戏 origin 可通过 `VITE_GAME_ORIGIN` 覆盖（默认 `http://localhost:3001`）。
