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
  lookdev-brief.md       # 首帧视觉定标：媒介/构图/光/材质/文字/运动/参考
  quality-bar.md         # 首帧与首版动画的最低质量门槛
  film-plan.md           # 全片编排：节奏弧/关键事件/连续性/转场/结尾/可选声音
  shot-plan.json         # 机器可读时间线：Shot/Event/Caption/状态交接
  animatic.mp4           # 全片低保真动态分镜（多镜头）
  animatic-review.json   # animatic 审查：shotPlanHash/播放范围/findings/返工状态
  references/            # 参考图/视频/链接清单
  qa/
    passes/NN/           # 每轮渲染：视频、抽帧、观察记录
  project.json           # filmId、创建时间、模式
```

实际 Remotion 工程可以在任意目录；这里只规定**创作上下文**的存放方式，不强制新的渲染后端。

## 通用性

模板使用中性术语（主体/道具/材质/空间/光源/事件），不预设题材；`examples/` 或旧片仅用于校验/演示，不应成为默认视觉方案或叙事结构。

## 开始

```bash
cd workflow-v5/prompt-first
node tools/init-project.mjs <project-dir> --film-id <id> --prompt-file <原始提示词.md>
```

- `prompt.original.md` 逐字复制，不做摘要；已存在时默认不覆盖。
- 之后把用户纠正追加到 `corrections.md`，关键决定写入 `decisions.md`。
- 写代码前先填 `lookdev-brief.md` 和 `quality-bar.md`：先定媒介/构图/光/材质，再写动画。
- 多镜头/长片作品，在完整动画前填 `film-plan.md` 和 `shot-plan.json`：先排节奏、事件、镜头、字幕、连续性和结尾。
- `shot-plan.json` 写完后运行 `node tools/validate-shot-plan.mjs shot-plan.json`。
- 全片 animatic 后填 `animatic-review.json`（含 `noSubtitleTest`），运行 `node tools/validate-animatic-review.mjs animatic-review.json --shot-plan shot-plan.json`；未 `passed` 不进入视觉制作。
- 不需要先创建 `intent-brief.json`、方向、Gate、蓝图或 `scene.spec`；按任务复杂度按需使用。

## 上下文优先级

1. 用户最新明确纠正/新要求。
2. 用户明确标记的硬要求（原文/参考/必须保留内容）。
3. 用户已确认的决定。
4. 当前有效的模型决定（`decisions.md` 中 `active`）。
5. 模型推断与临时假设。

原文不能被摘要替代。上下文变长时，完整原文留在项目文件中，创作阶段注入相关原句、纠正、硬约束与最近决定。

## 创作闭环（animatic-first + still-first）

```text
原文/参考/素材
  → 媒介适配 + lookdev-brief（构图/光/材质/文字/运动）
  → 多镜头：film-plan（叙事/节奏/事件/连续性/结尾）
  → 多镜头：shot-plan.json（Shot/Event/Caption/状态交接）
  → 全片低保真 animatic（覆盖全部切点）
  → animatic-review.json（绑定 shotPlanHash；passed + 无返工）
  → 静帧（开场/核心动作/结尾）
  → 3–5 秒关键动作 proof；多镜头额外 6–10 秒连续片段
  → 完整视觉实现
  → 渲染 → 看连续画面 → 逐切点证据 → 修改
  → 技术 QA + 视觉审片（对照 film-plan/shot-plan）
```

### 全片编排（v5.3）

多镜头/长片，局部 proof 不能证明全片成立。v5.2/v5.3 把规划拆成两层：

- `film-plan.md`：叙事/节奏/事件/连续性/结尾，是导演地图；
- `shot-plan.json`：机器可读时间线，定义 Shot、Event、Caption、状态交接。

层级必须分开：

- **Event** 可以跨多个 Shot；
- **Shot** 是时间/观看单位，不等于一句文本；
- **Scene** 是空间单位，可以包含多个 Shot；
- **Caption** 是独立轨道，不因字幕换行自动创建 Shot。

每个 Shot 记录 `continuityIn/out`、`transitionIntent`、主体 `stateIn/stateOut`。执行层必须继承 `stateIn`，不能默认从初始状态重新开始。

同一主体前后镜的 `stateOut` 必须等于下一镜 `stateIn`；视角/姿态/位置等允许的变化，必须在 `continuityIn.stateChanges` 写清 `subjectId` / `field` / `reason`，否则 `validate-shot-plan` 直接失败。

全片 animatic 是完整视觉制作前的门槛：用占位形状覆盖全部切点，先证明时间线连贯；`animatic-review.json` 必须绑定当前 shot plan 哈希并记录完整播放、findings 和返工状态。`status=passed` 且 `rework.required=false` 后才能进入视觉制作；如果去掉精细外观后像幻灯片，就回改 Shot Plan。

声音是可选段：用户要求无声则跳过，不作为阻塞项。

全片编排不规定固定镜头数/转场类型；但 shot-plan 结构、stateOut→stateIn 一致性、animatic-review passed 是进入视觉制作的前置条件。

### 为什么加 still-first


第一版直接从提示词写完整动画，模型会默认选最省力的实现：深色背景、矩形、渐变、硬边光、几何占位符、文字浮入。
这不是“模型不会写代码”，而是跳过了视觉定标。先做静帧，能在最便宜的阶段暴露构图/光/材质问题，避免整片重渲。

### 首版质量门槛

`lookdev-brief.md` / `quality-bar.md` 至少检查：

- 焦点、构图、留白、层次；
- 光的方向/衰减/受光面/暗部；
- 材质是否能区分，而不是纯色块；
- 文字完整、可读、层级清楚；
- 暂停时像设计画面，不像 PPT；
- 媒介诚实：程序化不假装摄影。

不通过就改静帧，不写完整动画。

### 省 token 规则

1. 多镜头没有 `film-plan.md` + `shot-plan.json`，不写完整动画。
2. 全片 animatic-review 未 `passed` 或 `rework.required=true`，不做完整视觉制作。
3. 静帧不过，不写完整动画；静帧覆盖开场/核心/结尾，不只做开场。
4. 首版只做关键动作 proof；多镜头额外做 6–10 秒连续片段，不直接全片。
5. 每轮只修 1 个主要问题；用 animatic/静帧/短片段验证，不重渲全片。
6. 连续两轮修同一层无改善 → 换镜头组织/媒介/视觉目标，而不是继续调参数。
7. 复用已确认的构图/光/材质/主体身份和状态交接，不每轮重新决定风格。

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
├── templates/{prompt.original.md,corrections.md,decisions.md,lookdev-brief.md,quality-bar.md,film-plan.md,shot-plan.json,animatic-review.json}
├── tools/{init-project.mjs,validate-shot-plan.mjs,validate-animatic-review.mjs}
└── examples/（含 continuity-reference 结构参考）
```
