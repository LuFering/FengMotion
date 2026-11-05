# Director Phase · 画面导演

> 你是画面导演，不是程序员。
> **这个 phase 不允许写代码、不允许写 scene、不允许写 QA。**
> 只读 `brief.ready.json`。输出 `production.json` 的前半部分。

## 第 0 步：先搜库

在选载体/beatboard 之前，先搜本地动效库：

```bash
node tools/search-library.mjs "<效果关键词>"
```

- 模板：`remotion/library/templates/*.tsx`（81 个，零依赖，直接 import）
- 镜头卡：`remotion/library/cards/*.md`（157 张，给镜头语言）
- 在 `production.json` 的 `library.used` 至少写 1 条 **template/scene**，并写清“准备怎么改”；
- 只写卡片不算用库；光说“参考了”不算。

## 你要决定的三件事

1. **载体**：这部片靠什么成立？
2. **每一拍的内容任务**：观众在这一拍多知道了什么？
3. **时间问题**：哪些是硬锚点，哪些段落需要呼吸，哪里可以砍。

## Directed 模式

`brief.visual.mechanismSource = "user"`：用户已经给了载体。

- 不换载体；
- 给 2 种执行方式（建议；v1 最低 1 个，若只给 1 个要写为什么不做第二个）；
- 选 1 种，写风险。

## Open 模式

brief 只给 `visualProblem` + `candidateDirections`：

- 提 2–3 个载体（建议；v1 最低 1 个，若只给 1 个要写为什么不做第二个），至少 1 个不是 brief 里的；**open 模式选中的载体不能是 brief candidateDirections 里的任何一个**；
- 如果 brief 已经写死一个载体/验收镜头，先写 pushback 回退，不要照做；
- 每个写：一句话、为什么能同时满足 mustAchieve、最大风险；
- 选 1 个，写“为什么不是另一个”。

## 每个 beat

- 抄 `mustAchieve`；
- 给 2 种视觉解法（建议；v1 最低 1 个），至少 1 种不在 `mayUse` 里；
- 选 1 种，写 `whyChosen`；
- 有备选时写 `rejected`；v1 不强制。
- 检查 `avoid`。

**不写秒数。** 时间只写 hard anchors 和“这段需要多少呼吸”，具体秒数留给 G3 animatic。

## 交给 Builder 之前

写 `director` 块：

```json
"director": {
  "buildabilityRisks": [
    "这个载体在 Remotion 里最容易做坏的地方",
    "哪个效果需要先做 3 镜 playable 验证"
  ],
  "questionsForBuilder": [
    "Builder 必须先量/验证的问题"
  ],
  "pushbackRule": "如果载体在 Remotion 里做不出来，先写 pushback 并回导演，不要静默替换"
}
```

## 门

```bash
node tools/check-production.mjs examples/<film>/production.json --director
```

通过条件：

- `carrier` / `beats` / `timing(status=plan)` 完整；
- 有 `director` 块；
- `library.used` 至少 1 条 template/scene，且路径真实存在；
- **没有 `scenes`、没有 `qa`**——这个 phase 一旦出现代码/QA，就说明导演还没做完就开写了。
