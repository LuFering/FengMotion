# 统一 Remotion 渲染工程

所有项目共用这一个工程。项目之间的差异通过 props（场景 JSON）表达，不各自建工程。

## 为什么统一

- 每个项目单独装一套 Remotion 依赖，磁盘与安装时间随项目数线性增长
- 版本容易漂移，出问题难定位
- AI 只需要产出一份**场景数据**，不需要理解工程配置

## AI 生产什么

一份 JSON：

```json
{
  "width": 1280, "height": 720, "fps": 30,
  "backgroundColor": "#0b1220", "color": "#ffffff",
  "scenes": [
    { "id": "s1", "text": "标题", "subtitle": "副标题",
      "durationSeconds": 2, "textAnimation": "fade" },
    { "id": "s2", "text": "第二幕", "backgroundColor": "#1d4ed8",
      "durationSeconds": 2, "textAnimation": "slide", "transition": "fade" }
  ]
}
```

字段刻意用视觉意图命名（text / backgroundColor / transition），不用 Remotion 术语 ——
换渲染器时这份数据依然成立。

| 字段 | 取值 | 说明 |
|---|---|---|
| `textAnimation` | fade / slide / none | 文字进场方式 |
| `transition` | cut / fade | 进入本场景的转场，首个场景忽略 |
| `backgroundImage` | 相对路径或 http | 与 backgroundColor 同时给时图片优先 |

## 怎么渲染

由后端 `RemotionRenderer` 以子进程调用：

```
node render.mjs --props <临时json> --out <产物路径> --browser <chromium路径>
```

stdout 输出一行 JSON 结果，stderr 为渲染进度。

## 依赖从哪来

**不在这里 npm install。** Remotion 全家桶几百 MB，再装一份是浪费。
默认复用仓库的 `frontend/node_modules`，可用 `FENGMOTION_NODE_MODULES` 覆盖。

## 浏览器

渲染要 Chromium 逐帧截图。默认用 `/opt/google/chrome/chrome`（配置项
`fengmotion.remotion.browser`）。留空则 Remotion 会自行下载 chrome-headless-shell（约 92MB）。

## 实测

| 场景 | 结果 |
|---|---|
| 命令行直跑 | 640x360 / 90 帧 / 3.05 秒 / 168KB |
| 经 API 触发 | 1280x720 / 120 帧 / 4.05 秒 / 286KB，耗时 15.5 秒 |
| 浏览器播放 | readyState=4，无错误 |

## 已知限制

- **同步渲染**：请求会阻塞到出片。接入任务域后应改为「提交返回 taskId，进度走事件流」。
- **单并发**：同时两个渲染请求会各起一个 Chromium 进程，内存压力大，目前没有队列。
- **无音频**：场景数据里没有音轨字段，成片是静音的。
