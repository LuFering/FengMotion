# workflow-v5 · 阶段计划（执行摘要）

> **默认 Prompt-first；Structured 按需。** v0.5 尚未证明优于高级提示词。
> 完整架构见 `DESIGN.md`，路径见 `PATHS.md`，评估见 `EVALUATION.md`。v3 冻结，不复用其前置门禁；只复用其执行层（scene.spec / 组件合同 / Remotion / 渲染验收）。

| 阶段 | 回答的问题 | 产物 | 门 |
|---|---|---|---|
| 0 意图编译 | 用户想表达什么？ | `intent-brief.json` | 无（权责清楚即可） |
| 1 导演诊断/方向 | 这条片应该如何表达？ | `creative-diagnosis.json`、`creative-directions.json` | 无（先不选） |
| 2 参考分析 | 哪些手法值得借鉴/不能复现？ | `reference-log.json`、`reference-analysis.json`、`reference-decision.json` | **参考门** |
| 3 方向样稿 | 采用哪种视觉语言？ | `direction-gate.json` + `direction-samples/` | **Gate A：方向验证** |
| 4 视觉系统 + 场景 | 规则是什么？每个场景要表达什么？ | `visual-direction.json`、`scene-intents.json`、`scene-layouts/` | **Gate B：场景布局** |
| 5 动画设计 + 10s 证明 | 对象何时发生什么变化？运动成立吗？ | `scene.spec.json`（按需）、组件合同（按需）、`proof-10s.mp4` | **Gate C：运动验收**（production） |
| 6 声音先行 + 制作循环 | 声音/节奏支撑整片吗？ | `animatic-<duration>.mp4`、`passes/` | 内部检查 + 循环 |
| 7 交付 | 成片真的成立吗？ | 成片、QC、版权、盲评 | **Gate D：终审** |

## 硬规则

- 参考只证明手法；视觉语言由方向层决定；参考不能整体升级为整片要求。
- `reference-free` 允许无 refs/cards，但必须有真实检索记录（query/outcome/why）和设计假设。
- Gate A 回答“视觉语言成立吗”，Gate B 回答“场景布局成立吗”；不能互相替代。
- 确认必须绑定 `artifactId + version`，写 `validFor` / `notApproved`；推荐 ≠ 确认。
- 方向未确认不进视觉系统；布局未确认不写组件；未确认的确认记录不能当成最终批准。
- Prompt-first / sketch 可以直接写 Remotion 并渲染；Structured 的 production 才要求 `scene.spec`/组件合同完整。不能用未完成规格阻止 sketch/prototype。
- 质量只由看片决定；机器只做 lint（文件、字段、引用、版本、批准范围）。

## 当前实现

- 默认：`prompt-first/` 已实现原始提示词/纠正/决定持久化与创作闭环入口。
- v0.5.1：Prompt-first 增加 `film-plan.md` 全片编排（节奏弧/关键事件/连续性/转场/结尾）与 6–10 秒连续片段 proof。
- v0.5.2：拆分 Event/Shot/Scene/Caption；新增 `shot-plan.json` 与结构校验；全片低保真 animatic 前移；执行层继承 `stateIn`；QA 增加逐切点 `cut-evidence`。
- v0.5.3：`animatic-review.json` 绑定 shotPlanHash、完整播放、无字幕测试和返工状态；shot-plan 增加 stateOut→stateIn 一致性检查与显式 stateChanges；init 检查 animatic review；QA 增加无字幕叙事测试；cut-evidence 增加 freeze/black 定位报告。
- v0.5.5：重新审视默认 Prompt-first，删掉默认流程里的 shot-plan/animatic-review/静帧/proof 审批层；lookdev 改为视觉转译工作稿，quality-bar 改为看片问题，film-plan 缩成一页导演处理；init 只检查原始提示词/项目文件；高级结构工具保留给复杂/Structured 项目。
- v0.5.6：补“从风格到动作”的转译深度；film-plan 增加关键动作/时间/镜头/光材质响应/交接；creator 增加最难动作 3–5 秒局部预览与连续看片；lookdev 增加动作/媒介适配；不新增文件或校验门。
- v0.5.7：补“从视觉命题到注意力”的转译深度；lookdev 增加核心视觉事件/注意力路径；film-plan 增加镜头注意力/镜头对比/视觉高潮/余像；quality-bar 增加视觉事件/动作表现力/动态审片方式；并补“输入事件覆盖”，防止视觉重点吃掉原文/用户要求的事件；不新增文件或校验门。
- v0.5.8：补“可见变化/媒介能力试片/镜头级定向返工”；film-plan 动作表增加可见变化列；lookdev 增加 3–5 秒媒介试片；quality-bar 增加本轮证据记录与重渲范围；不新增文件或校验门。
- v0.5.9：把主路径改为“先编码、再渲染验证”；lookdev 增加 design tokens/视觉原语/可计算不变量；film-plan 增加 frame score 帧级时间编码；quality-bar 默认只做 3–6 张边界帧验证，不做大批量抽帧；新增可复制代码骨架 `templates/visual-encoding.ts`（非运行时依赖、非校验门）。
- v0.5.10：补“视觉机制/镜头行为/假设驱动验证/成片优先”；lookdev 增加贯穿全片的视觉机制；film-plan 增加镜头行为与 BPM→帧换算；quality-bar 改为先写 2–4 个视觉假设再选帧；creator 明确文档适可而止、复杂片 2–3 轮整片渲染；不新增文件或校验门。
- v0.5.11：一次性压缩中间文档；方向明确时只做 1 个主方向；film-plan 删除完整注意力/转场表，改为镜头差异四问；creator/quality 增加 Finishing Pass（镜头差异/视觉密度/时间表现/节奏收束）；复杂片按 2–3 轮整片渲染执行；不新增文件或校验门。
- v0.5.12：接入外部 capability registry（lemo-opuscar / video-shotcraft / remotion-scenes）；只在 lookdev/film-plan/实现/Finishing 做可选检索，不把全库塞进工作流；RVE/ui2v 不接入。
- v0.5.13：film-plan 增加场景类型/视觉权重/时间分配（BPM 只定切点，不决定等长）；Finishing Pass 改为观众优先排序，一个质量瓶颈可含多个协同修改；要求首版/最终版完整播放或明确替代审片；不新增文件或校验门。
- v0.5.14：补镜头设计层；film-plan 增加场景叙事证据、景别/视点/空间层次/运动目的、镜头衔接（形状/动作/视线/尺度/光位/声音）；creator 明确整体→场景→镜头→帧；quality 增加镜头设计检查和外部 critic；不新增文件或校验门。
- v0.5.14.1 补丁：补内容契约、镜头落地追踪、观众理解测试；EVALUATION 增加内容理解/镜头落地维度；不新增文件或校验门。
- v0.5.14.2：补“镜头之间的关系”；film-plan 增加叙事阶段/理解链、视觉语义、整片镜头差异预算；落地追踪拆为叙事/镜头/运动/衔接四项；quality 增加理解测试→返工决策；不新增文件或校验门。
- 0–2：`intent/`、`director/`、`reference/` 已实现；导演/动画校验器支持 creative/strict profile。
- Gate A/B：`gates/` 已实现（当前示例未确认：Gate A recommended 且缺 Look-dev，Gate B 0/6 当前版本 approved）。
- 5 动画设计：`animation/` 已实现蓝图/实现计划/草稿规格/四道门校验；当前 6 场均为 draft，组件/资产 candidate，Gate 3/4 blocked。
- 6 执行与验收：`execution/` 已实现 sketch/prototype/production、build manifest/buildHash 重算、输出 SHA-256、审片覆盖与人工/自动分离；当前 production preflight blocked（11 项前置未满足），没有伪造成片/审片。
- 10s 证明/声音/制作：待组件与资产可用后执行。
- 已用真实 Remotion sketch 渲染（4s/120f/1920×1080）验证 buildHash + 输出 SHA-256；重复渲染字节一致。
