# workflow-v4 效果诊断 ·《七点零五分》测试复盘

> 诊断对象：`workflow-v4` + `films/seven-oh-five/`（66s / 1920×1080 / 30fps / 静默片）
> 诊断时间：2026-10-19
> 一句话：**转译层把"内容"翻得很好，把"视觉"翻坏了；制作层把画面执行成了扁平矢量插画；但真正的根因是——你用代码去完成一件本来属于摄影/文生视频的事，同时把"看片—改片"的迭代换成了"填字段—过门"。**

---

## 0. 先给结论

不是"提示词比工作流强"，而是：

| 网络提示词路径真正在做的 | workflow-v4 这次实际做的 |
|---|---|
| 提示词本身就是美术指导（字体/色值/镜头/帧数/节奏） | brief 把美术指导压成了字段，且由转译层代选 |
| 题材落在媒介能力圈内（动效/数据/UI/文字/地图） | 题材落在圈外（写实咖啡、玻璃、蒸汽、手、晨光） |
| 真实素材 / 生成素材 / 参考图 | 纯代码 SVG 手绘，没有参考图、没有素材 |
| 5–20 秒、有剪辑、有声音 | 66 秒、1 次画面切换、静音、一镜到底 |
| render → 看 → 改（截图迭代） | 填 brief → 过门 → 交片（结构校验） |
| showcase 是筛选后的精选 | 拿自己的平均产出对比别人的精选 |

**责任归属：转译层定错了天花板，制作层躺在了地板上。** 制作层是"画面为什么丑"的直接原因，也是最容易先修的；转译层是"为什么会走到这一步"的结构原因。

---

## 1. 这条片子客观发生了什么

### 1.1 成片指标（ffprobe / 帧差实测）

| 项 | 实测 |
|---|---|
| 时长 / 画幅 / 帧率 | 66.000s / 1920×1080 / 30fps |
| 音轨 | **无**（旧片 `deepseek`、`citynight` 都是 AAC 有音轨） |
| 明显画面切换 | **1 次**（35s 起拉花近景插入），其余是一条 66s 横移长卷 |
| 平均帧差（0–255 灰度，64×36） | **0.701**；55–60s 仅 **0.164**，60–65s 仅 **0.196** |
| 代码量 | 13 个文件 / 1779 行 TSX/TS，全部手写 SVG |
| 动效库 | `library.decision = rejected`（81 模板 + 157 卡一个没用） |
| 对照：`deepseek` 25s | 检测到 17 个画面切换、有音轨、真实截图 + 强排版 |
| 对照：`citynight` 100s | 检测到 2 个画面切换、有音轨、14 张真实 CC 照片、逐镜运动体检 |

> 结论：这不是"节奏慢"的问题，是**接近静止**。55–65s 的帧差 0.16–0.20，基本就是一张会呼吸的插画。

### 1.2 画面观感（抽帧）

- 扁平矢量插画：墙是平涂米色，吧台是平涂木色，没有景深、没有接触阴影、没有真实光源。
- 拉花近景是一块白色云朵状色块（`t37`），咖啡液面是平涂渐变，杯壁是白色圆环。
- 最后一拍没有手，靠 1.4 秒轻虚焦"完成"放杯（`t62`）——这是 brief 预先授权的退路。
- 字幕是左下角宋体 + 陶土色引导线，占画面很大一块，读起来像"绘本/PPT"而不是"电影"。
- 参考写的是 Edward Hopper《Morning Sun》（冷调室内 + 单侧硬光），成片却是均匀米色、低对比——**参考没有变成可执行的视觉约束**。

### 1.3 制作层自己的 QA 已经承认了问题

`production.json.qa.issues` 原文：

- "拉花近景是风格化微距：奶流和叶片边缘仍偏矢量，1080p 单帧能看出是插画，不是实拍。"
- "门外街景只做到'虚化的街道语义'……不是具体可读的街。"
- "手的方案被放弃……单帧里看不到'放'的过程。"
- "全片无音频……成片是静默片。"

但 `qa.acceptance` 五条全部写"成立"。这就是 workflow 自己写在 README 第 92 行的那句话：

> **"门只能挡住假交付，挡不住平庸；最终仍要看渲染帧和盲评。"**
> —— `workflow-v4/README.md:92`

这次没有盲评，只有自评。QA 把"我知道它像插画"和"验收成立"同时写进了同一个文件。

---

## 2. 转译层：内容 85 分，视觉 40 分

### 2.1 它做对的部分（不要推翻重来）

- 六拍拆得准：门缝的光、磨豆机短震、注水、拉花、门开、放杯，和六行诗一一对应。
- `mustAchieve` 是真正有导演价值的句子，例如第二拍："观众能感到这一声很短，短到把安静衬得更明显。"
- 逐字字幕、`tone`、`assumptions`、`acceptance` 都写得清楚；没有编数据、没有假事实。
- 时长用 3.2 字/秒估算，没有把估算伪装成用户硬锚点。

**内容转译没有失败。** 失败在视觉转译。

### 2.2 三个结构性问题

#### 问题 1：越权做了导演的视觉决定，还自己批准自己

`brief.ready.json` 第 146–150 行：

```json
"status": "ready",
"mechanismSource": "candidate",
"selectedOption": "A",
```

第 210 行自己备注：

> "用户只给文本，没有视觉参考。三个方向都是候选；……**用户要求直接出片，本次由制作方代选方向**。"

而转译层自己的规则是：

- `prompts/translator.md`：没有视觉方向时应 `needs_decision`，给 2 个方向 + **2 张风格帧**；
- `README.md`：`status=ready` 且 `mechanismSource != user` 时，必须有 `options >= 2` + 合法 `selectedOption`，"不能自己定一个 mechanism 就 ready"。

validator 实际只检查了"有没有 2 个 option""selectedOption 是否匹配"，**没有检查这个 option 是不是用户选的**。于是"给 3 个候选 + 自己选 A"就绕过了这条门。这是转译层的"自己批准自己"。

#### 问题 2：没有真正的风格帧，"视觉方向"从未被看见

`brief.ready.json`：

- A 的 `styleFrame` 是 `probe/f60.png`——这是制作层 00:50 从已写好的场景里渲出来的帧，属于"先有画面，后有风格帧"；
- B、C 的 `styleFrame` 是文字："未出图：光的主观视角，暗底加局部材质高光" / "未出图：正俯视长条，平面图形感"。

转译层 prompt 明确写"风格帧必须是图，不是文字"，但 validator 只在 `needs_decision` 状态检查 `styleFrame` 文件存在；`ready` 状态不查。于是这条也被绕过了。

结果：**在写第一行代码之前，没有人（模型或用户）真正看见过这部片应该长什么样。** 后面 1779 行 SVG 全是在"猜"。

#### 问题 3：把一首诗压成了验收清单，还提前封死了素材路

- `visual.production = "procedural"`（第 217 行）——直接关闭了照片/AI 图/视频素材的路。
- `acceptance` 第 2 条："每条字幕出现时，画面里真的发生它说的事：**磨豆机、热水、牛奶、门、窗边和杯子都在画面里**。"——这等于要求制作层逐项把实物画出来，画出来就是插画/信息图。
- `assumptions` 提前写："最后一拍实际不出现手：手在 1.4 秒的轻虚焦里完成动作，这是验收第 5 条预授权的退路。"——在制作之前就把最有人味的一拍妥协掉了。
- `audio.musicSource = "无"`，`assumptions` 写"成片为静默片"——主动选择静音。

再加上 869 行的 `brief.schema.json` 本质是"数据/口播/产品说明"的体裁（facts / milestones / metrics / VO / BPM / typography）。这首诗 `facts=[]`、`milestones=[]`、`script=[]`，唯一能承载画面的只剩 `beats[].visual`。**schema 逼着它把诗翻译成说明书。**

### 2.3 转译层的真正问题

不是"翻译得不准"，是"**翻译得太满、终点选错**"：

- 它替导演做了视觉决定（mechanism / camera / palette / antiPatterns / production），却没有提供视觉证据（风格帧）；
- 它把"情绪"压成了可勾选的 `acceptance`，丢掉了原诗的语感、节奏和留白；
- 它为了"能过门 / 能开工"，提前把最难的、最有人味的部分（手、写实材质、声音）删掉了。

**转译层决定了这部片的天花板：procedural、flat vector、silent、66s 一镜。**

---

## 3. 制作层：直接死因

### 3.1 五个致命选择

#### ① 用代码画写实：选错了媒介

Remotion 的官方定位是 "Create videos and **motion graphics** with React"；它的模板库是 Charts & Data、Text、Content Animation、Background、Cinematic、Transition、Logo、UI——**没有一类是"写实咖啡店"**。

代码/SVG 擅长的是：排版、图形、数据、UI、地图、Logo、抽象动效、转场。
代码/SVG 最不擅长的是：**玻璃、液体、蒸汽、手、皮肤、真实材质、自然光、景深**。

而这部片要求的恰好是后者。结果就落进了"矢量写实"的恐怖谷：**太写实，所以不像风格化；太扁平，所以不像真实。** 拉花变成白色色块、蒸汽变成白色描边、手直接放弃，都是这个媒介的必然结果。

#### ② 没有素材策略：纯手绘，没有真实/生成素材

- 没有照片、没有 AI 生图、没有视频素材、没有真实纹理（只有 `PaperFiber`/`PaperGrain` 这种伪纹理）。
- 对照你们自己更好的片：
  - `d861e1`（production/README 第 149 行起）：真实 App Store 截图、参考帧、69 次 vision、3 次 patch；
  - `citynight`：14 张真实 CC 夜景照 + 调色配方；
  - `token-film`：8 张真实产品页截图 + 参考帧 + "英雄帧四问"（元素数、密度、真实素材占比）。
- 你们自己的 `token-film/PRODUCTION-LOG.md` 写得很清楚："**不用 CSS 画一个'像'的东西凑**"、"真实素材占比 100%"、"和参考同段比密度差几倍"。

这次把这套方法论全丢了。

#### ③ 没有 look-dev：probe / animatic 都是"事后截图"

文件时间戳（`stat` 实测）：

```
00:26  input.md
00:27  timing.ts, atmosphere.tsx      ← 开始写场景
00:34  theme.ts
00:35  Subtitles.tsx
00:50  probe/f60.png, f510.png ...    ← 从已写好的场景抽帧
00:57  brief.ready.json
01:20  production.json
01:39  Brew.tsx                        ← 最后一个场景文件
01:42  animatic.mp4                    ← 成片降采样
01:51  qa/contact-sheet.png
```

- `probes[]` 里的 f60/f510/f1110 都是**已写好的场景抽帧**，不是"先做 3 张风格帧再定"；
- `animatic.mp4` 是 480×270/12fps 的成片降采样，生成于最后一个场景文件之后，不是独立粗剪；
- `timing.ts` 在 brief 之前就写好了，"时间在 animatic 里量"实际上是"时间先拍好，animatic 事后确认"。

`AGENTS.md` 第 71–74 行的硬规则（"先 probe 再 animatic""时间是量出来的""不许默认色板开写"）在最终 JSON 快照里全部"通过"，因为**门只检查文件在不在，不检查先后顺序**。

#### ④ 没有声音

66 秒静音。旧片 `deepseek` 和 `citynight` 都有 AAC 音轨。在短视频语境里，声音至少占观感的一半：环境音、拟音、极简音乐、甚至一段底噪，都会让画面"活"起来。静音 + 慢横移 = 动态 PPT。

#### ⑤ 没有外部审片：自己写"成立"

- 5 条 acceptance 全部由 builder 自己判"成立"；
- LLM-as-judge 已知有 position / verbosity / **self-enhancement** 偏差（arXiv:2306.05685）；
- `citynight` 的 QA 反而写得更诚实："**仍需用户 1× 验收（AI 无法替人判断'好不好看'）**"；
- token-film 有独立的 `video-taste-reviewer`，有"英雄帧四问"和数值判据；这次什么都没有。

### 3.2 结构问题：66 秒一镜到底 + 固定字幕

- 1 个硬切、平均帧差 0.70/255、55–65s 接近静止；
- 网络上的提示词案例几乎都是 **5–37 秒**、有剪辑、有声音、强动效或强排版；
- "长卷横移"本身不是坏主意——用真实照片、2.5D 视差、手绘纹理、真实光影都能好看；坏在**用平涂矢量执行它**，还拉到了 66 秒。

### 3.3 制作层的结论

**制作层是"画面为什么丑"的直接原因，也是最容易先修的。** 素材、风格帧、声音、时长/剪辑、盲评，任何一项改掉，观感都会立刻不同。

---

## 4. 为什么"网上仅用提示词"更好？

### 4.1 先分清两种"提示词视频"

#### A. 文生视频模型（Sora 2 / Veo 3 / 可灵 / 即梦）

这是**另一个媒介**：扩散模型在真实视频上训练，天生带镜头、光、材质、运动的先验。提示词只需要给 subject / action / camera / lighting / style，模型自己补全电影感。

- Sora 2 官方指南："Think of prompting like **briefing a cinematographer who has never seen your storyboard**." 它建议写清 camera framing、depth of field、action beats、lighting、palette；并且强调迭代："same shot, switch to 85mm"、"pin it as a reference"。
- Veo 官方指南把提示词拆成 subject / action / style / camera / composition / lighting / negative prompt，并明确"**Specificity helps avoid generic outputs**"。

**拿"文生视频的 5–20 秒电影感片段"对比"代码渲染的 66 秒叙事片"，不是同一个赛道。** 这不是工作流输给了提示词，是代码渲染输给了视频生成模型。

#### B. Claude Code / Codex + Remotion 的"提示词视频"

这是和你同一个媒介，更值得对照。Remotion 官方现在就是这么推荐的：

- "**You can create videos just from prompting.**"（`/docs/ai/coding-agents`）
- 官方 Prompt Showcase 里有大量社区作品（`/prompts/`）；
- 官方 prompt-to-video 模板："turns prompts into short videos with a **script, images and voiceover**. Uses OpenAI and ElevenLabs to generate the content."——连 Remotion 自己的 prompt-to-video 都不是纯代码画，而是**脚本 + 图片 + 配音**；
- 官方的 prompt-to-motion-graphics 才是"生成 Remotion 代码做动效"。

看三个具体 prompt，共性非常清楚：

| 案例 | prompt 里已经决定的事 | 题材 |
|---|---|---|
| **Cinematic Tech Intro** | 字体 Knewave、NVIDIA 绿 `#76B900`、frame 40、3x→1x pop-in、Glassmorphism HUD、扫描线、cutout 图片 | 15–25s 科技动效 |
| **News headline highlight** | 上传截图、tesseract OCR、5s、subtle zoom、rough.js 高亮 | 静态图 + 动效 |
| **Launch video on X** | 1080×700、30fps、~37s、`#0c0a09`/`#fbbf24`、BGM、8 个 scene 每 scene 帧数 | 产品发布动效 |

它们的共同点：

1. **prompt 本身就是导演阐述/美术指导**，不是"做个咖啡店视频"；
2. **题材在媒介能力圈内**（动效、文字、UI、地图、截图）；
3. **用了真实/生成素材**（截图、cutout 图、上传视频）；
4. **短、有剪辑、有声音**；
5. **作者在 prompt 里已经把"导演"的活干完了**，模型只需要执行。

### 4.2 真正的差异：不是"提示词 vs 工作流"，是"上下文 + 参考 + 素材 + 声音 + 迭代"

| 机制 | 网络提示词路径 | workflow-v4 这次 |
|---|---|---|
| 美术指导 | 写在 prompt 里，具体到字体/色值/帧数 | 被压成 brief 字段，且由转译层代选 |
| 视觉参考 | 上传图 / 参考片 / cutout 素材 | 只有一行文字（Hopper），没有图 |
| 素材 | 真实截图 / 生成图 / 视频 | 纯 SVG 手绘 |
| 声音 | BGM / 音效 / 配音 | 静音 |
| 迭代 | render → 看 → 改（截图/vision） | 填字段 → 过门 → 交片 |
| 样本 | showcase 精选 | 一次测试的平均产出 |

Anthropic 的两篇文章正好解释了这个差异：

- **Context engineering**：上下文是有限资源，要做的是"找到最小的高信号 token 集合"；不是把所有东西预先压缩成一份大 brief。你们的 brief 本质是"预先把上下文压缩了一遍"，原诗的语感、节奏、意象在压缩中丢了。
- **Building effective agents**：workflow 是"用预定义代码路径编排 LLM 和工具"，agent 是"LLM 自己动态决定过程"；建议"**先找最简单的方案，只在需要时增加复杂度**"；框架/抽象层"会遮蔽底层 prompt 和响应，让人忍不住加复杂度"。
- **Lost in the Middle / Context Rot**：长上下文中段的信息会被模型忽略，token 越多召回越不可靠。brief 越长、门越多，模型越容易"为了过门凑字段"，而不是"为了好看做画面"。

### 4.3 一句话

网络提示词路径不是"少做事"，而是"**把事做在对的地方**"：让模型直接看参考、直接写、直接看渲染结果再改。
你的 workflow 把这条闭环拆成了两段文件和一堆门，**信息在交接处损耗，质量在门上失真**。

---

## 5. 归因：到底是谁的问题？

| 层 | 做对 | 做错 | 责任 |
|---|---|---|---|
| **转译层** | 内容/节拍/字幕/tone/acceptance 准确 | 越权定视觉机制、无风格帧、procedural 锁死、acceptance 逼写实、静音、schema 体裁错配 | **根因（定天花板）** |
| **制作层** | 完成度、结构、时长、交付都做到了 | 纯代码画写实、无素材、无 look-dev、无声音、一镜到底、自评 QA | **直接原因（定地板）** |
| **流程/门** | 字段校验很完整，能挡假交付 | 只查结构不查质量；只查快照不查顺序；过程门形同虚设 | **放大器** |
| **外部** | — | 一次测试、90 分钟时间盒、模型默认画扁平 SVG 的倾向 | **噪声** |

**"转译层定天花板，制作层定地板。"** 这次两个都低。但如果只能先改一个，改制作层（素材/风格帧/声音/盲评/时长），因为它是直接死因，且一轮就能看到差别。

---

## 6. 怎么改（按优先级）

### 6.1 立刻能救画面（制作层）

1. **先定"像什么"，再写代码**：3 张风格帧（AI 生图 / 参考片截帧 / 真实照片拼贴），选 1 张；没有风格帧不许写 scene。
2. **素材策略前置**：列出"必须真实/生成的素材"（背景、道具、手、光、纹理），代码只做运动/合成/字幕；**禁止用 SVG 画写实物体**。
3. **加声音**：环境音/拟音/极简音乐；静音片在短视频语境天然吃亏。
4. **缩短 + 剪辑**：先做 15–25s、3–6 个镜头；不要一上来 66s 一镜。长片可以后扩。
5. **盲评**：独立 reviewer 或用户盲选 A/B；QA 不能自评"成立"。
6. **用库**：选 2–3 个模板做骨架（text/transition/grain），不要从零画 1779 行。
7. **参考对比**：参考帧和自帧并排，量密度/对比/色温/元素数（token-film 的"英雄帧四问"）。

### 6.2 转译层

1. **无参考图 → 强制 `needs_decision`**；必须 2 张真实风格帧（图，不是文字，不是制作层 later 渲的帧）。
2. **`selectedOption` 必须由用户选**（或明确记录用户委托）；translator 不得自己选；gate 增加 `selectedBy` 校验。
3. **删掉 translator 的 mechanism / palette / antiPatterns 决策权**，或降级为"候选/建议"，不作为 `ready` 条件。
4. **brief 里保留原诗/原话/语气样本**（tone pack），或允许 builder 读一段原始输入；不要把情绪压成 acceptance。
5. **acceptance 写观感目标**（"Hopper 式单侧硬光、高对比、大面积阴影"），不要写"画面里必须有 X"。
6. **分体裁 schema**：narrative/poem vs explainer；不要用 facts/milestones/metrics 套诗。
7. **`production` 字段强制选择** procedural / asset-based / hybrid，并写"素材预算"。

### 6.3 门与流程

1. **过程门**：styleframe 必须早于 scene 文件；animatic 必须早于 build；probe 必须早于 scene；用 git commit/时间戳/哈希审计，而不是最终 JSON 快照。
2. **质量门**：加数值指标（帧差/死帧/对比/色温/元素密度/真实素材占比）+ 盲评分数；不只查字段。
3. **砍 schema**：869 行 → 4 块（事实/约束/参考/验收）；brief 不是分镜。
4. **简化流程**：先试"单 agent + skills + 好 prompt + 参考图 + 截图迭代"；只有确实需要时才加流水线。
5. **控制实验**：同输入、同模型，A 组 prompt-only，B 组 workflow，盲评；不要用一次测试下结论。

### 6.4 产品层（FengMotion）

1. **分轨**：动效/数据/UI/文字（Remotion 强项）vs 写实叙事（用生成素材/视频，Remotion 只做合成）vs 混合。
2. **用户输入是诗/情绪 → 先给参考图/风格选项**，让用户"指"而不是"说"——这其实正是你们 `DESIGN-v0.1.md` 的核心命题（"认出来比说出来容易"）。
3. **把"猜"做成产品能力**：先渲 3 个 3–5s look test，让用户选；不要一上来做 66s。
4. **知识层记录"为什么选"**，不要只存 brief；真正的差异是判断力，不是字段。

---

## 7. 下一次测试建议（1 天）

同一首六行诗，做 3 组：

| 组 | 做法 |
|---|---|
| **A. prompt-only** | Claude Code + Remotion Skills + 一张参考图 + 15s + 声音；prompt 里写清镜头/光/色/字体/节奏 |
| **B. workflow-v4 原样** | 不改，复现这次结果 |
| **C. workflow-v4 + 视觉闭环** | 风格帧 + 素材策略 + 声音 + 盲评 + 15s 先导片 |

指标：盲评 1–5；完成时间；返工次数；帧差/死帧/真实素材占比；用户 1× 看完意愿。

预测：A ≈ C > B。

- 如果 C 仍不如 A → 流程本身该砍；
- 如果 C > A → 流程有价值，只是缺视觉闭环。

---

## 8. 资料

**Remotion / 代码视频**

- Remotion 首页："Make videos programmatically. Create videos and motion graphics with React." — https://www.remotion.dev/
- Remotion Coding Agents："You can create videos just from prompting." — https://www.remotion.dev/docs/ai/coding-agents
- Remotion Agent Skills — https://www.remotion.dev/docs/ai/skills
- Remotion Prompt Showcase — https://www.remotion.dev/prompts/
- Cinematic Tech Intro prompt — https://www.remotion.dev/prompts/cinematic-tech-intro
- News headline highlight prompt — https://www.remotion.dev/prompts/news-article-headline-highlight
- Launch video on X prompt — https://www.remotion.dev/prompts/launch-video-on-x
- Remotion Prompt-to-Video 模板（script + images + voiceover）— https://www.remotion.dev/templates/prompt-to-video
- Remotion Prompt-to-Motion-Graphics 模板 — https://www.remotion.dev/templates/prompt-to-motion-graphics

**文生视频**

- OpenAI Cookbook, Sora 2 Prompting Guide — https://cookbook.openai.com/examples/sora/sora2_prompting_guide
- Google Cloud, Veo Video generation prompt guide — https://cloud.google.com/vertex-ai/generative-ai/docs/video/video-gen-prompt-guide

**上下文 / Agent / 评估**

- Anthropic, Effective context engineering for AI agents — https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents
- Anthropic, Building effective agents — https://www.anthropic.com/engineering/building-effective-agents
- Liu et al., Lost in the Middle (TACL 2023) — https://arxiv.org/abs/2307.03172
- Chroma, Context Rot (2025) — https://research.trychroma.com/context-rot
- Zheng et al., Judging LLM-as-a-Judge (NeurIPS 2023) — https://arxiv.org/abs/2306.05685

**本项目内部证据**

- `workflow-v4/README.md:39, :90–92`
- `workflow-v4/production/README.md:149`（"从 d861e1 学到的"）
- `workflow-v4/films/seven-oh-five/brief.ready.json:146–217`
- `workflow-v4/films/seven-oh-five/production.json`（`qa.issues` / `library.decision` / `timing`）
- `AGENTS.md:27, :69–74`
- `~/remotion/_archive/token-film-remotion/remotion/PRODUCTION-LOG.md`（真实素材 / 英雄帧四问）
- `~/remotion/_archive/2026-10-18-城市之夜-v2/片-citynight/05-QA.md`（"AI 无法替人判断好不好看"）

