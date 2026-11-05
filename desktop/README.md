# FengMotion 桌面端

桌面端包含首页、创作工作台、素材与参考管理、工作流界面和 Electron 外壳。项目整体介绍与运行条件见[仓库首页](../README.md)。

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
| `src/views/` | 首页、工作台、资源库及工作流页面 |
| `src/components/` | 公共组件与资源选择器 |
| `src/services/` | 前端服务、工作流逻辑及后端接口 |
| `src/shell/` | 导航、对话与应用状态 |
| `src/editor/`、`src/remotion/` | 编辑与预览相关代码 |
| `electron/` | 桌面窗口、后端启动与更新 |
| `public/` | 应用需要的静态资源与示例 |
| `workflow-v5/` | 当前创作方法、模板、工具与评估计划 |
| `workflow-v2/`–`workflow-v4/` | 历史工作流资料，保留供回顾 |
| `docs/` | 设计、接口、开发记录与界面评审 |
| `design/` | 设计素材与早期页面探索 |

Linux 应用打包详见[桌面打包与更新](docs/dev/桌面打包与更新.md)。当前版本仅配置 Linux AppImage；构建包不等于已在其他机器完成安装验收。

## 协作

界面变更先参考[前端设计原则](docs/design/前端设计原则与已确认界面.md)与[开发协作规范](docs/dev/前端开发者协作规范.md)。更多协作信息见[参与开发](CONTRIBUTING.md)。
