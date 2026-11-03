# 制作层 · Production Layer

> 输入：`workflow-v4/translation` 产出的 `brief.ready.json`
> 输出：一个能跑的 Remotion 工程 + animatic + 成片
>
> **brief 给事实、约束、问题和验收；制作层给载体、镜头、节奏、动效和声音。**
> 制作层不是执行分镜，是把 brief 的 `mustAchieve` 变成画面。

## 为什么单独放

- 转译层解决“别让模型猜事实”；
- 制作层解决“别让模型照抄分镜”；
- 两层用文件交接，不共享上下文。

## 两种模式

| 模式 | 触发 | 制作层先做什么 |
|---|---|---|
| **Directed** | brief 里 `visual.mechanismSource = "user"`，用户自己给了载体 | 不换载体；建议给 2 种**执行方式**（v1 最低 1 种），选 1 种；重点做 timing、镜头、数据形态 |
| **Open** | brief 只给 `visualProblem` + `candidateDirections` | 建议提 2–3 个**载体**（v1 最低 1 个），至少 1 个不是 brief 里的；选 1 个再进 beatboard |

## 两个 phase

| Phase | 角色 | 只做什么 | 不能做什么 | 门 |
|---|---|---|---|---|
| **Director** | 画面导演 | 载体、每拍至少 1 种解法（建议 2）、timing plan、buildability 风险 | 写代码、写 scene、写 QA | `--director` |
| **Builder** | 执行 | animatic、scene、render、QA | 静默替换载体 | `--build` / `--final` |

同一个模型可以先后扮演两个 phase，但要换 prompt、换上下文边界；不是两个独立 agent。
Director 的输出是 `production.json` 的前半部分，Builder 只在此基础上做。

## 本地动效库（已接入）

- `workflow-v4/library/templates/`：**81 个零依赖模板**，直接 import；
- `workflow-v4/library/cards/`：**157 张镜头卡**，给镜头语言；
- `remotion-scenes` 201 个组件不在本地：需要 `src/common` + `three`，不是零依赖；
- 搜索：`node tools/search-library.mjs "comparison"`；
- `library.searched` + `decision`（used/rejected）+ `reason` 必须有；
- `decision=used` 时，`library.used` 至少 1 条 template/scene，路径必须真实存在；`decision=rejected` 时写清为什么不用；
- `--build` / `--final` 只在 `decision=used` 时检查 `scenes[].library` + `scenes[].file`，源码里必须真的渲染 `<Template>`；只 import 不算；
- `--build` 还会用 ffprobe 核对 `timing.animatic` 时长 ≈ totalSeconds，并检查 scenes 覆盖全时间轴；3s 假 animatic/只写一个 90 帧 scene 都过不了；
- `--final` 要求 `qa.finalVideo` 指向成片，且时长 ≈ totalSeconds；只有 stills/碎片不算交付。

## 五个阶段 / 四道门

```
G1 Carrier     建议 2 个载体/执行方式（v1 最低 1），选 1，写风险
   ↓ 门 1
G2 Beatboard   每个 beat 至少 1 种解法（建议 2），选 1，不写秒数
   ↓ 门 2
G3 Animatic    480p/12fps 粗动画，量真实段长，只锁 hardAnchors
   ↓ 门 3
G4 Build       先 3 镜 playable，再全片；timing 集中在一个文件
   ↓ 门 4
G5 QA           stills + motion clips + audio + acceptance
```

### G1 · Carrier

- Directed：建议两种执行方式（v1 最低 1 种），例如“切线追焦 / 锯齿列阵”，都不换用户指定的光轨；只给 1 种要写为什么不做第二个。
- Open：建议两个以上载体（v1 最低 1 个），至少一个不是 brief 里的候选；只给 1 个要写为什么不做第二个。
- 每个写：一句话、为什么能同时满足 `mustAchieve`、最大风险。

**门 1**：方案真的不同吗？有 2 个时，有一个不是 brief 里的吗？选中的写了“为什么不是另一个”吗？

### G2 · Beatboard

- 每个 beat 给至少 1 种视觉解法（建议 2），选 1 种；有备选才写 `rejected`。
- 不写 `at`，不写“第几秒到第几秒”。
- 先杀默认：照片 + 推拉、大字卡、居中标题、纯光效、八个场景轮播。

**门 2**：每个 beat 至少有 1 种解法吗？有 2 种时，至少 1 种不在 `mayUse` 里吗？有没有踩 `avoid`？

### G3 · Animatic

- 480×270 / 12fps / 真实音乐或 VO；先做粗动画，不追求好看。
- 量每个段落**实际需要多久**；只保证 `timing.hardAnchors` 命中。
- 某段需要更久：砍内容、合并 beat、换载体；**不许用空镜/慢推/无意义停留填**。
- 产物：`animatic.mp4` + `timing.json`。

**门 3**：硬锚点命中吗？总时长成立吗？有没有一段靠 padding 撑？关掉声音还成立吗？

### G4 · Build

- 先做 3 镜 / 15–20s playable，确认载体、运动、字体、数据形态。
- 再写全片；`theme.ts` / `data.ts` / `lib.ts` 分离；所有段落时长集中在一个 `timing.ts`，不要散落在每个 scene。
- 先写共享 primitive，但不要为了“组件化”把 600 行 scene 拆成 30 个空壳。

**门 4**：3 镜成立吗？运动连续吗？数据可读吗？有没有“stills 好看、一动就散”？

### G5 · QA

- stills：每个 beat 至少 2 帧；关键转场拼 contact sheet。
- motion：每段渲 2–3s 低分辨率片段，看连续性，不只看单帧。
- audio：时长、响度、声道、音画同步；音频在 G3 就定。
- data：每个数字对 source。

**门 5**：`acceptance` 每条成立吗？有没有黑帧/死帧/文字读不清/爆音？

## 产物

一个片一个目录，最多 5 个文件：

```
films/<film>/
├── production.json     # carrier + beatboard + timing + scenes + qa
├── animatic.mp4        # G3 产物
├── timing.json         # 实测段长（可从 production.json 拆出）
├── 04-scene.spec.json  # G4 产物
└── 05-qa.md            # G5 产物
```

`production.json` 是制作层自己的合同，不是转译层的 brief，也不是分镜表。

## 怎么跑

```bash
# Director phase：只允许 carrier/beats/timing/director，不许 scenes/qa
node tools/check-production.mjs path/to/production.json --director

# Builder phase：animatic 之后，要求 measured + scenes
node tools/check-production.mjs path/to/production.json --build

# 交付：还要求 qa.frames / qa.motionClips / qa.finalVideo
node tools/check-production.mjs path/to/production.json --final
```

## v1 测试协议

只跑一条片，时间盒 90 分钟：

1. **选输入**：用新输入；不要复用归档里的城市夜晚/DeepSeek，否则会复读旧方向。
2. **Director**：选 1 个载体；至少 1 个 probe（still 或 2s clip）；不要求每 beat 两解。
3. **Animatic**：480×270 / 12fps，真实 VO；量段长，写 `timing.animatic`。
4. **Build**：先 3 镜 playable，再全片。
5. **QA**：stills + motion clips + 音频；盲评记录分数/耗时/返工。

**v1 硬门只有 5 条**：brief 通过、carrier/beats/timing、1 个 probe、animatic measured、1 个 playable + QA stills/motion + `finalVideo`。
其余（2 个方案、每 beat 2 解、必须用模板）都是建议，不卡门。

## 历史样例（已归档）

`examples/deepseek/production.json` 与 `examples/citynight/production.json` 已移到
`~/remotion/_archive/2026-10-18-v1-clean/examples/production-layer-examples/`。
它们只保留“当时的 plan 长什么样”的证据，**不是 v1 测试输入**。

> 下面是历史对照，只说明“不用工作流也能做出好片”的原因；不要把旧片内容当测试输入。

## 从 d861e1 学到的

`20261018_180650_d861e1`：25s / 1080p60 / 5 个 scene / 2450 行；69 次 vision、3 次 patch、4 次渲染，
18:06 开始、18:12 写代码、18:16 第一批 stills、18:57 交付。

它做对的：

- 提示词本身就是导演阐述：一条光轨、7 个折点、10.5s 星环、数据、色板、结尾；
- 先做 score 和 data，再写 scene；
- 靠 render → vision → 改参数，不靠反复改代码；
- contact sheet 看节奏，音频也验；
- 只有 3 次 patch。

它没做的：

- 没有 animatic/timing pass；段落帧写死在 `theme.ts` 和 scene 里；
- scene 太大（Ascent 623 行 / Duel 606 行）；
- 音频 gain 到 18:47 才改；
- 数据来源到最后才说明；
- 没有显式 carrier/beatboard，强提示词掩盖了这一步。

所以制作层的规则是：

1. **一个片一个载体**；不是八个场景拼起来。
2. **时间在 animatic 里量**，不在 brief 里拍。
3. **每个 beat 建议先给 2 种解法**（v1 最低 1 种），再选。
4. **先粗动画，后精修**；不要先抛光 stills。
5. **render → look → fix** 是主循环；文档只是脚手架。

## 边界

- 不读原始字幕、聊天记录、`input.md`；只读 `brief.ready.json`。
- 不把 `beats.visual` / `candidateDirections` 当必须复刻。
- 不写“第几秒到第几秒”的分镜表；`timing.json` 是量出来的。
- 不用照片 + 推拉、大字卡、八个无关场景填时间。
- 不在 animatic 之前写最终 scene 代码。
