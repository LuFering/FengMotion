# Prompt-first（默认创作路径）

> 用完整的高级提示词、参考和素材直接创作 Remotion，不需要先填完所有结构化文件。
> v5 的意图/导演/动画/门禁/执行产物是**可选的后台记录**，不是创作前提。
> 只有在多场景协作、客户交付、严格复现、素材/授权风险高时，才升级到 Structured 路径（见 `../PATHS.md`）。

## 项目目录

```text
<project-dir>/
  prompt.original.md     # 用户原始输入，逐字保存，不摘要、不改写
  corrections.md         # 用户后续纠正，追加，不覆盖原文
  decisions.md           # 影响创意/构建/素材/验收的关键决定，可 supersede
  references/            # 参考图/视频/链接清单
  qa/
    passes/NN/           # 每轮渲染：视频、抽帧、观察记录
  project.json           # filmId、创建时间、模式
```

实际 Remotion 工程可以在任意目录；这里只规定**创作上下文**的存放方式，不强制新的渲染后端。

## 开始

```bash
cd workflow-v5/prompt-first
node tools/init-project.mjs <project-dir> --film-id <id> --prompt-file <原始提示词.md>
```

- `prompt.original.md` 逐字复制，不做摘要；已存在时默认不覆盖。
- 之后把用户纠正追加到 `corrections.md`，关键决定写入 `decisions.md`。
- 不需要先创建 `intent-brief.json`、方向、Gate、蓝图或 `scene.spec`；按任务复杂度按需使用。

## 上下文优先级

1. 用户最新明确纠正/新要求。
2. 用户明确标记的硬要求（原文/参考/必须保留内容）。
3. 用户已确认的决定。
4. 当前有效的模型决定（`decisions.md` 中 `active`）。
5. 模型推断与临时假设。

原文不能被摘要替代。上下文变长时，完整原文留在项目文件中，创作阶段注入相关原句、纠正、硬约束与最近决定。

## 创作闭环

```text
原文/参考/素材
  → 主创模型整体构思，确定实现方法
  → 先做最关键或最危险的画面/片段（sketch）
  → 编写/修改 Remotion
  → 渲染真实视频/片段
  → 看连续画面 + 关键帧 + 节奏/声音
  → 记录具体问题与证据
  → 修改导演决定/spec/组件/素材
  ↺ 重渲，直到问题解决或预算用尽
  → 技术 QA + 视觉审片
```

- `sketch` / `prototype` 允许在正式门禁前渲染，但必须标记为非交付；不能伪装成最终素材/授权/成片。
- 预览、proof、正式渲染必须能追溯到同一份代码/配置/素材；使用 `buildHash`/`renderHash` 时不得伪造。
- 技术 QA 与视觉审片分开：技术通过不等于好看，视觉好评不能覆盖技术失败。

## 什么时候升级 Structured

- 多人/多 agent 并行，需要稳定接口。
- 客户/品牌/法律要求，需要显式审批与追溯。
- 长片、多场景、复杂素材合成，前期规划能显著降低返工。
- 高风险素材、真实人物、写实合成、授权/外部依赖。
- 需要复现、回滚、审计。

升级不是默认；阈值只是建议，最终由任务判断/用户选择。

## 文件

```
workflow-v5/prompt-first/
├── README.md
├── prompts/creator.md
├── templates/{prompt.original.md,corrections.md,decisions.md}
├── tools/init-project.mjs
└── examples/
```
