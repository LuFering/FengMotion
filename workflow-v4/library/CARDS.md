# 00 · 跨库总索引（remotion-scenes 201 + remotion-templates 81）

**用途**：手上有一个「想要的效果」，但不知道翻哪个库、哪一类。**先查这里。**

单库内部速查见各自的 `SKILL.md`；单类详表见同目录下的 `NN-*.md`。

---

## 按效果查

| 想要的效果 | 库 | 位置 |
|---|---|---|
| 数字滚动 / 里程表 | scenes | `RollerAnimations` — `RollerSlotMachine`、`RollerMultiSlot`、`RollerCountdown` |
| 数字从 0 涨到 N | both | scenes `TextAnimations/TextCounter` ／ templates `stat-counter` |
| 文字逐字打出 | both | scenes `RollerTypewriter` ／ templates `typewriter-subtitle` |
| 文字乱码后收敛 | scenes | `TextAnimations/TextScramble`、`RollerAnimations/RollerShuffle` |
| **柱状图** | both | scenes `DataAnimations/DataBarChart` ／ templates `chart-animation` |
| **折线图** | both | scenes `DataAnimations/DataLineChart` ／ templates `line-chart` |
| **饼图 / 环形图** | both | scenes `DataAnimations/DataPieChart` ／ templates `pie-chart`、`donut-chart` |
| 环形进度 | both | scenes `ShapeAnimations/ShapeCircularProgress` ／ templates `circular-progress` |
| 一排统计数字 | both | scenes `DataAnimations/DataStatsCards` ／ templates `stat-counter` |
| 进度条 | both | scenes `DataAnimations/DataProgressBars` ／ templates `progress-bars` |
| **纸吹雪 / 庆祝** | both | scenes `ParticleAnimations/ParticleConfetti` （更强） |
| 烟花 | scenes | `ParticleAnimations/ParticleFireworks` |
| 樱花 / 雪 / 气泡 | scenes | `ParticleAnimations/` 下的 `ParticleSakura` / `ParticleSnow` / `ParticleBubbles` |
| 星空飞行 | templates | `starfield` |
| **墨迹晕开 / 中国风** | scenes | `LiquidAnimations/LiquidCalligraphyInk`、`LiquidInkSplash` |
| 油膜 / 全息 | scenes | `LiquidAnimations/LiquidOilSpill`、`ThemeAnimations/ThemeHolographic` |
| 颜料流淌 | scenes | `LiquidAnimations/LiquidPaintDrip` |
| **胶片颗粒** | both | scenes `EffectAnimations/EffectFilmGrain` ／ templates `noise-grain` |
| VHS / 复古质感 | scenes | `EffectAnimations/EffectVHS`、`CinematicAnimations/CinematicVintage` |
| 光漏 | both | scenes `EffectAnimations/EffectLightLeak` ／ templates `film-burn` |
| 色差 / 故障 | both | scenes `EffectAnimations/EffectChromaticAberration` ／ templates `glitch-text` |
| 暗角 | templates | `vignette-pulse` |
| **镜头摇晃** | templates | `camera-shake`（⚠️ 产品片慎用，见 shotcraft 判例 Q3） |
| **Ken Burns 推拉** | templates | `ken-burns` |
| 视差 | templates | `parallax-pan` |
| 甩镜 | templates | `whip-pan` |
| **转场：淡入淡出** | templates | `cross-dissolve`、`fade-through-black` |
| 转场：圆形 / 光圈 | both | scenes `TransitionAnimations/TransitionCircleWipe` ／ templates `iris-transition` |
| 转场：百叶窗 | both | scenes `TransitionAnimations/TransitionBlinds` ／ templates `blinds-transition` |
| 转场：液体变形 | scenes | `TransitionAnimations/TransitionLiquidMorph` |
| 转场：故障 | scenes | `TransitionAnimations/TransitionGlitch` |
| 转场：白闪 | scenes | `TransitionAnimations/TransitionFlash` |
| 转场：推挤 / 滑擦 / 缩放穿越 | templates | `push-transition`、`slide-wipe`、`zoom-through` |
| **Logo 描边绘制** | both | scenes `LogoAnimations/LogoStroke` ／ templates `logo-stroke-draw` |
| Logo 故障 | both | scenes `LogoAnimations/LogoGlitch` ／ templates `logo-glitch-reveal` |
| Logo 模糊聚焦 | templates | `logo-blur-reveal` |
| Logo 掉落弹跳 | templates | `logo-bounce-drop` |
| **商品图文网格** | both | scenes `ListAnimations/ListUnevenGrid` ／ templates `gallery-grid`、`masonry-gallery` |
| 相片堆叠 | templates | `photo-stack`、`polaroid-frame` |
| 前后对比滑动 | templates | `image-comparison-slider` |
| 图集轮播 | both | scenes `RollerAnimations/Roller3DCarousel` ／ templates `image-carousel`、`rotating-carousel` |
| 画中画 | templates | `picture-in-picture` |
| **光标点击演示** | scenes | `DemoAnimations/DemoCursorClick`（**templates 无对应项**） |
| 页面滚动演示 | scenes | `DemoAnimations/DemoScroll` |
| 表单填写演示 | scenes | `DemoAnimations/DemoTextInput`、`DemoWizard` |
| 弹窗 / 通知 | both | scenes `UIAnimations/UIModal`、`UIToast` ／ templates `notification-pop` |
| 加载中 | both | scenes `UIAnimations/UILoading` ／ templates `circular-progress` |
| 卡片翻面 | templates | `card-flip`（scenes 无此效果 → 复杂版看 shotcraft `card-stack`） |
| 倒计时 | both | scenes `RollerAnimations/RollerCountdown` ／ templates `countdown-timer`、`countdown-intro` |
| 片尾字幕滚动 | templates | `credits-roll`、`end-card` |
| 姓名条 / 下三分之一 | templates | `lower-third` |
| 章节标题 | templates | `chapter-title` |
| 打字机字幕 | templates | `typewriter-subtitle` |
| 音波可视化 | templates | `sound-wave`、`text-highlight` |
| 矩阵数字雨 | scenes | `EffectAnimations/EffectMatrix` |
| 万花筒 | scenes | `EffectAnimations/EffectKaleidoscope` |
| 极光 / 网格渐变背景 | both | scenes `BackgroundAnimations/BackgroundAurora` / `BackgroundMeshGradient` ／ templates `gradient-shift` |
| 散景光斑 | both | scenes `BackgroundAnimations/BackgroundBokeh` ／ templates `bokeh-circles` |
| 透视网格（复古未来） | both | scenes `BackgroundAnimations/BackgroundPerspectiveGrid` ／ templates `grid-pulse` |
| 水波 | templates | `liquid-wave` |

---

## 什么时候**两个都别用**

| 需求 | 该去的地方 |
|---|---|
| 镜头该怎么讲故事、什么时候切 | **video-shotcraft 的 157 张镜头卡** |
| 参数调到什么程度算好、什么算翻车 | **shotcraft `references/aesthetic-rules.md` 27 条判例** |
| 转场/节奏的**判例依据** | shotcraft `shot-transitions`、`montage-rhythm-moves` |
| 整体流程、检查清单、已知坑 | `video-production-kit` 的 `02-` / `04-` / `05-` 册 |
| HTML/CSS/GSAP 而非 React 的技术栈 | `hyperframes` 系列（见 `~/.codex/skills/`） |

---

## ⚠️ 用之前必读

**两个库都是「技术素材」，不是「审美标准」。**

1. **它们没有判例。** shotcraft 的 27 条规则来自**真实用户驳回**；本两库只是「能跑、不难看」的代码
2. **默认参数普遍偏快、偏机械。** 大量使用匀速 + 均匀 stagger，正撞 shotcraft 判例 **R2**（匀速读作廉价 PPT）和 **R3**（节奏宁慢勿快）
3. **正确顺序**：shotcraft 定意图与节奏 → 本两库找零件 → **再用判例过一遍**
4. **两个库同类效果有重叠时，优先选 scenes**——它的组件平均更长、参数更完整；templates 胜在零依赖、拷了就用

---

## 目录速览

```
06-动效库/
├── remotion-scenes/          201 个组件 · 16 类 · 需 common/ 依赖
│   ├── SKILL.md              总入口
│   ├── cards/                16 个分类卡册 + 本文件
│   └── src/scenes/           组件源码
└── remotion-templates/       81 个模板 · 9 类 · 零依赖自包含
    ├── SKILL.md
    └── templates/            模板源码
```
