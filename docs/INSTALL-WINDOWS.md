# Windows 安装与运行

## 1. 安装基础环境

安装 Node.js 22.13.0 或更高版本。打开 PowerShell，确认：

```powershell
node --version
npm --version
```

浏览器使用最新版 Chrome 或 Edge。Firefox 不支持本系统使用的 Web Serial 流程。

## 2. 获取项目

可使用 Git：

```powershell
git clone <教师获得的仓库地址>
cd R2-spatiotemporal-haptics-experiment
```

也可以下载 GitHub Source ZIP 并完整解压。不要只复制 `experiment-system` 子目录，因为运行还依赖同仓库的 `game`。

## 3. 启动

双击 `start-experiment.cmd`。首次启动会在两个子项目中自动运行 `npm ci`。健康检查通过后，浏览器自动打开：

```text
http://localhost:5173
```

如果提示端口 5173 或 3001 被占用，先运行 `stop-experiment.cmd`。停止脚本只会关闭命令行同时属于本仓库路径和固定端口的服务，未知程序会被保留。

## 4. 无硬件验收

新建会话时选择“干跑（仅模拟）”，完整检查基本信息、校准表单、练习、两种条件游戏、问卷、事件对比、最终评估和数据导出。页面显示“干跑/仅模拟”时不会产生真实电刺激。

## 5. 真实硬件运行

先按 `FIRMWARE.md` 烧录固件。进入生产会话后，在右侧硬件连接面板选择正确串口，确认固件/样本表版本，手动点击 ARM。正式运行期间不要修改源码或触发开发服务器热更新，否则浏览器可能释放串口。

## 6. 停止

真实硬件先点击“立即停止”，再在启动窗口按 `Ctrl+C`。若启动窗口已关闭，双击 `stop-experiment.cmd`。

## 常见问题

- 串口被占用：关闭 Arduino 串口监视器、其他浏览器标签页和单游戏预览。
- 页面可连接但命令超时：重新插拔设备、刷新 5173、重新选择串口并手动 ARM。
- 首次依赖安装失败：确认网络、Node/npm 版本，然后删除失败产生的子项目 `node_modules` 后重新启动。

