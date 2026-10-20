# workflow-v5 · 架构设计（待审）

> v3 冻结，不再修改。v5 是并行新管线：保留 v3 可复用的执行层（scene.spec / 组件合同 / Remotion / 渲染验收），
> 重写前置的意图、方向、参考与确认机制。
>
> 目标不是“更长的提示词”，而是让每一层只回答自己的问题，并且每个决定都有状态、来源和确认范围。
>
> **状态：v5 尚未证明优于高级提示词。** 默认走 Prompt-first；Structured 只在复杂任务按需启用。
> 两条路径、硬约束/创作建议、Gate A 结构示意 vs Look-dev、Prototype 通路见 `PATHS.md`；
> 对照实验与决策规则见 `EVALUATION.md`。

---

## 0. 为什么需要 v5

v3 已经有正确的机制（参考分析、视觉设计、场景规格、逐帧验收），但结构上有四个问题：

1. **无参考时门禁自相矛盾**：`reference-log.json` 强制 `cards>=3`、`refs>=1`，但 `reference-free` 不可能有这些记录；结果只能编造参考，或合理方向被形式要求卡死。
2. **方向验证与场景布局混成一个“关键画面”门**：前者回答“这个视觉方向成立吗”，后者回答“这个场景的布局成立吗”，不能互相替代。
3. **确认没有范围**：用户认可一张关键帧，不等于认可动画时长、资产质量、最终成片；确认必须绑定版本和范围。
4. **参考分析容易变成鉴赏报告**：观察、解释、迁移建议混在一起，最后只剩“高级感/电影感”这类不可执行结论。

v5 不修补 v3，而是把这些问题变成新的阶段边界与数据契约。

---

## 1. 五条原则

1. **意图编译，不是提示词扩写**：阶段 0 只输出事实、约束、推断、线索、未决决策；不替导演决定怎么拍。
2. **导演决定视觉语言，参考证明手法，场景证明布局，运动证明运动**：四件事递进，不能互相替代。
3. **两道关键帧门必须分开**：方向验证门（Gate A）与场景布局门（Gate B）。
4. **确认绑定版本与范围**：每条确认记录必须写 `validFor` 与 `notApproved`。
5. **没有参考不等于没有验证**：`reference-free` 允许无参考，但必须有真实检索记录、设计依据和关键画面验证；不允许编造参考，也不允许用“找不到参考”回到素材轮播。

---

## 1.1 两条路径与硬/软约束

- **Prompt-first（默认）**：原始提示词 + 参考 + 真实渲染迭代；结构化数据只做后台记录。
- **Structured（按需）**：复杂/多场景/多人协作/需复现时启用完整阶段。

硬约束只负责防止错误与虚假完成（原文逐字、不伪造参考/组件/验收、Schema/文件真实、输出规格一致、预览与正式渲染同源）；
方向数量、场景数、每场阶段数、运动机制配额、固定节奏等属于创作建议，不作为硬门禁。详见 `PATHS.md`。

## 2. 阶段地图

| 阶段 | 回答的问题 | 主要产物 | 门 |
|---|---|---|---|
| 0 意图编译 | 用户想表达什么？ | `intent-brief.json` | 无（内容/权责清楚即可） |
| 1 导演诊断与方向探索 | 这条片应该如何表达？有哪些真正不同的方法？ | `creative-diagnosis.json`、`creative-directions.json` | 无（先不选） |
| 2 参考分析 | 哪些设计手法值得借鉴？哪些不能复现？ | `reference-log.json`、`reference-analysis.json`、`reference-decision.json` | **参考门**：证据可追溯、观察/解释分离 |
| 3 方向样稿 | 采用哪种视觉语言？ | `direction-samples/`、`direction-decision.json` | **Gate A：方向验证** |
| 4 视觉系统 + 场景设计 | 这套语言如何变成规则？每个场景要表达什么？ | `visual-direction.json`（approved）、`scene-intents.json` | **Gate B：场景布局** |
| 5 动画设计 + 10s 证明 | 对象何时发生什么变化？运动是否成立？ | `scene.spec.json`、组件合同、`proof-10s.mp4` | **Gate C：运动验收** |
| 6 声音先行 + 制作循环 | 声音与节奏是否支撑整片？ | `animatic-<duration>.mp4`、`passes/` | 内部检查 + 循环 |
| 7 交付 | 成片是否真的成立？ | 成片、QC、版权、盲评 | **Gate D：终审** |

> 与早期 5 阶段计划的关系：0/1 是原来的“内容 + 视觉开发”；2/3/4 是把“参考 + 方向 + 布局”拆开；
> 5 是原来的“10 秒证明”；6/7 是原来的“声音先行 + 制作循环 + 交付”。

---

## 3. 参考分析层（v5 新增）

### 3.1 三种参考模式

| mode | 什么时候用 | 必须记录 | refs/cards 要求 |
|---|---|---|---|
| `user-provided` | 用户给了参考 | 参考文件、时间码/关键帧、观察、可迁移手法 | `refs >= 1` |
| `library-assisted` | 用户没给，但项目参考片/镜头卡/组件库有匹配 | 检索词、命中卡/片、观察、可迁移手法 | `cards + refs >= 3` |
| `reference-free` | 检索后确实没有合适参考 | 检索词、结果、为什么没有合适参考、自主设计依据 | 允许 `refs = 0`、`cards = 0` |

`reference-free` 不是跳过创作验证：方向样稿、关键画面、可实现性仍然要过。
它只是跳过“虚假的参考依赖”。

### 3.2 六个步骤

1. **收集与分类**：每份参考负责解释什么（整体风格 / 镜头叙事 / 运动 / 字体排版 / 素材 / 转场），同一条视频可拆成多类记录。
2. **观察与取证**：时间码、主体位置、焦点、动作前/中/后状态、停顿、转场靠什么连续；只写“我看到了”，不写“我喜欢”。
3. **提取设计手法**：这些事实体现了什么设计原理；形成 `reference-card`。
4. **判断可迁移性**：复现 / 适配 / 不复现；写清 `doNotCopy`。
5. **验证实现条件**：需要什么资产、工具、Remotion 能力；做不到就明确放弃。
6. **形成参考方案**：哪些结论进入视觉设计，哪些被排除；输出三份产物。

### 3.3 参考卡字段

| 字段 | 含义 |
|---|---|
| `referenceId` | 原始素材 + 具体位置（时间码/帧） |
| `referenceScope` | 本参考负责解释什么问题 |
| `observations` | 能直接验证的事实（带时间码/帧） |
| `designPrinciple` | 这些事实体现的设计原理 |
| `transferableTechnique` | 可应用到新片的具体手法 |
| `doNotCopy` | 明确不应继承的特征 |
| `adaptationNotes` | 迁移到当前题材要改什么 |
| `feasibility` | 当前资产/工具能否支持 |
| `confidence` | 观察与解释的可信度；低分辨率看不清就写“无法判断” |

### 3.4 三份产物

`reference-log.json`：搜了什么、看了什么、实际命中/未命中；`mode` 必填。

```json
{
  "mode": "reference-free",
  "queries": [
    { "tool": "search-craft", "args": "窗光 遮罩 形态", "outcome": "none", "why": "没有同时满足连续空间与形态变化的参考" }
  ],
  "cards": [],
  "refs": [],
  "directions": ["A-morning-continuity", "B-text-and-matter"],
  "selected": "A-morning-continuity"
}
```

`reference-analysis.json`：可复现/需适配/不复现的手法；观察与解释分开。

```json
{
  "mode": "user-provided",
  "references": [
    {
      "referenceId": "REF-01@00:12.4",
      "referenceScope": "遮罩揭示的空间组织",
      "observations": ["主体位置基本不变", "遮挡区域逐步缩小", "新内容从原轮廓内部显露"],
      "designPrinciple": "用揭示而非镜头移动转移注意力",
      "transferableTechnique": "局部遮罩 + 轮廓内显露",
      "doNotCopy": ["品牌色", "字体", "整片节奏"],
      "adaptationNotes": "只迁移揭示机制，不迁移视觉系统",
      "feasibility": "Remotion mask 可实现；需要分层资产",
      "confidence": "high"
    }
  ]
}
```

`reference-decision.json`：哪些结论被选用、影响哪部分、哪些明确排除。

```json
{
  "mode": "user-provided",
  "selected": [{ "referenceId": "REF-01@00:12.4", "usedFor": "L1 光线进入的揭示方式" }],
  "excluded": [{ "referenceId": "REF-01", "reason": "品牌色与字体不复现" }],
  "rationale": "只借用揭示机制；视觉身份仍由方向层决定。"
}
```

### 3.5 参考门条件

- 来源真实可追溯；时间码/帧/路径存在；
- 观察、解释、迁移建议分开；
- 可复用手法与限制已记录；
- `reference-free` 有真实检索结果与原因；
- 不把参考的整体风格误升级为整片要求；
- `confidence` 不能替代证据：看不清就写“无法判断”。

---

## 4. Gate A：方向验证

### 4.1 做什么

为候选方向各做一个代表性视觉样稿，确认“视觉方向值得继续”，不是确认整部片。
样稿分两类：**结构示意**（SVG/色块，只验证构图/空间）与 **Look-dev 样稿**（真实参考/摄影/生成/高质量拼贴，验证材质/光线/色彩/焦点）。写实方向不能只靠结构示意通过 Gate A。

- 每个方向尽量用同一个内容节点（如示例内容节点 L1）；
- 比较画布用相同临时尺寸，但不锁定最终画幅；
- **允许各方向使用自己的字体、配色、材质、空间组织**——这些正是要比较的差异；
- 每个样稿标记：已确定 / 临时资产 / 占位布局；
- 不要求已有最终人物/背景/对象素材。

> 旧规则“同一文案、同一画幅、同一字体/配色”要拆开：比较条件一致 ≠ 强迫不同方向用同一套视觉。

### 4.1b 模式

- `exploration`：默认，2–3 个实质不同方向；差异规则用于评审。
- `direct`：输入/提示词已明确方向时，允许 1 个主方向 + 少量实现比较；不强制凑三套。

### 4.2 用户怎么选

- 采用这个方向；
- 修改后再确认；
- 这些方向都不合适，重新探索；
- 组合不同方案的特点 → 记录成新的待确认方向，不默认混合三套。

### 4.3 产物与门条件

- `direction-samples/`：每个方向至少 1 张代表样稿 + 设计说明；
- `direction-decision.json`：方向、推荐理由、用户/自动模式选择、状态、确认范围；
- 门条件：候选方向实质不同；样稿已检查；选择理由与状态已记录；未确认不能进入视觉系统。

---

## 5. 视觉系统 + Gate B：场景布局

### 5.0 Prototype / Proof 通路

候选组件/资产在 production preflight 会被阻塞，但验证它们又需要实际渲染。
因此分三级：`sketch` 可自由渲染但不可交付；`prototype` 允许 candidate 组件/资产、零外部资产、只验证选中场景，不要求 Gate A/B；
`production` 才要求 Gate A/B/C、组件/资产 available、proof 与 spec/config/build 哈希一致。
原型通过后才把组件/资产转为 available，不能为了过门提前改状态。

### 5.1 视觉系统

方向确认后，才把方向变成七类规则：

`composition / palette / typography / materiality / depth / motionGrammar / transitions`

每条规则必须说明：运动前、运动中、运动后是否仍成立；并标注来源（用户约束 / 原文 / 参考 / 推断 / AI 提案）与状态（proposed / approved）。

### 5.2 场景设计（先于布局）

每个场景先写 `scene-intents.json`：

- 对应哪些 `sourceUnitIds`；
- 这一场观众应该多知道什么/发生什么；
- 注意力焦点如何变化；
- 需要哪些资产/运动；
- 明确不做什么（避免模板化）。

### 5.3 场景布局确认（Gate B）

布局图必须在**场景意图与事件划分之后、组件实现之前**确认。

每张布局图检查：

| 检查项 | 必须能判断 |
|---|---|
| 焦点 | 第一眼看到什么 |
| 构图 | 主体、文字、空间、留白关系 |
| 层级 | 背景/主体/前景/遮挡 |
| 文字 | 字幕完整、层级、阅读位置 |
| 一致性 | 是否遵循已确认方向与视觉规则 |
| 内容 | 没有运动时，这一帧是否体现场景目标 |
| 资产 | 正式素材 / 占位图 / 待获取 |

复杂运动（形态变化、遮罩揭示、空间变换等）除静态关键帧外，还要“变化前—变化中—变化后”状态序列；可以是设计示意，不必最终渲染。

纯静态/阅读场景允许明确声明 `staticIntent`，不为过门禁强加动画事件。

### 5.4 门条件

- 每个需要确认的场景都有布局图；
- 关键视觉目标可辨认；
- 用户批准范围明确（见第 6 节）；
- 未确认布局前不写组件。

---

## 6. 确认记录（v5 新增）

确认必须绑定版本与范围，不能只写“用户已同意”。

```json
{
  "artifactId": "KF-opening-v2",
  "stage": "scene-layout",
  "status": "approved-with-changes",
  "version": 2,
  "sourceUnits": ["L1"],
  "validFor": ["composition", "visual-hierarchy"],
  "notApproved": ["animation-timing", "final-assets", "final-duration"],
  "userFeedback": {
    "quote": "保留光线和吧台的关系，但主体不要太居中。",
    "changes": [{ "target": "composition", "instruction": "重新安排主体与留白的比例" }]
  },
  "confirmedAt": "2026-10-19T11:00:00+08:00"
}
```

状态语义：

- `approved`：本版本通过；
- `approved-with-changes`：认可方向，但提出了修改；旧版不是最终批准，修改后回到待审核；
- `rejected`：不通过；
- `pending`：等待用户/自动模式确认。

规则：

- 每条确认必须有 `validFor` 与 `notApproved`；
- 确认绑定具体 `artifactId + version`；
- 用户认可关键帧 ≠ 认可动画时长、资产质量、最终成片；
- 自动模式可以确认，但必须记录依据和可撤回决定；
- 不允许把推荐说成用户已确认。

---

## 7. 门禁总表

| 门 | 允许进入下一阶段的条件 |
|---|---|
| 参考门 | 来源可追溯；观察/解释分离；可复用手法与限制记录；reference-free 有真实检索结果与原因 |
| Gate A 方向 | 2–3 个实质不同方向；代表性样稿已检查；选择理由与状态记录；未确认不进视觉系统 |
| 视觉系统 | 七类规则一致；每条说明运动中是否成立；来源/状态明确 |
| Gate B 场景布局 | 每场景布局图；焦点/内容可辨；批准范围明确；未确认不写组件 |
| Gate C 运动验收 | 10s 证明：真实运动、声音、字幕；运动因果与起止状态成立；盲评 + 用户看 |
| Gate D 终审 | 技术 QC + 盲评 + 版权署名；确认范围覆盖最终交付 |

---

## 8. v5 目录（设计）

```
workflow-v5/
├── DESIGN.md                 # 本文件
├── PLAN.md                   # 阶段计划（待按本设计更新）
├── intent/                   # 阶段 0：创作意图编译器（已实现）
├── director/                 # 阶段 1：导演与视觉方向（已实现）
├── reference/                # 阶段 2：参考分析（待实现）
│   ├── schema/               # reference-log / analysis / decision
│   ├── tools/                # 参考门校验
│   └── examples/
├── gates/                    # 阶段 3–5：方向/布局/运动门与确认记录
│   ├── schema/approval.schema.json
│   └── tools/check-gates.mjs
├── scene/                    # 阶段 4–5：scene-intent / 布局 / scene.spec
├── animation/                # 阶段 5：组件合同 / 运动计划
├── execution/                # 阶段 6–7：Remotion / 渲染验收（复用 v3 执行层）
└── delivery/                 # 阶段 7：成片 / QC / 版权
```

---

## 9. 从 v3 复用与不继承

**复用（作为执行层）**：

- `scene.spec.json` 的结构与唯一校验器思路；
- 组件合同、Remotion 契约、确定性/资源规则；
- 渲染 QA、逐帧验收、运动规则；
- 资产工作流、风格指纹（作为参考，不作为硬门）。

**不继承**：

- `reference-log.json` 无模式的硬性 `cards>=3/refs>=1`；
- 方向验证与场景 hero frame 合并成一个门；
- 没有 `validFor/notApproved` 的确认；
- “self 必须举证 2 张卡”作为 universal 要求（reference-free 改为设计依据举证）；
- 用字段门代替看片。

---

## 10. 实施顺序（待批准）

1. `workflow-v5/reference/`：三份产物 schema + 参考门校验 + 示例（含 reference-free 反例）。
2. `workflow-v5/gates/`：确认记录 schema + Gate A/B 校验。
3. `workflow-v5/scene/`：`scene-intents.json` + 布局确认产物。
4. 把现有 director 层的 `hero-frame-brief` 拆成 Gate A（方向样稿）与 Gate B（场景布局）。
5. 接入动画设计（复用 v3 `scene.spec` / 组件合同），做 10s 证明。
6. 声音先行 + 制作循环 + 交付。

---

## 11. 需要你确认

1. 阶段地图是否按“意图 → 导演 → 参考 → Gate A → 视觉系统/场景 → Gate B → 动画/10s → 声音/制作 → 交付”推进？
2. 门数量从 3 个变成 4 个（参考门 + 方向门 + 布局门 + 终审；10s 运动证明算阶段门），是否接受？
3. `reference-free` 的检索记录最小格式是否够用（query / outcome / why / 设计依据）？
4. 确认记录用 `approvals.json` 按 `artifactId + version` 存，还是继续用 `approved.md`（结构化段落）？
5. 先实现 `reference/` 还是先实现 `gates/` 的确认记录？


---

## 12. 当前实现状态（2026-10-19）

| 层 | 状态 | 入口 |
|---|---|---|
| 0 意图编译 | 已实现 | `intent/`（schema/prompt/lint/示例） |
| 1 导演与视觉方向 | 已实现 | `director/`（诊断/方向/决策/视觉系统/关键画面 brief） |
| 2 参考分析 | 已实现 | `reference/`（三种模式/六步/三产物/lint/reference-free 示例） |
| Gate A 方向验证 | 已实现 | `gates/`（direction-gate + 3 个样稿 + 确认记录） |
| Gate B 场景布局 | 已实现 | `gates/`（scene-intent + layout v1 + approvals，当前 pending） |
| Prompt-first 默认入口 | 已实现 + v5.12 外部能力检索 | `prompt-first/`（lookdev 视觉机制 + film-plan 镜头差异/frame score + quality Finishing Pass + creator 成片优先；lemo/shotcraft/scenes 仅可选检索） |
| 5 动画设计（蓝图/实现计划/草稿规格/设计审查） | 已实现（draft/blocked） | `animation/`（6 场蓝图 + implementation plan + scene.spec.draft + design-review） |
| 6 执行与验收（sketch/prototype/production、buildHash 重算、输出 SHA-256、审片人工/自动分离） | 已实现；sketch 真实渲染已跑通，production 仍待组件/资产 | `execution/` |
| 10s 证明 / 声音先行 / 制作循环 | 待实现 | 见阶段地图 5–7 |

当前示例都停在“未确认”状态：Gate A 是 `recommended`，Gate B 是 `pending`，不伪造用户确认。

校验命令：

```bash
node intent/tools/validate-intent.mjs intent/examples/seven-oh-five/intent-brief.json
node director/tools/validate.mjs director/examples/seven-oh-five --profile=creative
node reference/tools/validate-reference.mjs reference/examples/seven-oh-five
node gates/tools/validate-gates.mjs gates/examples/seven-oh-five
node animation/tools/validate-animation.mjs animation/examples/seven-oh-five --profile=creative
```
