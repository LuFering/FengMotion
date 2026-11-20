# FengMotion 桌面应用

本目录维护 Electron 桌面壳、打包配置和安装脚本。应用界面与静态资源在 [frontend/](../frontend/README.md)，后端在 [backend/](../backend/README.md)。已有 Linux AppImage、Windows NSIS / portable 和 macOS DMG / ZIP 配置；2026-11-20 这轮安装态验证覆盖本机 Linux，其他平台不据此宣称已通过。实际发布资产以 [Releases](https://github.com/LuFering/FengMotion/releases) 为准。

## 开发与打包

需要 Node.js、Java 21、Maven 和 jlink。先安装前端与桌面端各自的依赖：

```bash
cd frontend && npm install
cd ../desktop && npm install
```

在 `desktop/` 中执行：

```bash
npm run build:shell    # 编译 Electron 主进程与 preload
npm run resources      # 准备后端、Java、Remotion、工作流和媒体工具
npm run dist:linux     # 构建前端并打包 Linux AppImage
```

产物位于 `desktop/release/`。真实创作还需要 DSH、模型、Node.js 及渲染环境；构建通过不等于跨机器安装或成片质量已验收。详见[桌面打包与更新](../frontend/docs/dev/桌面打包与更新.md)。

当前轨道实现依赖 `resources/remotion/timeline.mjs`。更新已安装应用时，需要对齐前端、后端 JAR 与渲染脚本；`deploy-desktop.mjs --dist` 只部署前端，不会更新后端。每轮实际更新范围记入 [项目进度](../PROGRESS.md)。

## 目录

- `electron/`：窗口、系统集成、后端进程与更新。
- `scripts/`：构建、资源准备、图标、安装及部署脚本。
- `electron-builder.config.mjs`：桌面应用打包配置。
- `build/`、`release/`：本地生成的图标与安装包，不纳入版本控制。

## 实时预览运行时增量（2026-11-20）

资源准备脚本会将 `../frontend/live-preview/` 复制到 `electron/resources/live-preview/`，并把预览需要的 Player、esbuild、Babel、React/ReactDOM 显式放入与渲染共用的 `remotion/node_modules/`。Electron 启动 Java 时传入预览目录和共享依赖的绝对路径；发行包和本机安装脚本都包含预览目录。Node 可执行文件仍沿用 `fengmotion.remotion.node`，此次没有内置另一份 Node 或 Vite。

开发态只验证了壳构建、资源目录复制后的实际预览脚本启动和后端进程生命周期。完整安装包实测尚未完成。接口与配置见 [live-preview.md](../frontend/docs/contracts/live-preview.md)。
