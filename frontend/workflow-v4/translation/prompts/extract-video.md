# 视频提取

> 视频能提供“怎么动/多快/怎么接”，不能提供“为什么讲这个”。

| 维度 | 怎么测 |
|---|---|
| 镜头长度 | 切点检测，算平均/最短/最长 |
| 运镜 | 抽帧看位移/缩放/旋转；分固定/推拉/横移/手持 |
| 转场 | 硬切/叠化/遮罩/同元素贯穿 |
| 色板 | 3–5 个关键帧取 hex |
| 信息密度 | 每屏文字/元素数量 |
| 节奏 | 切点间隔曲线；快慢段 |
| 音频 | 单独走音频提取 |

## 做法

```bash
# 切点
ffmpeg -i ref.mp4 -vf "select='gt(scene,0.35)',showinfo" -f null - 2>&1 | grep showinfo
# 抽帧
ffmpeg -ss <t> -i ref.mp4 -frames:v 1 refs/ref-<t>.png
```

- 至少抽 5 帧，覆盖开头/中段/结尾；
- 每帧用 vision 看构图/色板/文字；
- 写时间码，不写“大概”。

## 输出

- `visual.references[]`：`{type:"video", path, timecode, what}`
- `visual.mechanism` / `camera`：只写你**测到**的，不写“电影感”。
