# 示例夹具（Fixtures）

`workflow-v5/*/examples/seven-oh-five/` 是固定的校验夹具，用于验证 schema、validator 和 blocked 状态。它们包含具体文本、对象和场景，**仅用于测试**。

规则：

- 不把夹具中的题材、对象、视觉方向、叙事结构当作默认模板。
- 通用提示词/模板/QA 规范不得写入夹具专属术语。
- 新项目必须从当前项目的 `prompt.original.md` 开始；多镜头再写 `film-plan.md`。
- 修改 schema/validator 时可以更新夹具；但不要把夹具内容反推到通用规则里。
