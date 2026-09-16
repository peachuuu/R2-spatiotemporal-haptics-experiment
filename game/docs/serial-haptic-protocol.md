# 游戏 ↔ RP2040 串口触觉协议 v2

日期：2026-08-27（取代旧单字节 0x01–0x0B 基线）

## 1. 架构：R2 协调、单一硬件宿主、游戏受控起播

- 整次 R2 会话中，**只有**游戏源（3001）的持久 HardwareHost iframe
  （`?mode=serial-host&embedded=1&sessionId=…&parentOrigin=…`）能请求并持有
  Web Serial。校准页、正式游戏 iframe、练习场景都不直接访问
  `navigator.serial`。
- R2 是 cue 协调者：游戏在 cue 边界发 `CUE_REQUEST`，R2 解析 STH/BH 样本 ID，
  经 HardwareHost 下发 `PREPARE_SAMPLE`，收到 `PREPARED` 后选定未来 `cueAt`，
  向游戏发 `START_CUE(cueAt)`（浏览器同一 performance.now 基准），向固件发
  `COMMIT_AFTER(delayMs)`（相对延迟）。
- 默认 `leadMs=150`；只能由无人负载台架测量调整。绝不把浏览器绝对时钟发给
  MCU，也不声称亚毫秒同步；实际偏差写入逐 cue 日志。

## 2. 帧格式（固件 demo.ino 与游戏 hapticProtocol.ts 逐字节一致）

```text
MAGIC(0x52 0x32) | VERSION(1) | OPCODE(1) | TXN_ID(4 LE) | LEN(2 LE) | PAYLOAD(N) | CRC16(2 LE)
```

- CRC16-CCITT（poly 0x1021，init 0xFFFF，无反射），覆盖 MAGIC..PAYLOAD，小端附加。
- TXN_ID 由浏览器递增生成，所有响应回显。
- 坏 CRC/坏版本：设备丢弃至下一个 MAGIC 并回 `ERROR(BAD_CRC)`；主机解码器同样重同步。

### Golden vectors（固件与 TS 测试共同冻结）

| 帧 | HEX |
|---|---|
| HELLO txn=1 | `52 32 01 01 01 00 00 00 00 00 48 51` |
| PREPARE_SAMPLE "07Alf" txn=2 | `52 32 01 06 02 00 00 00 05 00 30 37 41 6c 66 ba 44` |
| PREPARED "07Alf" dur=0x30d40 txn=2 | `52 32 01 86 02 00 00 00 09 00 30 37 41 6c 66 40 0d 03 00 75 1f` |
| COMMIT_AFTER 150ms txn=3 | `52 32 01 07 03 00 00 00 04 00 96 00 00 00 5a 7f` |
| STOP txn=4 | `52 32 01 08 04 00 00 00 00 00 85 39` |
| ERROR SAMPLE_UNDEFINED("01") txn=5 | `52 32 01 8a 05 00 00 00 03 00 06 30 31 51 11` |
| SET_CALIBRATION(region2, code100) txn=6 | `52 32 01 04 06 00 00 00 02 00 02 64 be e3` |

## 3. 操作码与状态机

主机→设备：`HELLO 0x01`、`GET_STATUS 0x02`、`ARM 0x03`、`SET_CALIBRATION 0x04`、
`START_CALIBRATION 0x05`、`PREPARE_SAMPLE 0x06`、`COMMIT_AFTER 0x07`、`STOP 0x08`。
设备→主机：`HELLO_ACK 0x81`、`STATUS 0x82`、`ARMED 0x83`、`CALIBRATION_APPLIED 0x84`、
`CALIBRATION_STARTED 0x85`、`PREPARED 0x86`、`STARTED 0x87`、`COMPLETE 0x88`、
`STOPPED 0x89`、`ERROR 0x8A`。

状态机：`CONNECTED_SAFE → ARMED_IDLE → PREPARING → PREPARED → SCHEDULED → PLAYING`；
任意 STOP/超时/故障 → `CONNECTED_SAFE`（输出 0 + 全部电极高阻）；断开/复位 →
`DISCONNECTED`。`PREPARED` 的含义：样本存在、电极合法互斥、时段与脉冲参数通过
校验、输出未开启、调度器就绪。

载荷：
- `HELLO_ACK`：[fwMajor, fwMinor, sampleTableVersion, caps]（caps bit0 = DRY_RUN）
- `STATUS`：[state, armed, voltageCode, preparedSampleLen, preparedSample(ascii), fault]
- `SET_CALIBRATION`：[regionIndex, voltageCode]；`CALIBRATION_APPLIED`：[regionIndex, voltageCode]
- `START_CALIBRATION`：[regionIndex]；校准脉冲结束后 `COMPLETE`
- `PREPARE_SAMPLE`：[sampleId ascii]；`PREPARED`：[sampleId ascii + durationUs LE4]
- `COMMIT_AFTER`：[delayMs LE4]；起播时 `STARTED`：[deviceStartUs LE4]；自然结束 `COMPLETE`：[sampleId + elapsedUs LE4]
- `STOP`/`ARM`/`ARMED`/`STOPPED`：空载荷
- `ERROR`：[errorCode, detail ascii]

错误码：`0x01 BAD_CRC`、`0x02 BAD_FRAME`、`0x03 BAD_STATE`、`0x04 NOT_ARMED`、
`0x05 UNKNOWN_SAMPLE`、`0x06 SAMPLE_UNDEFINED`、`0x07 INVALID_ELECTRODE_MAP`、
`0x08 INVALID_OUTPUT`、`0x09 BUSY`、`0x0A WATCHDOG_STOP`、`0x0B TIMEOUT`。

## 4. 样本语义（STH/BH/NONE）

- STH 用基础 ID（`01`、`07Alf`…）；BH 统一加 `B` 前缀（`B01`、`B07Alf`…）。
- NONE（无触觉测试模式）是开发/展示模式：永不访问串口，不等待 READY，样本缺失
  不阻塞；日志 `hapticMode:"none"`、`hapticDisabled:true`、`hapticOutcome:"skipped"`，
  不进入正式 STH/BH 统计。
- 正式 STH/BH：未连接/未 ARM/PREPARE 超时/样本未定义/硬件错误 → 暂停试次并显示
  操作者可恢复错误；绝不自动降级为 NONE。
- 未提供数据的样本一律 `available=false`，PREPARE 返回 `ERROR SAMPLE_UNDEFINED`；
  禁止占位波形。

### 事件映射

| 游戏 cue | STH ID | BH ID | 对齐对象 |
|---|---|---|---|
| G01 机关解锁 | 01 | B01 | 解锁动画起点 |
| G03 燃烧开始 | 02 | B02 | 火焰长音频与 6 帧火焰循环起点（不是施法蓄力） |
| G04 幽灵穿过 | 03 | B03 | 幽灵可见移动起点 |
| G05/G09 宝箱提示 | 04a/04b | B04a/B04b | 实际生成的宝箱侧别（左 a / 右 b） |
| G06/G10 划凸棱 | 06 | B06 | 划动音效/动画起点（内部 cue 1） |
| G06/G10 开箱 | 05 | B05 | 箱盖打开音效/动画起点（内部 cue 2） |
| G07/G11 投射物 | 07Alf/07Arf/07Al/07Ar | B… | 投射物入场景起点（左 l/右 r × 快 f/慢） |
| G07/G11 危险区 | 07Baf…07Bd | B… | 实际扩张起点（锚点 a-d 左→右 × 快慢） |
| G08 雨开始 | 08 | B08 | 雨音/雨滴/视野恢复共同起点 |
| G12 第一枚烟花 | 09 | B09 | 烟花音频与升空动画起点 |

G02 无样本（不得沿用旧 0x02 语义）。G07/G11 侧别/快慢/锚点参数缺失时**失败关闭**。

## 5. 参数语义

`phaseWidthUs`（单相脉宽 μs）、`pulsePeriodUs`（burst 内脉冲周期 μs）、
`burstPeriodUs`（burst 周期；30Hz≈33333）、`pulseCount`（=3）、
`phaseBalancePercent`（=50）、`voltageCode`（0–255 输出控制码）。
未经验证的物理电压换算前，UI 只显示 `voltageCode`/“输出等级（0–255）”。

## 6. 安全

- 上电/复位/断线/错误/看门狗超时/STOP → 输出 0 + 全部电极高阻。
- 固件独立最大时长看门狗 + 主机命令看门狗；不依赖浏览器存活。
- 操作者手势 ARM；页面加载不自动 ARM。改样本/区域/输出等级前先 STOP 并隔离。
- 候选样本 `01`（5.09s/17 段）在确认归属前编译期禁止
  （`ALLOW_CANDIDATE_01_PLAYBACK=0`）；自动化测试只用 Mock/虚拟串口/DRY_RUN。
