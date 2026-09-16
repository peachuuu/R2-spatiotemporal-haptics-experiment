# R2 时空触觉实验系统（存档版）

本仓库是可移植的完整实验存档，包含 R2 实验流程系统、Spirit Ruins 游戏、RP2040 电刺激固件、运行素材、测试和说明文档。

## 目录

- `experiment-system/`：唯一实验入口、随机化、校准、问卷、记录与导出。
- `game/`：由实验系统嵌入的练习和正式游戏。
- `firmware/demo/`：RP2040 固件及 PW 查表。
- `docs/`：系统说明、硬件协议、安装和数据说明。
- `scripts/`：启动、停止、诊断及启动器测试。

## 环境要求

- Windows 10/11。
- Node.js `>= 22.13.0`，同时安装 npm。
- Chrome 或 Edge；真实硬件连接需要 Web Serial。
- 真实电刺激另需兼容硬件、正确接线和已烧录的本仓库固件。

## 最快启动

1. 下载并解压仓库，路径中可以包含中文或空格。
2. 双击根目录 `start-experiment.cmd`。
3. 首次运行会分别执行两次 `npm ci`，需要联网并等待数分钟。
4. 启动器会自动打开 `http://localhost:5173`，这是参与者唯一入口。
5. `http://localhost:3001` 仅为被嵌入的游戏服务，不应直接交给参与者。

停止时，真实设备先点击页面中的“立即停止”，再在启动窗口按 `Ctrl+C`；若窗口已关闭，双击 `stop-experiment.cmd`。

## 运行模式

- **干跑模式**：不向硬件发送真实刺激，用于流程验收和教学演示。
- **生产模式**：使用真实硬件。必须在页面选择串口、确认设备状态并由操作者手动 ARM；系统不会自动 ARM。

详细步骤见 [Windows安装与运行](docs/INSTALL-WINDOWS.md)、[固件说明](docs/FIRMWARE.md)和 [R2实验系统总说明](docs/R2-实验系统总说明.md)。

## 验证命令

```powershell
cd experiment-system
npm ci
npm test
npm run build

cd ..\game
npm ci
npm run test:unit
npm run build

cd ..
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\test-startup.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\start-integrated.ps1 -NoOpen
```

## 数据和隐私

实验导出的 JSON、CSV、XLSX 和 ZIP 不属于源代码，不得提交到仓库。详细规则见 [数据导出说明](docs/DATA-EXPORT.md)和 [隐私检查清单](PRIVACY-CHECKLIST.md)。

## 授权边界

本仓库用于课程、科研复核和项目存档。除非素材来源和量表授权另有明确说明，不授予公开再分发第三方图片、音频、字体、论文或量表原文的权利。公开仓库前必须再次完成版权核对；当前建议使用 GitHub 私有仓库并邀请指导教师。

