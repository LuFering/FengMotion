# 音频提取

> 音频能提供“多快/什么时候重/有没有人声”，不能提供“画面长什么样”。

| 维度 | 怎么测 |
|---|---|
| BPM | librosa.beat.beat_track / aubio |
| 节拍网格 | beat frames → 秒 |
| 能量曲线 | RMS，按 0.5s 窗口 |
| 人声 | 有/无；有的话 ASR 转写、词级时间戳 |
| 同步点 | 重音、停顿、副歌起点、人声起句 |
| 调性/情绪 | 大调/小调、明亮/低沉（辅助，不作为硬约束） |

## 做法

```bash
ffprobe -v error -show_entries format=duration -of csv=p=0 audio.wav
# 需要时用 python + librosa（没有就装 uv venv）
```

- BPM 写整数；
- `syncPoints` 写秒，不写“高潮处”；
- 有配音时，把每句起止写进 `content.beats` 或 `audio.syncPoints`；
- 不要把 BGM 的“感觉”写成画面风格。

## 输出

- `audio.bpm` / `audio.vo` / `audio.syncPoints`
- 有旁白时：`content.beats` 按句子/语义分，不按镜头分。
