# workflow-v5 · 从创作意图到执行验收

> **v0.5 尚未证明优于高级提示词。** 默认 Prompt-first；Structured 只在复杂任务按需启用。
> 路径与硬/软约束见 `PATHS.md`；对照实验见 `EVALUATION.md`。

> 版本号说明：自本次更新起使用 v0.5.x 体系（原 v5.x 迁移）；例如 v0.5.14.2 = 原 v5.14.2。
>
> v3 冻结；v0.5 是并行新管线（目录仍为 workflow-v5）。v0.5.14.2 默认 Prompt-first 以内容契约、叙事阶段/理解链、视觉语义、整片镜头差异预算、镜头落地四项、观众理解→返工为主，不强制逐层审批；
> Structured 路径才保留状态、来源、确认范围和追溯。

## 入口

- **默认：`prompt-first/`** —— 直接读原始提示词/参考/素材创作、渲染、看片、修改，不强制先生成所有中间 JSON。
- **按需：Structured** —— 复杂/多人/客户/需复现时再启用下面这些层。

## 层级（复杂/Structured 按需）

| 层 | 回答的问题 | 目录 |
|---|---|---|
| 0 意图编译 | 用户想表达什么？ | `intent/` |
| 1 导演与视觉方向 | 这条片应该如何表达？ | `director/` |
| 2 参考分析 | 哪些手法值得借鉴/不能复现？ | `reference/` |
| Gate A/B | 方向是否成立、场景布局是否成立？ | `gates/` |
| 动画设计 | 发生什么变化、如何编译成执行规格？ | `animation/` |
| 执行与验收 | 能否正确生成、是否值得看？ | `execution/` |

Prompt-first 默认不要求这些层全部启用；需要多人协作、追溯或复现时再用。完整架构见 `DESIGN.md`，阶段摘要见 `PLAN.md`。

## 校验

```bash
node intent/tools/validate-intent.mjs intent/examples/seven-oh-five/intent-brief.json
node director/tools/validate.mjs director/examples/seven-oh-five --profile=creative
node reference/tools/validate-reference.mjs reference/examples/seven-oh-five
node gates/tools/validate-gates.mjs gates/examples/seven-oh-five
node animation/tools/validate-animation.mjs animation/examples/seven-oh-five --profile=creative
node execution/tools/build-manifest.mjs execution/examples/seven-oh-five/execution.config.json --out qa/build-manifest.json
node execution/tools/preflight.mjs execution/examples/seven-oh-five/execution.config.json --out qa/preflight-report.json
node execution/tools/validate-execution.mjs execution/examples/seven-oh-five
```

> `*/examples/` 与旧片示例仅用于校验门禁和演示，不是默认题材、默认视觉模板或默认叙事结构；Prompt-first 创作必须从当前项目的 `prompt.original.md` 开始。夹具隔离规则见 [FIXTURES.md](FIXTURES.md)。

## 当前状态

- 示例项目停在未确认/阻塞状态：Gate A recommended 且缺 Look-dev、Gate B 0/6、
  动画蓝图 draft、组件/资产 candidate、preflight blocked。
- 没有伪造成片、审片或用户确认；这是有意的门禁状态。
- v3 不修改；v5 复用 v3 的执行层思路（scene.spec / 组件合同 / Remotion / 渲染验收），
  但重写前置门禁与确认机制。
