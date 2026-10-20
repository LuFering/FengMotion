# Capability Registry（外部资产，可选）

> 不是新工作流层，不是门禁。只在任务确实需要某种风格/镜头/组件时检索 1 个或多个候选。

## 已接入（RVE / ui2v 不接入）

| id | 类型 | 本地路径 | commit | 许可 |
|---|---|---|---|---|
| `lemo-opuscar` | 风格/导演 skill | `~/ai-video-desktop/capabilities/lemo-opuscar` | `b5e8ef9` | MIT + CC BY 4.0（demo 素材） |
| `video-shotcraft` | 镜头卡/产品片流程 | `~/ai-video-desktop/capabilities/video-shotcraft` | `43bd349` | Apache-2.0（音频另看） |
| `remotion-scenes` | Remotion 组件库 | `~/ai-video-desktop/capabilities/remotion-scenes` | `02c7a84` | MIT |

`index.json` 是唯一入口。不要把整个库复制进 `workflow-v5`，也不要全量加载。

## 先选模式，再决定用多少

> 之前只写“取 1 个 STYLE / 1–3 张卡 / 1–2 个原语”，会让人误以为这些库只有零件。
> 实际上：lemo 是完整短片 skill，shotcraft 有完整产品片模板/pipeline，scenes 是组件库。先选任务模式：

| 模式 | 主导 | 可以用到什么程度 | 什么时候用 |
|---|---|---|---|
| `style-film` | lemo-opuscar | `DIRECTOR.md` + `TECHNIQUE.md` + 1 个 `STYLE.md`；可选 shotcraft 卡 + scenes 原语 | 有明确风格、叙事短片、艺术片、实证影像 |
| `product-promo` | video-shotcraft | `SKILL.md` + `pipeline/template`（匹配时）+ 1–3 张卡 + 组件/音频；可选 1 个 lemo 风格参考 | 产品/UI/发布宣传片、真实页面、卡点片 |
| `motion-graphics` | remotion-scenes + shotcraft 卡 | 选中的组件 + 1–3 张卡；不用完整片模板 | 排版/数据/抽象/转场动效 |
| `micro-test` | 混合 | 只取 1 个风格/1 张卡/1 个组件 | 8s smoke、单点验证 |

- **完整模板不是禁用**：shotcraft 的 36.2s template 只在 product-promo 匹配时用，且必须重新蒙皮；lemo 的完整 skill 只在 style-film 时用。
- **完整 skill 也不是全量加载**：仍然只读 entry（DIRECTOR/TECHNIQUE/pipeline/template/1 个 STYLE），不读 51 风格/124 卡/201 组件的全库。
- **当前 8 秒《雨后》测试属于 `micro-test`/`style-film` 的轻量用法**：只取一个 STYLE + 一个 typewriter 卡 + 一个 TextKinetic 原语；不是这些库的完整能力面。

## 检索规则

- **lookdev**：style-film 模式可读 `DIRECTOR.md`/`TECHNIQUE.md` + 1 个 `STYLE.md`；micro-test 只取 1 个 STYLE。不要加载 51 个风格。
- **film-plan**：product-promo 匹配时可读 `SKILL.md` + `pipeline/template`；其他任务只按功能取 1–3 张卡 + demo。不要为了用模板而把非产品片套成产品片。
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
