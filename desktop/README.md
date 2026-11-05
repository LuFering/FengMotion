# FengMotion 桌面应用

本目录维护 Electron 桌面壳、打包配置和安装脚本。应用界面与静态资源在 [frontend/](../frontend/README.md)，后端在 [backend/](../backend/README.md)。目前配置的是 Linux x86_64 AppImage；Windows 和 macOS 尚未配置或验证。

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
npm run dist           # 构建前端并打包 Linux AppImage
```

产物位于 `desktop/release/`。真实创作还需要 DSH、模型、Node.js 及渲染环境；构建通过不等于跨机器安装或成片质量已验收。详见[桌面打包与更新](../frontend/docs/dev/桌面打包与更新.md)。

## 目录

- `electron/`：窗口、系统集成、后端进程与更新。
- `scripts/`：构建、资源准备、图标、安装及部署脚本。
- `electron-builder.config.mjs`：桌面应用打包配置。
- `build/`、`release/`：本地生成的图标与安装包，不纳入版本控制。
