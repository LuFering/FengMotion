# 阶段 5 · 动画设计层（v5）

> 先设计动画，再把动画编译成场景规格。
> 不要一边想动画、一边猜组件接口、一边写 Remotion 代码。

## 两种表示

| 表示 | 回答的问题 | 产物 | 状态 |
|---|---|---|---|
| **动画蓝图** | 发生什么、为什么动、怎样变化、节奏如何组织 | `animation-blueprint.json` | 创作设计，不依赖已有组件 |
| **执行规格** | 用哪个组件、什么参数、哪些帧、如何验收 | `implementation-plan.json` + `scene.spec.json` + 组件合同 | 蓝图通过后才编译 |

蓝图可以在没有 fps、没有组件的情况下完成；`scene.spec.json` 必须符合 Remotion 执行约定。
时间换算只做一次：蓝图用候选秒数/相对关系，执行规格才换算成整数帧。

## 六个步骤

1. **场景与事件编排**：把文本与导演意图组织成可辨认事件；一个文本单元可跨场景，多个单元可在一场表达。
2. **动作与状态设计**：主体、初始状态、触发、变化过程、结束状态、依赖、失败条件。
3. **节奏与时间设计**：事件时长、可见时长、停留时长；候选秒数，不锁 fps。
4. **实现策略与组件规划**：检索已有资产/组件；区分 `available / candidate / missing`。
5. **场景规格与组件合同**：蓝图通过后，映射组件、props、整数帧、motionPlan、验收帧。
6. **设计验收与交接**：四道门；未通过不得进入执行层。

## 执行规格（与 v3 对齐）

- `schemaVersion: 1`（数字，与 v3 一致）；`width` / `height` 必填。
- `captionTrack`：每条字幕引用 `sourceUnitId`，逐字 `text`、`sceneId`、`from` / `durationInFrames` / `readingTimeSec`；六行原文必须全覆盖。
- `motionPlan`：`target` / `from`（状态） / `to`（状态） / `start` / `end`（帧） / `easing` / `dependsOn`；`target` 必须在 `layers` 里，`start/end` 必须在 `eventFrames` 内。
- `assetStrategy` 使用 v3 枚举：`procedural` / `svg-asset` / `generated-image` / `video-footage` / `3d-scene`。
- 场景必须从 0 连续覆盖到 `durationInFrames`，不能留空白帧。

## 场景设计卡（蓝图里的每一场）

- `intent`：这一场为什么存在；
- `event`：发生了什么真实变化（初始/触发/进程/结束/失败条件）；
- `motionIntent`：运动目的、优先级、候选机制（不锁实现）；
- `timing`：相对顺序、场景时长、事件时长、停留时长（候选）；
- `layers` / `dependencies` / `assetRequirements`；
- `acceptance`：可观察的成功条件，不能写“高级感/沉浸感”。

## 四道门

| 门 | 检查 | 校验 |
|---|---|---|
| 1 创意完整性 | 每场有目的、事件、原文来源；没有纯装饰场景 | `validate-animation.mjs` |
| 2 运动完整性 | 初始/触发/进程/结束/依赖/失败条件；复杂运动有 motionPlan | 同上 |
| 3 实现可行性 | 组件/资产状态真实；candidate 不能当 available；帧参数可映射 | 同上 |
| 4 交接验收 | 蓝图/实现/规格/审查一致；未确认不得进执行层 | 同上 |

## 关键规则

- 运动机制由事件决定，不设“每场必须几种动画”的配额；静止/阅读场景用 `staticIntent: true` 显式声明，允许状态不变、motionPlan 为空。
- 动态事件才要求 progression 2–4 阶段、初始≠结束、候选机制；静态场景不受这些硬规则约束。
- 顺序剪辑可用 `timingPolicy.overlapPolicy: "sequential"` 校验时长合计；有重叠/并行时声明 `overlapping`。
- `scene.spec.timelinePolicy: "contiguous" | "explicit"`：explicit 允许场景重叠/空档；每个场景仍必须在总时长内。
- 每场可用 `eventFrames` 或 `eventWindows[]` 表达多个运动窗口；静态场景可省略 event/motion/motionCheckFrames。
- `assetStrategy` 支持字符串或数组（混合素材/程序化组合）。
- `textPolicy.verbatimRequired: false` 时不再强制字幕逐字匹配；`captionTrack` 允许重复 `sourceUnitId`（分段/重复排版）。
- `candidate` / `missing` 不是可用资产；不能为了过规格假装组件已存在。
- 组件合同定义接口、运动状态、验收，不是提前写实现代码。
- `acceptanceFrames` 可以落在场景保持段；`motionCheckFrames` 必须在 `eventFrames` 内。
- `heroFrame` 验证整体构图，可位于保持阶段；复杂运动另附“变化前—变化中—变化后”状态序列。
- 不把“规格写完”当成“动画完成”。

## 文件

```
workflow-v5/animation/
├── README.md
├── prompts/
│   ├── animation-director.md      # 蓝图
│   ├── technical-planner.md       # 实现计划 + scene.spec + 合同
│   └── design-reviewer.md         # 四道门
├── tools/validate-animation.mjs
└── examples/seven-oh-five/
    ├── animation-blueprint.json   # 场景数/候选时长按项目实际，fps=null
    ├── implementation-plan.json   # 组件/资产均为 candidate
    ├── scene.spec.draft.json      # 900 帧草稿
    ├── component-contracts.md     # 6 个组件合同（draft）
    └── design-review.json         # Gate1/2 pass；Gate3/4 blocked
```

## 校验

```bash
cd workflow-v5/animation
# 默认 creative：场景数/阶段数等只 warning；strict 才失败
node tools/validate-animation.mjs examples/seven-oh-five --profile=creative
node tools/validate-animation.mjs examples/seven-oh-five
```

会拦：

- 场景缺 intent/event/source；
- 初始状态 = 结束状态（没有变化）；
- acceptance 写“高级感/沉浸感”等不可验证词；
- 蓝图里出现组件名、帧数、`durationInFrames`、`fps` 等执行字段；
- 场景时长合计与候选总时长不一致；
- 依赖指向不存在场景；
- 组件/资产状态不明，或 candidate 当 available；
- `scene.spec` 组件不在实现计划、帧窗口越界、复杂运动缺 motionPlan；
- 实现未通过却把 scene.spec 标 approved；
- design-review 状态与四道门不一致。

## 示例状态

示例项目当前是 **draft / blocked**：

- 蓝图场景数与候选时长按项目实际，`fps: null`；
- 组件与资产全部 `candidate`，尚未开发/验证；
- `scene.spec.draft.json` 只是编译草稿（900 帧），不是可执行交付；
- `design-review.json`：创意/运动 pass，实现可行性/交接 blocked；
- Gate A 方向也尚未确认，所以不能进入执行层。
