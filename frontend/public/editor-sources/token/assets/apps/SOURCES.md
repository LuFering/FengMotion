# 应用图标来源

用于 s29 / s30 那一排 AI 应用图标。

**全部取自 App Store 官方 512×512 图标**（通过 iTunes Search API 拿到的
`artworkUrl512`），不是自己画的、也不是低清 favicon。

| 文件 | 应用 | App Store 名称 |
|---|---|---|
| `doubao.png` | 豆包 | 豆包 - 生活工作 AI 助手 |
| `qwen.png` | 通义千问 | 千问 - 阿里 AI 助手 |
| `deepseek.png` | DeepSeek | DeepSeek |
| `zhipu.png` | 智谱清言 | 智谱清言 |
| `kimi.png` | Kimi | Kimi |
| `yuanbao.png` | 腾讯元宝 | 元宝 - 腾讯全能 AI 助手 |
| `spark.png` | 讯飞星火 | 讯飞星火 - 懂你的 AI 助手 |
| `wenxin.png` | 文心一言 | 文心 - 百度旗下全能 AI 助手 |

## 怎么重新获取

```bash
curl -sL "https://itunes.apple.com/search?term=<应用名>&entity=software&country=cn&limit=1" \
  | python3 -c "import json,sys; print(json.load(sys.stdin)['results'][0]['artworkUrl512'])"
```

拿到 URL 后把 `512x512bb` 保留，直接下载即可。

## 用法

⚠️ **App Store 的图标自带圆角和底色**，所以合成里**不再套品牌色底**
（套了会双重圆角）。直接 `object-fit: cover` 铺满容器，照 App Store 的做法。

```css
.app { width:168px; height:168px; border-radius:38px; overflow:hidden; }
.app img { width:100%; height:100%; object-fit:cover; }
```

## 注意

- 这些是各家商标，仅用于**说明性引用**（"这是哪家产品"），
  不是背书或合作。
- 换图标后**必须重渲 s29 和 s30 两镜**（它们共用同一套图标与坐标）。
