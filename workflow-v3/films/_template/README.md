# 新片模板

## 用法

```bash
cd ~/remotion/electron
cp -r workflow-v3/films/_template workflow-v3/films/<片名>
```

然后按顺序填：

1. `00-开工.md`：模型、读过什么、范围、画幅；
2. `01-reference.md`：参考时间码、2–3 个方向、选定；
3. `reference-log.json`：搜过哪些词、打开哪 3 张卡/组件、抽了哪 1 帧参考；
4. `02-scene.spec.json`：`filmId` 必须等于目录名；每场 `source` / `assetStrategy` / `motionPlan` / `eventFrames`；
5. `03-component-contracts.md`：每个组件的 props、来源、事件、验收帧；
6. `style-fingerprint.json`：底色/构图/运动机制/主体/密度（和上一片重合 ≥3 项要写 `style-diversity.md`）；
7. `keyframes/`：2–3 张关键画面；
8. `approved.md`：用户对关键画面的原话；
9. 成片后填 `04-acceptance.md` / `05-visual-review.md` / `deliver.json`。

## 门 0

```bash
node workflow-v3/tools/check-precode.mjs --film workflow-v3/films/<片名>
```

通过之前，`components/` 里不许有 `.tsx`。

## 之后

```bash
node workflow-v3/tools/validate-scene.mjs --film workflow-v3/films/<片名>
node workflow-v3/tools/check-deliver.mjs --film workflow-v3/films/<片名>
npx tsc --noEmit
npx remotion still <entry> <CompositionId> out/f.png --frame=<N>
npx remotion render <entry> <CompositionId> out/preview.mp4 --scale=0.5
```
