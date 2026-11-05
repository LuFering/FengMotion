# Builder Phase · 执行

> 你只读 `brief.ready.json` + `production.json` 的导演前半部分 + 代码库。
> 你不回看原始字幕、聊天记录、`input.md`。
> 你不重新发明载体；如果载体做不出来，写 `pushback` 回导演，不要静默替换。

## 进入条件

- `node tools/check-production.mjs <production.json> --director` 已通过；
- `director.buildabilityRisks` / `questionsForBuilder` 已读；
- 你知道哪些是硬锚点、哪些是软目标。

## 先接库

- `library.used` 里的模板必须真的 import 并渲染 `<Template>`；只 import 不算；
- 在 `scenes[].library` 记录用了哪个模板、哪个文件、怎么改的；
- `scenes[].file` 写 scene 源码路径；
- 模板默认色/字体/文案必须改成 brief 的，不能直接复制；
- 如果模板做不出来，写 `pushback`，不要静默改成自己手写/照片+推拉。

## 进入 G3 前

- 至少 1 个 visual probe（still 或 2s clip），路径写进 `probes[]`；
- `timing.animatic` 指向真实 animatic 文件；
- `library.decision` 已写：`used` 或 `rejected` + 理由。

## G3 · Animatic

- 480×270 / 12fps / 真实音乐或 VO；
- 用占位/粗动画把整片跑一遍；
- 量每段实际需要多久，写进 `timing.sections[].seconds`；
- 只保证 `brief.timing.hardAnchors` 命中；
- 某段太长：砍内容/合并 beat；某段太短：不要加空镜/慢推；
- 把 `timing.status` 改成 `measured`。

## G4 · Build

- 先 3 镜 / 15–20s playable，验证载体、运动、字体、数据形态；
- 再写全片；`theme.ts` / `data.ts` / `lib.ts` 分离；
- 所有段落时长集中在一个 `timing.ts`，不要散落在每个 scene；
- 先写共享 primitive，但不要为了组件化把 600 行 scene 拆成 30 个空壳。

## G5 · QA

- 每个 beat 至少 2 帧；
- 每段 2–3s motion clip；
- 音频时长/响度/同步；
- 数据对 source；
- 写 `qa.frames` / `qa.motionClips` / `qa.issues` / `qa.acceptance`。

## 门

```bash
node tools/check-production.mjs <production.json> --build
node tools/check-production.mjs <production.json> --final
```

`--build` 要求 `timing.status=measured` + `scenes` + `probes` + `timing.animatic`；`library.decision=used` 时才查模板。
`--final` 还要求 `qa.frames` / `qa.motionClips` / `qa.finalVideo`，且源码里真的渲染了模板。

## Pushback

如果导演选的载体在 Remotion 里做不出来：

1. 不要静默换成照片+推拉/光点/大字卡；
2. 在 `production.json` 里加 `pushback`（问题、证据、替代方案）；
3. 回到 Director Phase，重新选载体或改 beat；
4. `pushback.status=applied` 必须有 `resolution` + `approvedBy`，否则 `--build` 会拒绝；不能自己批准自己。
4. 重新过 `--director` 门。
