# 事件素材目录

事件专属素材统一放在 `public/assets/events/Gxx/`。替换时尽量保持文件名不变，即可无需修改代码。

| 事件 | 当前主要文件 |
|---|---|
| G01 | `bgG01.png`、`finger.png`、`g01-unlock.wav`、`g01-enter-ruins.wav` |
| G02 | `g02-impact-dust.png`、`rock-01.png`–`rock-08.png`、3 个 G02 音效 |
| G03 | `boss-cast-01.png`、`boss-cast-02.png`、`fire-1.png`–`fire-6.png`、蓄力声 `g03-boss-cast.wav`、单次火焰声 `g03-fire-new.wav` |
| G04 | `ghost.png`、`g04-ghost.wav` |
| G05 | `chest-pixel.png`、`g05.wav` |
| G06 | `g06-chest-closed-v1.png`、`g06-chest-open-v1.png`；待加入 G06 音效 |
| G07 | `g07-projectile.png`；待加入 G07 三类音效；危险区目前由 CSS 绘制，保证视觉和判定共用参数 |
| G08 | `g08-rain-concept-v1.png`；实际雨滴由独立粒子绘制；待加入 `g08-rain.wav` |
| G09 | `chest-pixel.png`、已有提示音副本 |
| G10 | `g10-chest-closed-v1.png`、`g10-chest-open-v1.png`；可复用 G06 音效 |
| G11 | `g11-projectile.png`；战斗音效可复用 G07 |
| G12 | `g12-fireworks-v1.png`；待加入击败与烟花音效 |

`hero-pixel.png`、`boss-pixel.png`、`ruins-pixel.png`、`ground-platform-v3.png` 是所有事件共用的基础角色和场景素材，仍保留在 `public/assets/` 根目录，避免每个事件出现不同版本。其余事件效果均从对应 Gxx 文件夹引用。
