# 阶段 0 · 创作意图编译器（v5）

> 这一层不是“自然语言转视频提示词”，也不是内容 brief 生成器。
> 它是一个**创作意图编译器**：把用户输入变成 `intent-brief.json`，
> 让下游各阶段从同一份数据里各取所需，而不是反复读同一段大提示词、各自猜职责。

## 为什么不是“专业提示词”

两种常见失败：

- **空洞翻译**：把原文压成“清晨、安静、温暖、电影感”，丢掉“卷帘门只拉起一半 / 光先出现”的关系。
- **提前定死**：直接写“2.39:1、35mm、木质极简、黑围裙男咖啡师、缓慢推轨”，看起来专业，但大多没有来源依据，提前扼杀设计空间。

创作意图编译器要同时避免这两端：**意图清楚，但不替导演决定怎么拍；线索具体，但不是空洞形容词。**

## 五类信息分开

| 类别 | 含义 | 数据位置 |
|---|---|---|
| SOURCE_FACT | 原文/素材明确提供的内容 | `sources` + `content.units` |
| USER_CONSTRAINT | 用户明确要求保留/禁止 | `request.constraints`、`content.invariants`（locked） |
| INTERPRETATION | 推导出的意图/情绪/体验 | `content.interpretations`（inferred + evidence + confidence） |
| CREATIVE_CUE | 启发视觉设计、但不约束实现 | `content.creativeCues`（binding: false） |
| UNRESOLVED_DECISION | 未决定、交给指定下游阶段 | `productionDecisions`（unresolved/not-provided + decisionOwner） |

## 决策状态

每个重要制作项都带 `status` 与 `decisionOwner`：

- `locked`：已确定，不可随意改；必须带 `value` + `sourceRef`。
- `inferred`：从内容推断，可审查；带 `value` + `rationale`。
- `proposed`：模型提出的候选，可改；带 `value` + `rationale`。
- `unresolved`：尚未决定；**不能带 value**，写 `decisionOwner`。
- `not-provided`：用户没提供；**不能带 value**，写 `decisionOwner`。

`decisionOwner` 说明“该由谁决定”，例如 `creative-direction`、`sound-design`、`execution`、`reference-analysis`。
这样后续模型不会把 30s / 2.39:1 / 30fps 这类暂定值当成既成事实。

## 文件

```
workflow-v5/intent/
├── README.md
├── prompts/compiler.md              # 编译器系统提示词
├── schema/intent-brief.schema.json  # 数据契约
├── tools/validate-intent.mjs        # 无依赖校验器
└── examples/seven-oh-five/
    ├── input.md                     # 六行诗 + 用户说明
    └── intent-brief.json            # 合格产物
```

## 内容单元（units）

- 原文先按**独立单元**保留，不要提前合并。
- 每个 unit：`id/order/text/event/relations/sourceRef`。
- `event` 是“发生了什么”；`relations` 是文本内部关系（先后、因果、对比、变化）。
- 两行可以共享一个场景，但先保留为两个 unit；后续场景设计用 `sourceUnitIds` 组合。
- 故事时间（“七点零五分”）不是播放时间；需要 `interpretive-guardrail` invariant 防止误读。

## 创作线索（creativeCues）

- 写“值得视觉化的关系/变化”，例如“光先出现、声音打破安静、颜色逐渐变深、两种颜色交汇形成形态”。
- 不写“必须用 SVG 路径动画 / 3D 流体 / 某种镜头”。
- 每条 `binding: false`，否则它会在下游变成硬约束。

## 校验

```bash
cd workflow-v5/intent
node tools/validate-intent.mjs examples/seven-oh-five/intent-brief.json
```

校验器会拦：

- 任何层级的视觉/制作越权字段（`visual`、`mechanism`、`palette`、`typography`、`production`、`shotPlan`、`camera`、`lighting`、`procedural`、`acceptance` 等）；
- `verbatim` 源里 unit 文本不是逐字（读源文件核对）；
- 推断缺 `evidence`/`confidence`，或 evidence 指向不存在的 unit/source；
- `creativeCues[].binding` 不是 `false`；
- `unresolved/not-provided` 带了 `value`（把未决伪装成已决）；
- `locked` 缺 `value`/`sourceRef`；
- 含“几点”类故事时间却没有 guardrail invariant；
- 占位符 / TODO / 待定。

## 测试记录（2026-10-19）

- 合格示例：`examples/seven-oh-five/intent-brief.json` → 通过。
- 反例：未决 `durationSec` 带 value、推断无 evidence、`binding: true`、unit 文本改写、locked 缺 sourceRef、含故事时间但无 guardrail、`visual/palette` 越权字段 → 均被拒绝。
- 编译器 prompt 端到端测试（fresh-context 子代理，只读 prompt/schema/input）：
  生成 6 个逐字 unit、5 条带 evidence 的推断、5 条 binding:false 线索、7 项未决决策（全部不带 value），
  校验通过；没有写入镜头/色板/机制/procedural/时长画幅等越权内容。
  测试输出仅在 /tmp，仓库未新增生成文件。

## 交给下游

- `handoff.nextStage` 当前为 `creative-direction`。
- 下游（导演/视觉方向层）应基于：
  - `content.units` 的原文与关系；
  - `content.invariants` 的 locked/guardrail；
  - `content.interpretations` 的推断（不是事实）；
  - `content.creativeCues` 的线索（不是指令）；
  - `productionDecisions` 的未决项（由自己提出方案，不要当成已定）；
  产出 2–3 个实质不同的视觉方向，而不是继续“完善提示词”。

对应 workflow-v3 的衔接：

```
输入解析 → 创作意图编译器（intent-brief.json）
        → 导演与视觉方向层（2–3 个方向）
        → 参考分析与关键画面确认
        → 动画设计层（scene.spec.json）
        → Remotion 执行与渲染验收
```
