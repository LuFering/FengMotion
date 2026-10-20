# Capability Registry（外部资产，可选）

> 不是新工作流层，不是门禁。只在任务确实需要某种风格/镜头/组件时检索 1 个或多个候选。

## 已接入（RVE / ui2v 不接入）

| id | 类型 | 本地路径 | commit | 许可 |
|---|---|---|---|---|
| `lemo-opuscar` | 风格/导演 skill | `~/ai-video-desktop/capabilities/lemo-opuscar` | `b5e8ef9` | MIT + CC BY 4.0（demo 素材） |
| `video-shotcraft` | 镜头卡/产品片流程 | `~/ai-video-desktop/capabilities/video-shotcraft` | `43bd349` | Apache-2.0（音频另看） |
| `remotion-scenes` | Remotion 组件库 | `~/ai-video-desktop/capabilities/remotion-scenes` | `02c7a84` | MIT |

`index.json` 是唯一入口。不要把整个库复制进 `workflow-v5`，也不要全量加载。

## 检索规则

- **lookdev**：有明确风格需求时，从 `lemo-opuscar` 取 1 个 `styles/<id>/STYLE.md`；`DIRECTOR.md` 只作方法参考。不要加载 51 个风格。
- **film-plan**：需要已有镜头运动语法时，从 `video-shotcraft/references/shots/` 按功能取 1–3 张卡，读卡 + 对应 `demos/` 源码；只借结构与参数。
- **实现**：需要具体原语时，从 `remotion-scenes/src/scenes/` 复制 1–2 个组件，按项目 tokens 重新蒙皮。
- **Finishing**：可参考 `video-shotcraft/references/aesthetic-rules.md`、`final-review.md`、`lemo-opuscar/DIRECTOR.md` 的自检问题；但 Finishing Pass 仍按本项目 `quality-bar` 执行。
- **记录**：在 `decisions.md` 写来源、commit、许可、改了什么。
- **不匹配就不用**：不要为了“用了资产”而硬套；没有匹配就自己设计。

## 许可注意

- lemo：代码 MIT；demo 影片/剧照 CC BY 4.0，公开使用需署名 LemoLab 并注明修改。
- shotcraft：代码/文档 Apache-2.0；音频按 `assets/audio/ATTRIBUTION.md`；Remotion 许可单独确认。
- remotion-scenes：MIT。
- 外部资产不进入本仓库；本地路径只用于检索/复制。

## 更新

更新前先看 `upstream` 的变更和许可证；更新后同步 `index.json` 的 commit。不要自动 `git pull` 后无记录地替换资产。

## 接入验证（2026-10-20）

已做一次 5 秒 capability smoke：

- 风格参考：`lemo-opuscar/styles/watercolor/STYLE.md`
- 镜头卡：`video-shotcraft/references/shots/typography/typewriter-moves.md`
- 组件：`remotion-scenes/src/scenes/TextAnimations/TextKinetic.tsx`
- 实现：`remotion/capability-smoke/`（适配组件 + 纸感 watercolor 场景）
- 结果：150 帧 / 1920×1080 / 30fps / 5.000s，真实渲染通过；输出 `/tmp/capability-smoke/out/capability-smoke.mp4`
- 结论：检索→读取→适配→渲染链路可用；这是 smoke，不是成片质量证明。
