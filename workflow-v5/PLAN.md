# workflow-v5 · 阶段计划（执行摘要）

> **默认 Prompt-first；Structured 按需。** v5 尚未证明优于高级提示词。
> 完整架构见 `DESIGN.md`，路径见 `PATHS.md`，评估见 `EVALUATION.md`。v3 冻结，不复用其前置门禁；只复用其执行层（scene.spec / 组件合同 / Remotion / 渲染验收）。

| 阶段 | 回答的问题 | 产物 | 门 |
|---|---|---|---|
| 0 意图编译 | 用户想表达什么？ | `intent-brief.json` | 无（权责清楚即可） |
| 1 导演诊断/方向 | 这条片应该如何表达？ | `creative-diagnosis.json`、`creative-directions.json` | 无（先不选） |
| 2 参考分析 | 哪些手法值得借鉴/不能复现？ | `reference-log.json`、`reference-analysis.json`、`reference-decision.json` | **参考门** |
| 3 方向样稿 | 采用哪种视觉语言？ | `direction-gate.json` + `direction-samples/` | **Gate A：方向验证** |
| 4 视觉系统 + 场景 | 规则是什么？每个场景要表达什么？ | `visual-direction.json`、`scene-intents.json`、`scene-layouts/` | **Gate B：场景布局** |
| 5 动画设计 + 10s 证明 | 对象何时发生什么变化？运动成立吗？ | `scene.spec.json`、组件合同、`proof-10s.mp4` | **Gate C：运动验收** |
| 6 声音先行 + 制作循环 | 声音/节奏支撑整片吗？ | `animatic-30s.mp4`、`passes/` | 内部检查 + 循环 |
| 7 交付 | 成片真的成立吗？ | 成片、QC、版权、盲评 | **Gate D：终审** |

## 硬规则

- 参考只证明手法；视觉语言由方向层决定；参考不能整体升级为整片要求。
- `reference-free` 允许无 refs/cards，但必须有真实检索记录（query/outcome/why）和设计假设。
- Gate A 回答“视觉语言成立吗”，Gate B 回答“场景布局成立吗”；不能互相替代。
- 确认必须绑定 `artifactId + version`，写 `validFor` / `notApproved`；推荐 ≠ 确认。
- 方向未确认不进视觉系统；布局未确认不写组件；未确认的确认记录不能当成最终批准。
- 没有 `scene.spec` / 组件合同之前，不写 Remotion 组件。
- 质量只由看片决定；机器只做 lint（文件、字段、引用、版本、批准范围）。

## 当前实现

- 0–2：`intent/`、`director/`、`reference/` 已实现。
- Gate A/B：`gates/` 已实现（当前示例未确认：Gate A recommended，Gate B pending）。
- 5 动画设计：`animation/` 已实现蓝图/实现计划/草稿规格/四道门校验；当前 6 场均为 draft，组件/资产 candidate，Gate 3/4 blocked。
- 6 执行与验收：`execution/` 已实现 preflight + 执行链校验；当前 preflight blocked（10 项前置未满足），没有伪造成片/审片。
- 10s 证明/声音/制作：待组件与资产可用后执行。
