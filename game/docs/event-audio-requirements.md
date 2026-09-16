# 月萤遗迹事件音效需求（最低可用版）

统一格式：WAV，48 kHz，24-bit（找不到时 44.1 kHz/16-bit 也可）；游戏音效不要带音乐、对白或明显环境底噪；峰值控制在 -3 dBFS 左右；需要循环的文件首尾应无爆音。立体声可保留，飞行物应支持左右声像。

| 事件 | 最少文件 | 具体规格 | 中文搜索关键词 | English search keywords | 建议文件名 |
|---|---:|---|---|---|---|
| G01 机关进入 | 2 | 机关描边解锁 0.8–1.5 s；空间开启/进入遗迹 0.8–1.5 s | 魔法机关解锁、符文点亮、传送门开启 | magic mechanism unlock, rune activate, portal open | 已有 `g01-unlock.wav`、`g01-enter-ruins.wav` |
| G02 Boss 落地/石块 | 3 | 玩家坠落 1–2 s；重甲巨物落地 1–2 s；碎石向外飞散 2–4 s | 高处坠落风声、巨人落地、碎石飞散 | falling whoosh, giant armored landing, rock debris scatter | 已有 `g02-hero-drop.wav`、`g02-boss-drop.wav`、`g02-rubble-flight.wav` |
| G03 施法/燃烧 | 2 | 蓄力声播放前 1.8 s；火焰动画与火焰声从 1.8 s 开始并持续 3.7 s，火焰声只播放一次、不循环；G03 总时长 5.5 s | 黑暗魔法蓄力、完整火焰燃烧 | dark magic charge, full fire burning | `g03-boss-cast.wav` + `g03-fire-new.wav`（应裁剪为约 3.7 s） |
| G04 幽灵穿过 | 1 | 5.5–6 s，幽灵群由左到右的空灵掠过，避免尖锐惊吓声 | 幽灵群掠过、灵魂风声 | ghost swarm pass by, spectral whoosh | 已有 `g04-ghost.wav` |
| G05 左侧宝箱提示 | 1 | 2–4 s，低强度、可循环的魔法脉冲/微弱呼吸，不要像奖励弹窗 | 宝箱魔法提示、微弱符文脉冲 | subtle chest magic cue, soft rune pulse | 已有 `g05.wav` |
| G06 横向凸棱解锁 | 2 | 滑动/能量点亮声建议直接制作成 3.0 s；末尾锁扣弹开+木石箱盖开启 0.8–1.2 s。两段都是单文件长度，不是 G06 的 6.3 s 总事件时长 | 指尖划过凸棱、符文充能、宝箱打开 | fingertip ridge scrape, rune charge sweep, stone chest unlock open | `g06-ridge-trace.wav`、`g06-chest-open.wav` |
| G07 战斗 A | 3 | 飞行物掠过核心声 0.7–1 s（接近玩家时播放，并非覆盖 3/5 s 全程）；危险线扩张声准备 1.9–2.6 s，或用同一 1.9 s 素材轻度拉伸；命中脉冲 0.25–0.5 s。这里均指单个音频文件长度 | 魔法弹飞过、危险区域蓄力、魔法冲击 | magic projectile flyby, danger zone charge, magic area impact | `g07-projectile.wav`、`g07-area-expand.wav`、`g07-area-impact.wav` |
| G08 下雨/视野恢复 | 1 | 6.5–8 s，中等雨滴，能听见单滴但无雷声；可无缝循环 | 夜晚遗迹雨声、稀疏雨滴 | night ruins rain, individual raindrops ambience | `g08-rain.wav` |
| G09 右侧宝箱提示 | 1 | 与 G05 同一音色家族，声像偏右、音高可高 2–3 半音 | 右侧宝箱提示、符文脉冲 | right side chest cue, rune pulse | `g09-chest-cue.wav`（也可复用 G05） |
| G10 第二次宝箱解锁 | 2 | 规格同 G06；为减少制作量可以直接复用 G06 两个文件 | 宝箱机关解锁、能量滑动 | chest mechanism unlock, energy ridge sweep | 复用 `g06-ridge-trace.wav`、`g06-chest-open.wav` |
| G11 战斗 B | 3 | 完全复用 G07 的三类素材，继续用播放速率和左右声像区分快慢/方向 | 同 G07 | same as G07 | 复用 G07 三个文件 |
| G12 Boss 击败/烟花（用户表中的 G11） | 2 | Boss 倒地/魔力消散 1–2 s；远处多点烟花 5–7 s，爆点错开、低频不要过重 | Boss倒地、魔力消散、远处烟花 | boss defeat collapse, magic dissipate, distant fireworks multiple bursts | `g12-boss-defeat.wav`、`g12-distant-fireworks.wav` |

最低新增工作量：G06 2 个、G07 3 个、G08 1 个、G09 0–1 个、G10/G11 直接复用、G12 2 个，共新增 8–9 个文件。
