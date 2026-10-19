# Prompt-first（默认创作路径）

> 用完整提示词、参考和素材直接创作 Remotion；默认流程不做「先填完整结构化文件再开工」。
> 目标是让模型先看见画面，再写代码；不是让模型通过门禁。
> 只有在多人协作、客户交付、严格复现、素材/授权风险高时，才升级 Structured 路径（见 `../PATHS.md`）。

## 项目目录

```text
<project-dir>/
  prompt.original.md     # 用户原始输入，逐字保存，不摘要、不改写
  corrections.md         # 用户后续纠正，追加，不覆盖原文
  decisions.md           # 关键决定，可 supersede
  lookdev-brief.md       # 视觉转译工作稿：视觉命题/参考/方向/色版/光/材质/镜头/运动
  quality-bar.md         # 看片问题：用来定位「哪里 generic、下一轮改什么」
  film-plan.md           # 多镜头可选：一页导演处理，不是审批表
  references/            # 参考图/视频/链接清单
  qa/
    passes/NN/           # 每轮渲染、抽帧、观察记录
  project.json
```

`shot-plan.json`、`animatic-review.json`、`scene.spec` 等仍可用于复杂/Structured 项目，但**不是默认 Prompt-first 的前置条件**。

## 开始

```bash
cd workflow-v5/prompt-first
node tools/init-project.mjs <project-dir> --film-id <id> --prompt-file <原始提示词.md>
```

- `prompt.original.md` 逐字复制，不做摘要；已存在时默认不覆盖。
- 之后把用户纠正追加到 `corrections.md`，关键决定写入 `decisions.md`。
- 先写 `lookdev-brief.md`：视觉命题、参考、2–3 个方向、色版/光/材质/镜头/运动。
- 做 1–3 张便宜测试帧，并排比较方向；如果还是默认占位符，换方向/媒介。
- 多镜头写 `film-plan.md`（一页导演处理），不需要先写镜头 JSON。
- 没有必须通过的 animatic-review/style-frame 门；测试帧和 animatic 是判断工具，不是审批门。

## 上下文优先级

1. 用户最新明确纠正/新要求。
2. 用户明确标记的硬要求（原文/参考/必须保留内容）。
3. 用户已确认的决定。
4. 当前有效的模型决定（`decisions.md` 中 `active`）。
5. 模型推断与临时假设。

原文不能被摘要替代。上下文变长时，完整原文留在项目文件中，创作阶段注入相关原句、纠正、硬约束与最近决定。

## 创作闭环（画面先行）

```text
原文/参考/素材
  → 读原文，找视觉命题/视觉母题
  → lookdev：参考 + 2–3 个方向 + 1–3 张测试帧
  → 选定方向；如果测试帧仍像占位符，换方向/媒介
  → 多镜头：film-plan（一页导演处理；可选 shot list）
  → 实现视觉系统 → 粗剪/animatic → 完整画面
  → 看连续画面 → 对照参考定位最大问题 → 只改一个 → 再看
  → 技术 QA + 视觉判断（不是通过/失败门禁）
```

### 视觉转译（这是重点）

模型默认会写「暗背景 + 渐变光 + 几何图形」，因为没有先决定画面。Prompt-first 要做的是：

1. **原文 → 视觉命题**：这段文字里，什么是只有画面能表达的？
2. **参考 → 视觉系统**：借什么构图/光/色/材质/镜头/运动，不借什么。
3. **2–3 个方向**：不要只做第一个想到的方案；并排看差异。
4. **测试帧**：先做便宜的真实帧，验证方向，不急着写完整动画。
5. **选定方向**：写清为什么、放弃了什么、风险是什么。
6. **再实现**：先建立色板/光/材质/镜头规则，再写镜头；不要每镜临时画几何。

### 字幕/旁白

- 字幕/旁白不是画面的解释器；它们应该补充画面不能说的，而不是复述画面。
- 如果去掉字幕就看不懂事件，优先改画面/镜头，而不是加更多字幕。
- 多镜头可以让字幕跨镜头；不需要为了字幕换行新建镜头。

### 创作习惯

这些是习惯，不是硬门禁：

1. 先做便宜的图，再写贵的代码。
2. 一次只改一个最大的视觉问题。
3. 计划服务于画面；如果文档开始替代画面判断，删掉文档。
4. 参考是借结构/光/材质/构图，不是照抄表皮。
5. 复用已经成立的视觉系统，不要每轮重新决定风格。
6. 允许实验；实验失败就换方向，不要用更多装饰救场。
7. 安静/留白可以保留，但必须是有意的节奏。

### 技术/真实性底线

这些必须过：

- 不伪造参考、素材、组件、渲染、用户批准或审片结果；
- 不把占位渲染当最终交付；`sketch`/`prototype` 明确标记非交付；
- 用户要求逐字保留的内容不能遗漏/改写；
- 技术错误（JSON、帧窗口、fps/宽高/帧数、资源、输出损坏）必须修；
- 没有实际渲染证据，不声称「效果已改善」。

## 高级工具（可选，不是默认门禁）

复杂/Structured 项目可以按需使用：

- `shot-plan.json` + `validate-shot-plan.mjs`：机器可读镜头/事件/字幕/状态交接；
- `animatic-review.json` + `validate-animatic-review.mjs`：记录 animatic 完整播放/无字幕测试/返工状态；
- `cut-evidence.mjs`：切点前后帧 + freeze/black 定位；
- `animation/`、`execution/` 下的蓝图、scene.spec、组件合同。

这些工具用于**复杂项目的协作和追溯**，不是 Prompt-first 的创作前提，也不应用来替代画面判断。

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
├── templates/{prompt.original.md,corrections.md,decisions.md,lookdev-brief.md,quality-bar.md,film-plan.md}
├── tools/init-project.mjs
├── templates/{shot-plan.json,animatic-review.json}          # 可选/高级
├── tools/{validate-shot-plan.mjs,validate-animatic-review.mjs} # 可选/高级
└── examples/
```
