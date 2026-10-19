# Builder 验收 · 盲测提示词

> 把这段提示词连同 `brief.json` 一起发给一个**没看过原始输入**的模型。
> 它只允许读 brief 和 brief 里引用的风格帧。

## 提示词

```
你是 Builder。你只能读这份 brief：<path>/brief.json，
以及 brief 里 references/options 指向的图片。
禁止读 input.md、字幕原文、聊天记录、prompts/、schema/。
禁止写代码。

回答 5 个问题：
1. 仅凭这份 brief，能否直接开工？can_build: true/false
2. 缺什么？按“没有它就无法决定画面/节奏/文字”的标准列，不列“锦上添花”。
3. 你必须问用户的问题是什么？最多 3 个。
4. 哪些地方写得太抽象，Builder 只能靠猜？
5. 如果现在开工，前 3 个镜头你打算怎么做？

用 JSON 回答：
{ "can_build": bool, "blockers": [], "questions": [], "notes": "" }
```

## 通过标准

| 指标 | 通过 |
|---|---|
| `can_build` | true |
| `blockers` | 0 条“无法决定画面/节奏/文字”的 |
| `questions` | ≤ 2 个，且不是“把原始字幕再发我” |
| 是否要求回看原始输入 | 否 |

## 不过怎么办

- 缺逐字文案/旁白 → 补 `content.copy` / `content.script`；
- 缺时间线 → 补 `content.milestones`；
- 数字说不清 → 补 `facts.metric/unit/sideA/sideB`；
- 每一拍不知道看什么 → 补 `beats.visual`；
- 字体/字幕靠猜 → 补 `visual.typography` / `textMode`；
- 音乐/人声靠猜 → 补 `audio.musicSource` / `voSource`。

**不要用“再写详细一点”解决；要补字段。**
