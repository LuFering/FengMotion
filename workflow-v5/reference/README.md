# 阶段 2 · 参考分析（v5）

> 参考分析负责证明**哪些设计手法值得借鉴、哪些不能复现**。
> 它不决定整部片的视觉语言（那是导演/方向层的事），也不把参考的整体风格当成新片的要求。

## 三种参考模式

| mode | 什么时候用 | 必须记录 | refs/cards |
|---|---|---|---|
| `user-provided` | 用户给了参考 | 参考文件、时间码/关键帧、观察、可迁移手法 | `refs >= 1` |
| `library-assisted` | 用户没给，但项目参考片/镜头卡/组件库有匹配 | 检索词、命中卡/片、观察、可迁移手法 | `cards + refs >= 3` |
| `reference-free` | 检索后确实没有合适参考 | 检索词、结果、为什么没有合适参考、自主设计依据 | 允许 `refs = 0`、`cards = 0` |

`reference-free` 不是跳过验证：方向样稿、关键画面、可实现性仍然要过；只是跳过虚假的参考依赖。

## 六个步骤

1. **收集与分类**：每份参考负责解释什么（整体风格 / 镜头叙事 / 运动 / 字体排版 / 素材 / 转场）；同一条视频可拆成多类记录。
2. **观察与取证**：时间码、主体位置、焦点、动作前/中/后状态、停顿、转场靠什么连续。只写“看到什么”，不写“喜欢什么”。
3. **提取设计手法**：这些事实体现了什么设计原理；形成 `reference-card`。
4. **判断可迁移性**：复现 / 适配 / 不复现；写清 `doNotCopy`。
5. **验证实现条件**：需要什么资产、工具、Remotion 能力；做不到就明确放弃。
6. **形成参考方案**：哪些结论进入视觉设计、哪些排除；输出三份产物。

## 三份产物

### `reference-log.json`

记录搜了什么、看了什么、实际命中/未命中。`mode` 必填。

```json
{
  "mode": "reference-free",
  "queries": [
    { "tool": "local-motion-library", "args": "晨光 窗 遮罩 液体", "outcome": "none", "why": "没有连续空间与液体形态的可迁移手法" }
  ],
  "cards": [],
  "refs": [],
  "directions": ["A-morning-continuity", "B-text-and-matter"],
  "selected": "A-morning-continuity"
}
```

### `reference-analysis.json`

可复现/需适配/不复现的手法；观察、解释、迁移建议分开。

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

### `reference-decision.json`

哪些结论被选用、影响哪部分、哪些明确排除。

```json
{
  "mode": "user-provided",
  "selected": [{ "referenceId": "REF-01@00:12.4", "usedFor": "L1 光线进入的揭示方式" }],
  "excluded": [{ "referenceId": "REF-01", "reason": "品牌色与字体不复现" }],
  "rationale": "只借用揭示机制；视觉身份仍由方向层决定。",
  "affects": ["visual-direction", "direction-samples", "scene-layout"]
}
```

## 参考门条件

- 来源真实可追溯；时间码/帧/路径存在；
- 观察、解释、迁移建议分开；
- 可复用手法与限制已记录；
- `reference-free` 有真实检索结果与原因；
- 不把参考的整体风格误升级为整片要求；
- `confidence` 不能替代证据：看不清就写“无法判断”。

## 文件

```
workflow-v5/reference/
├── README.md
├── prompts/reference-analyst.md
├── tools/validate-reference.mjs
└── examples/seven-oh-five/
    ├── reference-log.json
    ├── reference-analysis.json
    └── reference-decision.json
```

## 校验

```bash
cd workflow-v5/reference
node tools/validate-reference.mjs examples/seven-oh-five
```

会拦：

- 模式与记录不匹配（`reference-free` 带 refs/cards；`user-provided` 无 refs；`library-assisted` 记录不足）；
- 观察里出现“喜欢/高级感/电影感”等主观判断；
- 参考结论不在 `reference-log` 里；
- `reference-free` 没有真实检索结果/原因；
- 设计假设没有依据/风险；
- 占位符/待填写。

## 《七点零五分》示例

当前没有可用参考，示例走 `reference-free`：

- 3 条检索记录（本地镜头卡、网络实拍参考、文字/物质参考），结果 none/partial，写明原因；
- 3 条自主设计假设：光先进入空间、液体变化用路径/遮罩、文字参与构图但不抢焦点；
- 不把通用咖啡广告当参考复现，也不假装看过不存在的参考。
