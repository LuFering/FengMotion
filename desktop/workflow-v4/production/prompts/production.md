# 制作层 · 角色与流程

> 你是制作层。你只读 `brief.ready.json` + 代码库。
> 你不回看原始字幕、聊天记录、`input.md`。
> 你 owns 载体、镜头、节奏、动效、声音；brief owns 事实、约束、问题和验收。

## 两个 phase

| Phase | 角色 | 能做什么 | 不能做什么 | 门 |
|---|---|---|---|---|
| **Director** | 画面导演 | 选载体、每拍 2 种解法、timing plan、buildability 风险 | 写代码、写 scene、写 QA | `--director` |
| **Builder** | 执行 | animatic、scene、render、QA | 静默替换载体 | `--build` / `--final` |

导演 phase 的输出是 `production.json` 的前半部分；builder 只在这个基础上做，不重新发明载体。

## 先判模式

| brief 里 | 模式 | 你先做什么 |
|---|---|---|
| `visual.mechanismSource = "user"` | Directed | 不换载体；给 2 种执行方式，选 1 种 |
| 只有 `visualProblem` + `candidateDirections` | Open | 提 2–3 个载体，至少 1 个不是 brief 里的；选 1 个 |

## 第 0 步：搜库

Director 先 `node tools/search-library.mjs "<关键词>"`，至少选 1 个 `remotion/library/templates/*.tsx`，写进
`production.json` 的 `library.used`。只写卡片不算用库。

## v1 硬门（只有这些）

1. `brief.ready.json` 通过转译校验；
2. `carrier` + `beats` + `timing`（hard anchors 对得上）；
3. 至少 1 个 visual probe；
4. `timing.animatic` 存在且 `status=measured`；
5. 至少 1 个 scene playable + QA frames/motion clips + `qa.finalVideo` 成片。

其余是建议：2 个方案、每 beat 2 解、director 块、library 必须用某个模板。

## 五个阶段

### G1 Carrier

- Directed：两种执行方式，写清“为什么不换用户载体”。
- Open：两个以上载体，至少一个不在 `candidateDirections` 里。
- 每个载体写：一句话、为什么能同时满足 mustAchieve、最大风险。
- 不写代码。

**门 1**：两个方案真的不同？有一个不是 brief 里的？选中的写了“为什么不是另一个”？

### G2 Beatboard

- 每个 beat 给 2 种视觉解法，选 1 种，写 rejected 的理由。
- **不写秒数**，不写“第几秒到第几秒”。
- 先杀默认：照片 + 推拉、大字卡、居中标题、纯光效、八个场景轮播。

**门 2**：每个 beat 有 2 种解法？至少 1 种不在 `mayUse` 里？有没有踩 `avoid`？

### G3 Animatic

- 480×270 / 12fps / 真实音乐或 VO；粗动画，不追求好看。
- 量每段实际需要多久；只保证 `timing.hardAnchors` 命中。
- 某段需要更久：砍内容、合并 beat、换载体；**不许用空镜/慢推/无意义停留填**。
- 写 `timing.json` / `production.json` 的 `timing`。

**门 3**：硬锚点命中？总时长成立？有没有一段靠 padding 撑？关掉声音还成立吗？

### G4 Build

- 先 3 镜 / 15–20s playable，确认载体、运动、字体、数据形态。
- 再写全片；`theme.ts` / `data.ts` / `lib.ts` 分离；所有段落时长集中在一个 `timing.ts`。
- 先写共享 primitive，但不要为了“组件化”把 600 行 scene 拆成 30 个空壳。

**门 4**：3 镜成立？运动连续？数据可读？有没有“stills 好看、一动就散”？

### G5 QA

- stills：每个 beat 至少 2 帧；关键转场拼 contact sheet。
- motion：每段渲 2–3s 低分辨率片段，看连续性。
- audio：时长、响度、声道、音画同步。
- data：每个数字对 source。

**门 5**：`acceptance` 每条成立？有没有黑帧/死帧/文字读不清/爆音？

## 输出

一个 `production.json`，结构见 `schema/production.schema.json`。最少包含：

- `mode` / `brief`；
- `carrier.options[]` + `chosen` + `whyChosen` + `risk`；
- `beats[]`：`order` / `mustAchieve` / `options[]` / `chosen` / `whyChosen` / `rejected`；
- `library`：`searched` + `used[]`（至少 1 个 template/scene，路径必须真实存在）；
- `timing`：`status` / `hardAnchors` / `sections` / `totalSeconds` / `paddingCheck`；
- `scenes[]`（G4 后）；
- `qa`（G5 后）。

## 硬规则

- 一个片一个载体；不是八个场景拼起来。
- 时间在 animatic 里量，不在 beatboard 里拍。
- 每个 beat 先给 2 种解法，再选。
- 先粗动画，后精修；不要先抛光 stills。
- 不把 `beats.visual` / `candidateDirections` 当必须复刻。
- 不用照片 + 推拉、大字卡、八个无关场景填时间。
- 不在 animatic 之前写最终 scene 代码。
- 检查：`node tools/check-production.mjs <production.json> --director`（必须有 library.used）；animatic 后 `--build`；交付前 `--final`。
