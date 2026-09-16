# 电触觉硬件连接问题:诊断与修复记录(2026-08-29)

> 用途:记录本次"硬件连接不稳定 / 校准超时 / 游戏无触感"问题的完整排查过程、
> 已实施的修复、验证结果与遗留事项,供后续维护与实验季查阅。

---

## 1. 症状(实验者报告)

1. **阈值校准最后一区报错**:`重新 ARM 失败:等待设备响应超时(3000ms)`;
2. **重新连接串口后恢复**——正式实验不应要求重连;
3. **正式游戏场景无触感**:游戏画面声音正常、宿主面板显示"已连接(固件 v0.3 样本表 v5)· 已 ARM · 输出等级 0 · 忙碌(出现又消失)",但全程无电刺激感。

---

## 2. 诊断过程(分层排除,先取证后修)

### 2.1 协议层:真机逐命令握手测试 → 全部正常

用诊断脚本(见 §6)在 COM5 上按协议 v2 逐条发送命令,记录设备回话:

| 命令 | 结果 |
|---|---|
| HELLO | ✅ 固件 v0.3、样本表 v5 |
| GET_STATUS / ARM / SET_CALIBRATION / STOP | ✅ 全部正确应答,CRC 与事务号全对 |

结论:**串口线、USB 驱动、固件协议核心全部正常**;ARM 门控、电压设置(等级 100 生效)、安全停止均正常。

### 2.2 样本层:单独播放 → 正常,放电有感觉

`PREPARE sth.g01.unlock` → 设备确认(时长 5.085s)→ `COMMIT_AFTER(500ms)` → STARTED → 实验者**有真实触感**。

结论:**固件样本表 v5 完整、样本不是问题**(实验者的判断正确)。

### 2.3 关键发现:固件调试文字污染协议串口

抓取原始字节时发现,协议帧之间夹杂**纯文本调试输出**(如 `[段] 12/18` 进度),来源为固件 `demo.ino` 在协议路径上的 `Serial.print/println`(如 `[状态] ARMED_IDLE`、`[状态] SCHEDULED`、`[完成] …` 等)。这些文字违反协议 v2 规范(串口应只承载二进制帧),会挤乱/撞坏协议回复,导致网页端丢帧、命令超时——与"校准 ARM 超时"症状吻合。

### 2.4 诊断脚本自身的三个坑(维护时注意,均已修复)

1. **PowerShell 5.1 对 `[byte]` 的移位运算溢出为 0**:`$byteArr[n] -shl 8` 结果恒为 0,导致 CRC 校验永远只比对低字节、解析器误判"坏帧"并逐字节吞掉帧头。修复:移位前先 `[int]` 转换。
2. **PowerShell 函数返回数组被拆包**:`return $frames` 会把单元素数组解包为字节流。修复:`Write-Output -NoEnumerate $frames`。
3. **`param([string]$Port)` 与对象变量 `$port` 大小写同名冲突**(PowerShell 变量不分大小写):串口对象被转成字符串。修复:对象变量改名 `$sp`。
4. **`New-Object` 构造 SerialPort 在本机异常**(DtrEnable 赋值失败),改用 `[System.IO.Ports.SerialPort]::new(...)`。
5. **打开 CDC 会复位手套芯片**:打开串口置位 DTR 时设备复位重启,复位窗口内发的第一条命令回复会被截断。修复:开端口后等 6s,HELLO 最多重试 3 次(与浏览器端握手重试策略一致)。

---

## 3. 根因结论

**主犯:固件调试文字与协议 v2 挤在同一条串口线上。** 设备本身、样本、网页主流程均健康。调试文字间歇性撞坏协议回复 → 网页端丢帧 → 命令超时 → 表现为"校准超时/需要重连"。

---

## 4. 修复与调整清单

### 4.1 固件端(本轮)

文件:`C:\Users\Lenovo\Desktop\R2电刺激样本\demo\demo.ino`(**hv.cpp / hv.h 未改动**)

- 新增编译开关 `SERIAL_DEBUG`(默认 0);
- 用 `#if SERIAL_DEBUG` 包住协议路径上全部 11 处调试打印:
  `[FAULT]`、`[状态] ARMED_IDLE`、`[拒绝] COMMIT`、`[状态] SCHEDULED`、
  `[状态] PLAYING`、`[FAULT] WATCHDOG_STOP`、`[完成]`、`[段] 进度`、
  `[FAULT] calibration map`、开机横幅两行;
- 烧录后验证:6 条命令全部 1 帧纯净回话,`[raw] 0 bytes`,串口流 100% 干净。

### 4.2 网页端(上轮 AI 完成,本轮全量验证通过;提交 97ba189 / b8451b0)

- 宿主 iframe:连接握手自动重试(HELLO×3)、心跳不可重入(5s 一次)、单次状态丢包容忍(TIMEOUT 连续 3 次才释放、IO 立即释放)、connectionEpoch 防陈旧回复、断开过滤所选端口;
- ARM 超时统一(桥层 2000→3000ms)、命令超时统一(3000→7000ms);
- 宿主面板常驻不卸载(`hidden` 替代条件渲染)、按钮改名"硬件连接";
- EmbeddedConditionRunner:重复 GAME_READY 不回退运行态(修"游戏已就绪,正在启动…"卡死);cue 失败改为 `CUE_FAILURE` 冻结在游戏内 + `CUE_RECOVERY_REQUEST` 恢复;START_CUE 改用相对 delayMs(跨源时钟安全);
- 数据日志:`appendHapticCue` 改为仅"同 cueKey 且同 outcome"时覆盖,失败与成功记录都保留。

### 4.3 测试同步(本轮)

`experiment-system/e2e/fake-serial-e2e.spec.ts` 三处陈旧断言对齐现行设计:
1. cue 失败提示/重试按钮从父页面移到游戏 iframe 内断言;
2. 样本 ID 链 `01/B01` → 可读 ID `sth.g01.unlock` / `bh.g01.unlock`;
3. 日志断言改为"失败+成功都保留"语义。

---

## 5. 验证结果(2026-08-29)

| 项目 | 结果 |
|---|---|
| R2 端全量单测 | 144/144 ✅ |
| 游戏端全量单测 | 193/193 ✅ |
| E2E 整机联调(fake-serial 两条) | 2/2 ✅(校准 ACK + 正式 cue 失败暂停/游戏内重试/恢复) |
| 实机协议逐命令诊断 | 12/12 命令成功 ✅ |
| 实机样本放电 | 有触感 ✅ |
| 固件烧录后串口纯净度 | 100% 干净,零调试文字 ✅ |

---

## 6. 诊断工具:`scripts/diagnose-haptic.ps1`

```powershell
# 阶段 1(不放电,安全):握手/状态/ARM/设等级/停止
powershell -NoProfile -ExecutionPolicy Bypass -File d:\R2\scripts\diagnose-haptic.ps1
# 阶段 2(播放一次 sth.g01.unlock,会真的放电,必须戴好手套):
powershell -NoProfile -ExecutionPolicy Bypass -File d:\R2\scripts\diagnose-haptic.ps1 -WithStimulation
```

注意事项:
- 运行前关闭 R2 实验网页与 Arduino IDE 串口监视器(否则 COM5 被占用);
- 若设备无应答,先拔插 USB 给手套断电重启;
- 输出含每帧的解码与 `[raw]` 原始字节(应为 0 字节 = 串口纯净)。

---

## 7. 遗留与后续观察项

1. **若超时仍偶发**(固件净化后):下一张牌是网页端命令级自动重试(超时→GET_STATUS 对账→重发一次,ARM 已有对账,可扩展到其余命令),不动固件。
2. **看门狗 30s→60s**:`demo.ino` `COMMAND_WATCHDOG_MS`(一行改动,需重新烧录)。安全底线保留(浏览器崩溃最坏 60s 自动断电),仅在心跳仍触发误撤 ARM 时启用。
3. **治本备选(实验季后)**:串口旁路服务(sidecar),由本地常驻进程持有串口,彻底摆脱浏览器定时器节流/刷新丢端口问题。接缝在 `HapticSerialHost`,协议与上层不变。

## 8. 后续修复(2026-08-30)

### 8.1 固件:STOP 后保留最后校准等级

症状:游戏场景无触感、面板"输出等级 0 · 忙碌"(网页改动在进入游戏前多发了一次 STOP,而固件 `enterSafeState` 会把 `voltageCode` 归零,样本播放因此以 0 级输出)。

修复:`demo.ino` `enterSafeState` 不再归零 `voltageCode`(硬件断电/高阻仍由 `outputFloatAll()` 保证,安全不变)。真机验证:SET_CALIBRATION(100) → STOP → GET_STATUS 返回 voltageCode=100。

### 8.2 固件:样本播放按区域取各自校准等级

需求:8 区域阈值各不相同,游戏样本必须使用各自区域的校准值,而非全局最后等级。

修复:`demo.ino` 新增 `playbackVoltageForPair(pair)`——按电极对所属输出通道查 `outputChannelVoltageCodes[channel]`;未校准(0)、跨通道或不属任何通道时回退全局 `voltageCode`,绝不静默用 0。播放路径(协议 v2 分支)改用该函数;CLI 分支不变。hv.cpp/hv.h 未改动。

### 8.3 网页:游戏内就地调级(不 STOP、不断联)

症状:游戏内"调整输出等级"沿用了校准页逻辑(`STOP → ARM → SET_CALIBRATION`),在触觉播放中点「确定」会掐断当前样本、撤 ARM,导致后续 cue 冻结,连续超时还会触发宿主释放串口("断联")。

修复(R2 端):
- `CalibrationAdapter` 新增 `applyVoltageInPlace` / `startStimulationInPlace` / `stopStimulationInPlace`;
- 就地应用:先查状态,已 ARM 且空闲(状态 1)时直接 `SET_CALIBRATION`;播放/调度中显式报"设备忙,请等当前事件结束后重试",不发任何命令;
- 脉冲预览停止后自动 STOP → 重新 ARM,把已解锁设备交回游戏;
- `CalibrationDialog` 增加 `inPlace` 属性:游戏内打开不 STOP、全部就地操作;校准页/对比页/终评页仍走原 STOP 流程;
- `ConditionScreen` 的游戏内调级入口传 `inPlace`。

推荐操作顺序:先「事件结束后暂停」→ 等游戏完全停住 → 再调级并「确定」→ 关闭面板继续。

### 8.5 网页:ARM/状态变化必须推送给父页面(2026-08-30)

症状:重连并 ARM 后,样本对比页/终评页仍提示"硬件未连接或未 ARM",播放按钮禁用。

根因:宿主面板只在连接、断开、释放串口时向 R2 推送 `STATUS_CHANGED`,**ARM 成功后从不推送**;父页面各屏幕的 armed 标记永远停留在旧值。

修复(游戏端 `HardwareHostPage.tsx`):每次 `refreshStatus` 成功后比较 armed/connected/busy/voltageCode/fault 的组合键,**状态有变化即向父页面推送 `STATUS_CHANGED`**(空闲心跳不变时不重复推送);断开/释放串口时重置记录,重连后自动重新同步。未改动任何串口/握手/心跳机制。

### 8.4 ⚠️ 约束:不要更改硬件与网页连接机制

经真机逐命令诊断、连续 40 次状态查询与两端全量测试验证的连接机制,是当前稳定性的基石,未经真机回归**不得更改**:

1. 固件 `SERIAL_DEBUG=0`:串口只承载二进制协议帧,禁止调试文字(§3 根因);
2. 打开端口必须置位 DTR/RTS(RP2 Nano 要求);
3. HELLO 最多自动重试 3 次(覆盖 USB CDC 复位窗口);
4. 5 秒不可重入 `GET_STATUS` 心跳(维持 30 秒固件命令看门狗);
5. 单次 TIMEOUT 容忍、连续 3 次才释放串口;IO/NOT_CONNECTED 立即释放;
6. connectionEpoch 隔离迟到回包;
7. 断线后必须手动重连 + 手动 ARM,绝不自动解锁输出;
8. 固件 STOP 后保留最后校准等级(不归零);
9. 样本播放按电极所属区域取校准等级(未校准回退全局)。

任何改动必须:先 `scripts/diagnose-haptic.ps1` 真机验证 → 两端全量测试 → E2E,全绿方可合入。
