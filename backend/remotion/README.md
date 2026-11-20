# Remotion 渲染运行时

此目录由桌面打包脚本直接复制到运行资源中，保留两个渲染入口及一个共用实现。

| 文件 | Java 调用方 | 输入 |
|---|---|---|
| `render.mjs` | `render.service.RemotionRenderer` | 内置 `Film` 和场景 props，入口在本目录 `src/` |
| `render-project.mjs` | `render.service.ProjectFilmRenderer` | Agent 编写的项目源码，由项目配置声明 entry 和 composition |
| `render-shared.mjs` | 上述两个脚本 | 共用依赖解析、浏览器选择、临时目录和输出协议 |
| `timeline.mjs` | 共用渲染流程 | 在实际渲染帧中采集序列、嵌套与条件挂载，返回轨道清单 |
| `shot-assembly.mjs` | 项目渲染入口 | 从 Java 验证的镜头清单生成临时入口和稳定镜头轨道 |

两条路径仍有调用方，不应只打包其中一个。Java 的 `creation.service.ProjectCreationService` 负责把源码创作、渲染和版本登记串起来；Node 脚本不承担业务状态转换。

## 依赖与浏览器

开发态复用前端 `node_modules`，由 `FENGMOTION_NODE_MODULES` 或打包资源配置指定，不在每个视频项目中重复安装。项目保存自己的源码、素材和 `film.config.json`。

`FENGMOTION_CHROME` 可以指定 Chromium。未指定时沿用 Remotion 的浏览器选择或下载行为；`.cache/`、`.remotion/` 是忽略的本机缓存，不打进桌面安装资源。本轮目录整理不删除或移动这些缓存。

## 调用与协议

```bash
node render.mjs --props /tmp/film.json --out /tmp/film.mp4
node render-project.mjs --project /path/to/project --entry src/index.tsx --composition Main --out /tmp/project.mp4
node render-project.mjs --project /path/to/snapshot --entry src/index.tsx --composition Main --timeline-only true
```

stdout 返回单行 JSON 结果，stderr 为进度或诊断。超时、取消、进程树清理和版本保存由 Java 调用层负责。渲染成功只能说明脚本生成了产物，画面仍需审片确认。

结果中的 `sequences` 使用 schemaVersion 2，帧率保留小数，片段时间以秒表示。采集不完整或超出 60 轨/400 片段时返回 `detail: limited` 的成片轨并记录诊断，不把部分采集冒充完整轨道。Java 在视频旁保存绑定路径和视频 SHA-256 的隐藏清单；历史恢复使用对应源码快照和 `--timeline-only`，不生成新 MP4。桌面资源必须包含 `timeline.mjs` 与相同版本的 Remotion 运行依赖。

[`shot-timeline-v1`](../docs/shot-timeline.md) 仍由 `render-project.mjs` 接入，不另建进程接口；它的运行入口由后端在临时目录生成，轨道来自已校验的装配清单，不依赖运行时临时序列 ID。
