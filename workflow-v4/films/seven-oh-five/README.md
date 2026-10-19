# 《七点零五分》 / seven-oh-five

66 秒 / 1920×1080 / 30fps / 静默片。

## 文件

- `brief.ready.json` — 转译层合同，已过 `validate-brief.mjs`
- `production.json` — 制作层合同，已过 `--build` / `--final`
- `animatic.mp4` — 480×270 / 12fps / 66.17s
- `qa/frames/` — 16 张成片抽帧（每个 beat 2 张）
- `qa/motion/` — 6 段 3 秒运动片段
- `qa/contact-sheet.png` — 16 格接触表

## 成片

`~/remotion/electron/out/seven-oh-five.mp4`

## 重渲

```bash
cd ~/remotion/electron
npx remotion render remotion/index.ts SevenOhFive out/seven-oh-five.mp4 --concurrency=$(nproc) --crf 18
```

## 门

```bash
cd ~/remotion/electron/workflow-v4/translation
node tools/validate-brief.mjs ../films/seven-oh-five/brief.ready.json
cd ../production
node tools/check-production.mjs ../films/seven-oh-five/production.json --final
```

## 已知边界

- 最后一拍不出现手：按 `brief.acceptance` 第 5 条，用 1.4 秒轻虚焦完成放杯。
- 静默片，无音轨；用户没有给音乐或旁白。
- 门外街景是虚化的街道语义（路面、路缘、建筑底、自行车、行人剪影），不是实拍街。
- 拉花近景是风格化微距，不是实拍质感。
