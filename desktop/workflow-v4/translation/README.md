# 转译层 · Translation Layer

> 目的：把「提示词 / 字幕 / 图片 / 视频 / 音频」转成一份**结构化 brief**，
> 让另一个模型只读 brief 就能开工。
>
> **Translator 不写视频代码；Builder 不读原始字幕和聊天记录。**

## 为什么单独放

- 不塞进旧 workflow（已归档），避免又变成“文档套文档”；
- 转译层是**独立角色**，输入脏、输出干净；
- 先在这里验证 brief 够不够用，再决定是否接进主流程。

## 角色

| 角色 | 看什么 | 产出 | 禁止 |
|---|---|---|---|
| **Translator** | 提示词、字幕、图、视频、音频、文档 | `brief.json` + 参考帧/风格帧 | 写 Remotion 代码、猜数据 |
| **Builder** | 只读 `brief.json` + 代码库 | 组件、帧、成片 | 回看原始字幕/聊天记录 |

## 目录

```
workflow-v4/translation/
├── README.md
├── schema/brief.schema.json      # brief 的字段契约
├── tools/validate-brief.mjs      # 无依赖校验器
├── tools/estimate-duration.mjs   # 按逐句旁白估时长 + 写 script[].at
├── tools/apply-decision.mjs      # 把用户选的 A/B 写成 ready brief
├── REPORT.md（已归档）           # 实测记录，不参与 v1 测试
├── prompts/
│   ├── translator.md             # Translator 的角色/流程/提问策略
│   ├── extract-text.md           # 从提示词/字幕提取什么
│   ├── extract-image.md          # 从图片提取什么
│   ├── extract-video.md          # 从视频提取什么
│   ├── extract-audio.md          # 从音频提取什么
│   └── builder-acceptance.md     # Builder 盲测提示词与通过标准
└── examples/                 # 历史样例已归档，不参与 v1 测试
```

## draft → 决策 → ready

```
Translator 产出 brief.json（needs_decision / needs_input）
        ↓  用户选 A/B
node tools/apply-decision.mjs path/to/brief.json A path/to/brief.ready.json
        ↓
Builder 只读 brief.ready.json
```

- `brief.json` 是**草稿**：可以带 2 个方向、待问问题；
- `brief.ready.json` 是**已决策**：`visual.status=ready`，方向已写入顶层；
- Builder 不允许读草稿，也不允许读原始字幕。

## 怎么跑

```bash
node tools/validate-brief.mjs path/to/brief.ready.json
```

校验器只回答：**这份 brief 能不能让 Builder 开工**，不评价创意好坏。

## 测试标准（历史样例，已归档）

1. `deepseek`：专业提示词应几乎填满 brief，`status = ready`，`openQuestions` 接近 0；
2. `citynight`：字幕只能填内容/节拍；视觉字段应暴露为空，`status = needs_decision`，
   给出 2 个方向 + 2 张风格帧，并列出需要用户拍板的问题；
3. **Builder 隔离测试**：把 brief 单独交给另一个模型，不许看 `input.md`，
   看它能否列出“能开工 / 缺什么”，而不是反问一堆原始信息。

## v1 的教训

第一版 `deepseek` / `citynight` 都通过了校验器，但两个只读 brief 的独立 Builder 都判 `can_build: false`。

缺的不是结构，是内容：

- 没有逐字文案 / 逐句旁白；
- 没有 V3→1017 的里程碑；
- 数字没有指标名、单位、谁跟谁比；
- `beats` 只有“讲什么”，没有“观众看到什么”；
- 没有字体、字号、字幕规则、音乐/人声来源。

v2 把这些变成必填字段（`script` / `copy` / `milestones` / `facts.metric` / `beats.visual` / `typography` / `audio.musicSource`）。
**结构合格 ≠ Builder 能开工。**

> 历史样例（deepseek/citynight）已移到 `~/remotion/_archive/2026-10-18-v1-clean/examples/translation-layer-examples/`；
> v1 测试请用新输入，不要复用旧样例，否则方向会复读。

## 边界

- 字幕里没有风格；不要从“城市/地铁/咖啡店”这些名词推镜头；
- 图片/视频能提色板、构图、镜头、节奏；音频能提 BPM/能量/同步点；
- 没有视觉参考时，Translator 必须给 2 个方向 + 风格帧，不能直接写代码；
- 所有数字必须有来源；拿不到就写进 `openQuestions`，不许编。
