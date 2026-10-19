# 阶段 1 · 导演与视觉方向层（v5）

> 这一层不是“把创作意图扩写成更长提示词”，而是一个独立的创意决策系统：
> 先诊断，再探索真正不同的方向，比较/推荐，选定后建立视觉系统，最后用关键画面验证再交接。

## 职责边界

| 层 | 核心问题 | 产物 | 不该做什么 |
|---|---|---|---|
| 0 创作意图编译器 | 用户想表达什么？ | `intent-brief.json` | 不决定怎么拍 |
| 1 导演与视觉方向层 | 这条片应该如何表达？ | diagnosis / directions / decision / visual-direction / hero-frame | 不写场景规格、组件、帧数、坐标 |
| 2 动画设计层 | 哪些对象何时发生什么变化，怎么实现？ | `scene.spec.json` + 组件合同 | 不重新定义视觉方向 |
| 3 Remotion 执行层 | 设计是否被正确实现？ | 组件、预览、验收 | 不擅自改叙事/视觉设定 |

导演层可以决定“用一个连续空间讲故事”，但不规定每个物件坐标、运动帧数和组件接口。
视觉方向层可以规定“文字参与视觉叙事，而不是只贴字幕”，但不规定逐字弹入的缓动曲线。

## 五步与产物

| STEP | 做什么 | 产物 | 门 |
|---|---|---|---|
| 1 创作诊断 | 核心表达、观众体验、注意力层级、叙事机制、创作难题 | `creative-diagnosis.json` | 无（判断要可追溯） |
| 2 方向探索 | exploration：2–3 个实质不同方向；direct：1 个主方向 + 少量实现比较 | `creative-directions.json` | 无（先不选） |
| 3 比较与选择 | 内容适配/差异/可实现/资产风险/辨识度；推荐 + 替代 | `direction-decision.json` | **推荐 ≠ 确认** |
| 4 视觉系统 | 构图/色彩/字体/材质/层级/运动/转场规则 | `visual-direction.json` | 未确认只能 `proposed` |
| 5 关键画面 | 用一帧验证方向是否成立 | `hero-frame-brief.md` | **通过 + 确认后才进动画设计** |

## 方向差异规则

有效方向必须改变视觉表达逻辑，而不是只换颜色、字体或形容词。

探索模式下比较维度（至少 3 维不同；direct 模式作为评审建议，不是硬门禁）：

1. 表达方法（真实空间/图形隐喻/文字构建/舞台模型…）
2. 空间组织（连续空间/独立画面/排版空间/分层舞台…）
3. 主要视觉对象（人物/动作/空间关系/物质形态/文字…）
4. 运动逻辑（物体运动/形态变化/遮罩/视差/文字构建…）
5. 文字角色（叙事记录者/画面组成部分/视觉主体…）

反例：A“温暖的电影感咖啡片”、B“极简高级感咖啡片”、C“诗意氛围感咖啡片”——它们可能得到同一条片。
校验器只在 `mode: exploration` 时强制方向差异；`mode: direct` 允许 1 个主方向，不强迫凑三套。两种模式都拒绝把时长/画幅/场景规格写进方向层。

## 方向数量模式

- `exploration`（默认）：2–3 个实质不同方向；差异规则用于评审与避免伪差异。
- `direct`：输入/提示词已明确方向时，允许 1 个主方向 + 少量实现比较；不强制多方案。

## 两种运行模式

- `collaborative`：模型给 2–3 个可比较方案，用户选；确认前不能把推荐说成已确认。
- `autopilot`：模型按证据自动选择，记录理由、替代方案和可撤回决定。

`status` 语义：

- `candidate`：候选方向
- `recommended`：有依据的推荐，但未确认
- `confirmed`：用户/自动模式已确认
- `proposed`：视觉系统提案，未确认
- `approved`：方向与关键画面已确认，可交接动画设计

## 参考模式（对齐 workflow-v3）

- `user-reference`：用户给了参考 → 先分析参考，再形成方向。
- `library-reference`：用户没给 → 从项目参考片/镜头卡/组件库检索。
- `exploratory`：没有合适参考 → 先提出有依据的方向，选定后再决定是否补参考。
- `reference-free`：明确记录无参考，不虚构参考。

这替代了“没有参考就先问用户情绪/画布明暗/品牌色”的固定门槛：有足够创作信息时，先给可比较方案；只有缺失会实质改变任务目标时才问用户。

## 文件

```
workflow-v5/director/
├── README.md
├── prompts/director.md
├── tools/validate.mjs
└── examples/seven-oh-five/
    ├── creative-diagnosis.json
    ├── creative-directions.json
    ├── direction-decision.json
    ├── visual-direction.json
    └── hero-frame-brief.md
```

## 校验

```bash
cd workflow-v5/director
node tools/validate.mjs examples/seven-oh-five
```

会拦：

- 方向差异不足（只换颜色/字体/形容词）；
- 方向层写死时长/画幅/fps/场景时间轴/组件合同；
- 推荐方向 strong 维度不足 3 个；
- `recommended` 却写了 `confirmation`，或 `confirmed` 没有确认记录；
- `proposed` 直接 `handoff.nextStage = animation-design`；
- `approved` 但 decision 未 confirmed；
- 视觉系统缺七类规则之一，或 `holdsDuringMotion` 缺失；
- 关键画面文件不存在；
- 内容映射漏掉 intent 的 unit。

## 《七点零五分》示例

| 方向 | 创作方法 | 空间 | 主要对象 | 运动来源 | 文字角色 |
|---|---|---|---|---|---|
| A 清晨的连续空间 | 叙事观察 | 连续店内空间 | 空间里的事件 | 光线/液体/器物/人物 | 逐字字幕，与动作协调 |
| B 文字与物质的诗 | 图形诗影像 | 排版空间 | 文字与形态关系 | 文字构建/遮罩/形态变化 | 文字是视觉主体 |
| C 会呼吸的微型咖啡馆 | 微缩舞台 | 分层舞台空间 | 同一空间的局部变化 | 视差/遮挡/路径运动 | 逐字字幕，舞台旁白 |

`direction-decision.json` 推荐 A，但 `status: recommended`，`confirmation: null`；
`visual-direction.json` 是 A 的提案，`status: proposed`，`handoff.nextStage: hero-frame`。
只有关键画面通过并由用户确认后，才允许改 `approved` 并交接 `animation-design`。

## 测试记录（2026-10-19）

- 示例目录四份产物：`node tools/validate.mjs examples/seven-oh-five` 全部通过。
- 反例测试全部被拒：方向差异不足、方向层写死 `durationSec`、推荐方向 strong 不足 3 个、
  `recommended` 却写 `confirmation`、`confirmed` 无确认记录、`proposed` 直接进 `animation-design`、
  `approved` 但 decision 未 confirmed、视觉系统缺 `transitions`、内容映射漏 L6、诊断漏未决 `audio`、
  `directionId` 与推荐方向不一致。
- 端到端 prompt 测试：fresh-context 子代理只读 `prompts/director.md` + `intent-brief.json`，
  生成 `creative-diagnosis.json` 与 `creative-directions.json`；首次 `comparison` 用了对象而非数组，
  lint 拒绝；已把 `comparison` 的数组形状写进 prompt，修正后两份均通过。
  子代理进程结束前未回报，但产物已由校验器验证（测试文件只在 `/tmp`，仓库未新增生成物）。

> 关键画面确认的正式执行在 `workflow-v5/gates/`：Gate A（方向样稿）与 Gate B（场景布局）。
> `hero-frame-brief.md` 保留为方向验证的说明稿，不替代两道门。

## 下一步

1. 用户看 A/B/C 三方向与推荐理由，选择或要求调整。
2. 对选中方向做关键画面验证（hero frame brief → 实际关键帧）。
3. 关键画面通过并确认后，才进入动画设计层（`scene.spec.json` / 组件合同 / 运动计划）。
