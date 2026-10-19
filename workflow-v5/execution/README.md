# 阶段 6–7 · Remotion 执行与渲染验收（v5）

> 工程验收证明视频能正确生成；视觉验收证明生成出来的视频值得看。
> 两者必须分别通过，不能用一个“渲染成功”代替另一个。

## 六阶段

| 阶段 | 做什么 | 产物 | 失败退回 |
|---|---|---|---|
| 1 Preflight | 规格/代码/依赖/资源/字体/合同/门禁一致 | `qa/preflight-report.json` | 动画设计层 / 规格 / 资源 |
| 2 组件级验证 | 起始/运动/结束状态、帧边界、独立渲染 | `qa/component-test-report.json` + 证据帧 | 组件实现 / 合同 |
| 3 场景预览 | 场景片段 + 关键帧 contact sheet + 中间态 | `qa/preview-report.json` + `qa/previews/` + `qa/frames/` | 场景设计 / 组件 / 运动计划 |
| 4 全片预览 | 低分辨率整片：叙事、节奏、连续性、声音 | `qa/preview-report.json`（fullPreview） | 动画设计层 / 声音 |
| 5 正式渲染 + 自动 QA | 成片 + 媒体规格/完整性/复现记录 | `qa/render-manifest.json` + `qa/acceptance-report.json` | 渲染配置 / 实现 |
| 6 视觉审片 + 交付 | 真实成片的问题定位、返工、批准 | `qa/visual-review.json` + `qa/iteration-log.json` + `qa/delivery-manifest.json` | 按问题类型路由 |

## 两种模式

- `prototype`：允许 candidate 组件/资产，用于生成 10s 运动证明；仍要求文件路径真实存在、规格合法。
- `production`：要求 Gate A/B/C 通过、组件/资产 `available`、证明与当前 spec/config 哈希一致；才允许全片预览与正式成片。

Gate C 产物是 `qa/motion-proof.json`：10s 证明视频、使用的 specHash/configHash、验收条件、问题与批准结果。正式 preflight 必须核对版本一致。

## 关键规则

- **同一份代码、同一套配置、同一份 spec、同一组 props** 生成预览与正式成片；低分辨率只降渲染负担，不换逻辑。
- 帧预览/场景预览/整片预览/正式渲染都来自同一个 Composition。
- 视觉审片必须看连续预览，不能只凭关键帧批准。
- 问题必须定位到 `sceneId + frameRange + 证据帧 + 设计验收条件`，不能写“看起来不够高级”。
- 返工只改对应层的最小单位，重渲问题场景，复查同一组帧，再做必要的全片回归。
- 自动脚本只验证结构/媒体/帧窗口/记录；视觉质量由独立审片 + 用户确认。

## 产物目录

```
films/<film-id>/
  execution.config.json
  qa/
    preflight-report.json
    component-test-report.json
    preview-report.json
    render-manifest.json
    acceptance-report.json
    visual-review.json
    iteration-log.json
    delivery-manifest.json
    previews/
    frames/
  out/final.mp4
```

## Preflight 检查

- Gate A 方向已确认、Gate B 场景布局已批准；
- 动画蓝图/实现计划/scene.spec 已批准；
- 组件与资产 `available`（candidate/missing 直接阻塞）；
- `components/*.tsx` 存在、`assets/` 已落盘；
- `timingCompile` 已确认，fps/帧数与 `execution.config` 一致；
- 组件合同存在；
- 确定性/依赖/字体/资源规则（由实现层补充检查）。

## 渲染身份（render-manifest）

每次正式渲染必须记录：

- `renderId` / `mode` / `composition`；
- `codeVersion`（git 版本或可追溯标识）；
- `specHash` / `assetManifestHash` / `configHash` / `propsHash`；
- fps / width / height / durationInFrames；
- 渲染配置（codec/crf/concurrency）；
- `output` 路径、`status`、`createdAt`。

预览与正式渲染的 `specHash` / `configHash` 必须一致；否则不是同一份东西。

## 自动 QA（acceptance-report）

- 媒体：文件存在、可读、宽高/fps/帧数/时长/编码符合规格；
- 声音：有音轨则检查存在/静音/截断/同步；无音轨项目不强制；
- 画面：黑帧/空白/缺失资源/严重闪烁/异常冻结；正常静止不因帧差小被判错；
- 确定性：同帧同像素、代码/规格/资产版本可追溯；
- `issues` 必须为空才 pass。

## 视觉审片（visual-review）

```json
{
  "status": "needs-revision",
  "findings": [
    {
      "id": "issue-001",
      "severity": "major",
      "sceneId": "S04",
      "frameRange": [420, 438],
      "category": "motion-clarity",
      "observation": "白色纹路接近最终形态，但形成过程变化不足",
      "expected": "能看出白褐交汇与纹路逐步形成",
      "likelyOwner": "component-contract",
      "recommendedAction": "检查中间帧、变化幅度与液体素材",
      "evidence": ["qa/frames/s04-420.png", "qa/frames/s04-430.png"],
      "humanDecision": "pending"
    }
  ]
}
```

严重程度：`blocker` / `major` / `minor`。
`approved` 时不允许有未处理的 blocker/major；`needs-revision` 时不得交付。

## 问题路由

| 问题类型 | 退回 | 修改方式 |
|---|---|---|
| 创意表达不成立 | 导演/视觉方向层 | 重评该场视觉目标 |
| 画面结构不合理 | 动画设计层/视觉系统 | 调整空间、构图、图层 |
| 资产质量不合适 | 资产工作流 | 替换/重处理素材 |
| 运动过程不清晰 | 动画设计层/组件合同 | 改状态变化、时间依赖、机制 |
| 运动代码错误 | Remotion 执行层 | 修组件逻辑并重渲 |
| 整体节奏不成立 | 动画设计层 | 调整事件时长/重叠/停顿 |
| 编码/输出问题 | 渲染交付层 | 重渲/修媒体配置 |

## 状态

`queued / running / passed / failed / needs-review / blocked`。
失败必须显示原因和下一步可执行操作，不能只显示红色感叹号。

## 文件

```
workflow-v5/execution/
├── README.md
├── prompts/
│   ├── execution-engineer.md
│   └── qa-reviewer.md
├── tools/
│   ├── preflight.mjs
│   └── validate-execution.mjs
└── examples/seven-oh-five/
    ├── execution.config.json
    └── qa/
        ├── preflight-report.json   # blocked：11 项前置未满足
        ├── motion-proof.json       # blocked：尚无 10s 运动证明
        └── delivery-manifest.json  # blocked，不伪造交付
```

## 校验

```bash
cd workflow-v5/execution
node tools/preflight.mjs examples/seven-oh-five/execution.config.json --out qa/preflight-report.json
node tools/validate-execution.mjs examples/seven-oh-five
```

当前示例是 **blocked**：Gate A/B/C 未确认、组件/资产 candidate、无组件代码、无正式渲染。
preflight 会明确列出 11 项阻塞，而不是让渲染引擎报错或让模型“先渲了再说”。

正式渲染与视觉审片要在组件/资产可用后执行；本层不伪造成片或审片结果。
