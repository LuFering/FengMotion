# FengMotion 前端

前端包含首页、创作工作台、素材与参考管理和工作流界面。Electron 桌面壳与打包配置位于 [desktop/](../desktop/README.md)。项目整体介绍与运行条件见[仓库首页](../README.md)。

## 开发

需要 Node.js 20.19+ 或 22.12+。先启动 [后端](../backend/README.md)，再在本目录运行：

```bash
npm install
npm run dev
```

默认开发地址为 `http://localhost:5173`。真实 AI 创作还需要本机 DSH、可用模型和渲染环境；部分工作流节点仍是界面快照。

```bash
npm run build     # TypeScript 检查与生产构建
npm run lint      # 静态检查
```

## 目录

| 目录 | 内容 |
| --- | --- |
| `src/app/` | 入口组装与应用壳（导航、资源库抽屉） |
| `src/features/` | 按业务分的功能模块：对话、工作台、场景编辑器、工作流、素材、特效库、参考片库、项目、创作任务、首页、设置、引擎 |
| `src/api/` | 后端接口客户端与契约类型（`api/types/` 按领域拆分） |
| `src/shared/` | 跨模块复用：shadcn 组件、图标、通用组件、导航、工具 |
| `src/demo/` | 占位演示数据（不是工作流的内容模型） |
| `src/styles/`、`src/index.css` | 全局样式与 token |
| `public/` | 应用需要的静态资源与示例 |
| `workflow-v0.1.1/` | 当前创作方法、模板、工具与评估计划 |
| `docs/` | 设计、接口、开发记录与界面评审 |
| `design/` | 设计素材与早期页面探索 |

应用打包详见[桌面说明](../desktop/README.md)。已有多平台配置；2026-11-20 这轮桌面验证覆盖本机 Linux，构建配置不等于其他机器或平台已验收。当前功能与限制见 [项目进度](../PROGRESS.md)。

## 协作

界面变更先参考[前端设计原则](docs/design/前端设计原则与已确认界面.md)与[开发协作规范](docs/dev/前端开发者协作规范.md)。更多协作信息见[参与开发](CONTRIBUTING.md)。
