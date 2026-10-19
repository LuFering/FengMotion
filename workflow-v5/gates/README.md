# 关键画面确认 · Gate A / Gate B（v5）

> 两个门回答两个不同问题，不能互相替代：
> - **Gate A 方向验证**：这个视觉方向成立吗？
> - **Gate B 场景布局**：这个场景的布局成立吗？
>
> 方向未确认不能进视觉系统；布局未确认不能写动画组件。

## Gate A · 方向验证

### 做什么

为候选方向各做一个代表性视觉样稿，确认“视觉方向值得继续”，不是确认整部片。
`exploration` 模式 2–3 个方向；`direct` 模式允许 1 个主方向 + 少量实现比较。

样稿分两类，不能互相替代：

- `sampleType: "structure"`：SVG/色块/占位形状，只验证构图、空间关系、焦点。
- `sampleType: "look-dev"`：真实参考帧、摄影素材、生成图像或高质量拼贴，验证材质、光线、色彩、焦点和识别度。

写实方向（naturalistic / 依赖真实素材/自然光）必须有 `lookDev.required: true` 且至少一张 Look-dev 样稿通过；
结构示意通过不能证明最终质感。

`lookDev.required` 由方向的 `materialDirection`/`candidateMediums` 推导，模型不能自填 `false` 绕过；关闭必须由用户明确豁免并记录理由。
Look-dev 证据必须是图片/视频（SVG 结构示意不算），并记录 `source`（remotion-still / reference-frame / generated-image / photographic）。

所有批准记录必须带 `contentHash`（被批准文件的 sha256）；文件内容变更后旧批准失效。

- 每个方向尽量用同一个内容节点（如 L1）；
- 比较画布用相同临时尺寸，但不锁定最终画幅；
- **允许各方向使用自己的字体、配色、材质、空间组织**——这些正是要比较的差异；
- 每个样稿标记 `provisionalAssets: true/false`；
- 不要求已有最终人物/背景/液体素材。

### 产物

- `direction-samples/`：每个方向至少 1 张代表样稿；
- `direction-gate.json`：

```json
{
  "status": "recommended",
  "samples": [
    {
      "directionId": "A-morning-continuity",
      "file": "direction-samples/A-morning-continuity.svg",
      "designNotes": "连续空间：窗光先进入，吧台与卷帘门保持稳定关系",
      "provisionalAssets": true,
      "sampleType": "structure"
    }
  ],
  "selectedDirectionId": "A-morning-continuity",
  "lookDev": { "required": true, "status": "missing", "evidence": [] },
  "recommendation": "推荐 A，但需要关键画面与素材可行性验证。",
  "confirmation": null
}
```

### 用户怎么选

- 采用这个方向；
- 修改后再确认；
- 都不合适，重新探索；
- 组合不同方案 → 记录成新的待确认方向，不默认混成一套。

### 门条件

- 2–3 个方向实质不同；
- 样稿文件存在、说明清楚；
- 选择理由与状态记录；
- `recommended` ≠ `confirmed`；未确认不能进视觉系统。

## Gate B · 场景布局

### 做什么

方向确认、场景意图与事件划分之后，为每个需要实现的场景做静态布局图；确认“这个场景的视觉结构能支撑对应事件”，再写动画。

布局图检查：

| 检查项 | 必须能判断 |
|---|---|
| 焦点 | 第一眼看到什么 |
| 构图 | 主体、文字、空间、留白关系 |
| 层级 | 背景/主体/前景/遮挡 |
| 文字 | 字幕完整、层级、阅读位置 |
| 一致性 | 是否遵循已确认方向与视觉规则 |
| 内容 | 没有运动时，这一帧是否体现场景目标 |
| 资产 | 正式素材 / 占位图 / 待获取 |

复杂运动（液体、遮罩揭示、空间变换）除静态布局外，还要“变化前—变化中—变化后”状态序列；可以是设计示意，不必最终渲染。

纯静态/阅读场景允许 `staticIntent: true`，不为过门禁强加动画事件。

### 产物

- `scene-intents.json`：每个蓝图场景一条 sceneId / sourceUnitIds / intent / event / attention / motionIntent / staticIntent / assets / notThis；
- `scene-layouts/<sceneId>-v<版本>.(svg|png|jpg|webp)`；文件名前缀必须等于 sceneId；
- `approvals.json`：场景布局确认记录。

## 版本与逐场景规则

- Gate A 确认必须绑定 `direction-gate.version`；`approved-with-changes` 不算确认，必须出新样稿版本后重新确认。
- Gate B 逐场景检查：每个蓝图场景都要有当前布局版本，且该版本状态为 `approved`。
- 旧版本 `approved` 不能用于新布局；`approved-with-changes` 必须生成更新版本，否则视为未通过。
- 只检查“存在一条 scene-layout 批准记录”不足以放行。

## 确认记录

```json
{
  "artifactId": "layout-S01-v1",
  "stage": "scene-layout",
  "sceneId": "S01",
  "contentHash": "<layout-file-sha256>",
  "status": "approved-with-changes",
  "version": 1,
  "sourceUnits": ["L1"],
  "validFor": ["composition", "visual-hierarchy"],
  "notApproved": ["animation-timing", "final-assets", "final-duration"],
  "confirmedBy": "user",
  "userFeedback": {
    "quote": "保留光线和吧台的关系，但主体不要太居中。",
    "changes": [{ "target": "composition", "instruction": "重新安排主体与留白的比例" }]
  },
  "confirmedAt": "2026-10-19T11:40:00+08:00"
}
```

状态语义：

- `pending`：等待确认；
- `approved`：本版本通过；
- `approved-with-changes`：认可方向但提出修改；旧版不是最终批准，修改后回到待审核；
- `rejected`：不通过。

规则：

- `validFor` 与 `notApproved` 必填，不能重叠；
- 确认绑定 `artifactId + version`；
- 用户认可关键帧 ≠ 认可动画时长、资产质量、最终成片；
- `confirmedBy: user|autopilot`；自动模式也必须记录依据；
- 不允许把推荐说成用户已确认。

## 校验

```bash
cd workflow-v5/gates
node tools/validate-gates.mjs examples/seven-oh-five
```

会拦：

- 方向样稿数量/文件/说明缺失；
- 推荐状态带 confirmation，或 confirmed 缺确认记录；
- 确认缺 `validFor/notApproved`，或两者重叠；
- `approved-with-changes` 缺用户原话/修改项；
- Gate B 已批准但 Gate A 未确认；
- 布局确认版本与现有布局文件不一致；
- Gate B 未通过就出现 `scene.spec.json` / 组件文件；
- 场景意图的 sourceUnit 不在 intent-brief。

## 示例状态

`examples/seven-oh-five` 当前是**未确认**示例（结构通过、状态 blocked）：

- Gate A：`status: recommended`，3 个方向样稿，`confirmation: null`；
- Gate B：布局 `S01-v1.svg` 已出，`approvals.records: []`，状态 pending；
- 不伪造用户确认，不提前写动画。

## 文件

```
workflow-v5/gates/
├── README.md
├── schema/approval.schema.json
├── tools/validate-gates.mjs
└── examples/seven-oh-five/
    ├── direction-gate.json
    ├── direction-samples/*.svg
    ├── scene-intents.json
    ├── scene-layouts/S01-v1.svg
    └── approvals.json
```
