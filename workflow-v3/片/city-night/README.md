# 《当城市进入夜晚》· 工程说明

## 合成

| 项 | 值 |
|---|---|
| Composition id | `CityNightFilm` |
| 分辨率 / 帧率 | 1920×1080 / 30fps |
| 时长 | 2134 帧 = 71.13s |
| 入口 | `remotion/index.ts` |
| 注册 | `remotion/Root.tsx` |
| 组件树 | `remotion/city-night/CityNight.tsx` |
| 场景 | `remotion/city-night/scenes/*.tsx` |
| 规格 | `workflow-v3/片/city-night/scene.spec.json` |
| 音频 | `public/city-night/mix.m4a`（人声 + 环境铺底） |
| 字幕 | 由 `public/city-night/timing.json` 的 24 条 cue 驱动 |

## 命令

```bash
cd /home/lufering/remotion/electron

# 类型
npx tsc --noEmit

# 规格校验
node workflow-v3/片/city-night/validate-scene.mjs

# 单帧
npx remotion still remotion/index.ts CityNightFilm out/f1300.png --frame=1300

# 预览
npx remotion render remotion/index.ts CityNightFilm out/preview.mp4 --scale=0.5

# 成片
npx remotion render remotion/index.ts CityNightFilm out/city-night-final.mp4
```

## 音频生成

- 旁白：Edge TTS（`zh-CN-YunxiNeural`，rate -8%，pitch -2Hz），逐句合成，词边界用于字幕对齐。
- 铺底：numpy 程序化和弦垫（A 小调 → C 大调），55.8s 处日出渐强。
- 混音：ffmpeg `sidechaincompress` + `loudnorm I=-16`。
- 产物：`public/city-night/vo.wav`、`music.wav`、`mix.m4a`、`vo-lines.json`、`timing.json`。

## 注意

- 所有随机都用 `rngFor()` / `mulberry32` 固定种子，组件内没有 `Math.random`。
- 总时长只在 `Root.tsx` 给一次；场景帧数见 `scene.spec.json`。
- 画面素材只有 `grain.png` 与音频；没有照片/外部视频，避免素材轮播。
