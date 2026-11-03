# ARCHITECTURE.md — 代码地图

本文只描述相对稳定的系统边界、目录职责与核心链路，帮助贡献者判断「一个改动应该落在哪里」。它不替代模块内的设计文档与源码注释；改动不熟悉的模块前，先读对应章节，再用符号搜索定位实现。

## 鸟瞰

FengMotion Desktop 是 AI 视频创作工作台（桌面优先）。当前形态：**可运行的前端 + 明确标注的演示适配器**；Agent 后端尚未接入，任务状态均为演示数据，不伪装真实执行。

前端为 React + TypeScript + Vite 单页应用（`src/`），共 8 个视图：

- 导航级（6）：首页 `Home`、我的创作 `WorkbenchCatalog`、工作流 `WorkflowGallery`、特效库 `FxLibrary`、参考片库 `RefLibrary`、我的素材 `Assets`
- 项目级（2）：制作工作台 `Workbench`、发布与验收 `RenderDelivery`
- 其中工作流、发布与验收、项目总览（`ProjectOverview`）当前以 iframe 装载 `public/replica/` 下的静态复刻页，是过渡形态，原生化路径见 [前端开发计划](docs/dev/开发进度.md)

创作管线（Agent 工作流）以版本目录形式存放在仓库根：`workflow-v2` … `workflow-v5`（当前 v5，v0.5.14.2）。工作流定义「怎么创作」，前端工作台是它的操作界面；两者的对象模型差异（v5 已非镜头中心、工作台仍是）是当前前端改造的背景，见 `docs/design/` 下各规格。

## 目录职责

| 路径 | 职责 |
|---|---|
| `src/` | 前端应用。`views/` 页面级视图；`components/` 通用与业务组件（`ui/`、`icons/`）；`shell/` 应用壳（导航、顶栏）；`services/` 数据入口层（studioApi 在此，见协议文档）；`data/` 前端数据与 fixture；`hooks/`、`lib/` 工具；`remotion/` Remotion 相关；`styles/` 与 `index.css` 样式与 token（**token 的唯一事实来源是 `src/index.css`**） |
| `public/` | 随构建发布的静态资源。`public/replica/` 为 iframe 过渡页，禁止继续在其中堆新功能 |
| `docs/` | 文档站（GitHub Pages，`index.html` 为站点首页）与设计规格。`docs/design/` 设计规格（设计系统、工作流规格、知识库规格、导航图）；`docs/dev/` 开发文档（规范、进度、日志、协议、决策记录）；`docs/assets/`、`docs/media/` 站点素材 |
| `design/` | 设计稿与参考素材（截图、logo 等），不是代码，不进构建 |
| `workflow-v2` … `workflow-v5` | Agent 创作管线各版本。旧版本只读存档，不再修改；新版本以新目录开启 |
| `.claude/` | 维护者的本地 Agent 配置，协作者勿改 |
| `.github/` | PR / Issue 模板 |

## 核心链路与边界

- **数据唯一入口**：视图不直接拼数据，一律经 `src/services/` 的 studioApi 层；真实后端未接入前由演示适配器实现，UI 必须显式标注 Demo。细则见 [前后端协议](docs/dev/前后端协议.md)。
- **范式层与通用层**：当前视频范式（场景/镜头等概念）是实现层，不是产品地基；通用层（项目、任务、产物、检查）不得反向依赖范式概念。既有约定以根目录 `CLAUDE.md` 与 `docs/页面职责合同.md`、`docs/UI实现规范.md` 为准。
- **样式边界**：颜色/字体/间距/圆角只准引用 token；每页私有一套大 CSS 是已知待治理问题，迁移路线见开发进度 04 期。

## 事实来源速查

- 产品/设计规格：`docs/design/`、`docs/页面职责合同.md`
- 开发流程与规范：[docs/dev/](docs/dev/README.md)
- Agent 管线：`workflow-v5/README.md` 起读
- 给 AI 的工作约定：`CLAUDE.md`

### 工作台本地审阅（2026-10-29）

`services/workbenchReviewService.ts` 按项目保存本地原始需求、纠正、特别保留要求和意见快照；`hooks/useWorkbenchReview.ts` 管理用户标记与保存失败状态。`views/WorkbenchReviewDesk.tsx` 提供要求/意见/版本的按需面板，`WorkbenchPreviewCompare.tsx` 只比较现有真实文件，`PreviewReviewTools.tsx` 将真实媒体时间范围带回修改意见。该链路不生成媒体，也不把用户标记当作检查运行。Remotion 原有参数编辑仍在工作台内按需打开。


### 工作台场景编辑器（2026-10-29）

`src/editor/` 负责本机场景文档、属性面板、双引擎预览与导出，替换旧 `EditableShot` 标题覆盖层。`SceneDocument` 的图层描述通过同一个 `SceneComposition` 驱动 Remotion Player 与浏览器渲染器；素材复用 assetService 的 IndexedDB。HTML 引擎仅执行 `public/editor-sources/` 中已绑定、带原始 SHA-256 的源快照，元素修改作为独立覆盖记录，保留原 GSAP 时间轴。

`render.ts` 把真正生成的文件存入素材库，独立记录本机导出版本，再以 `origin: editor` 提供工作台预览；不制造工作流执行记录。HTML 支持工程包导出，尚不支持本机视频编码；这不是完整 Remotion Studio，也不导入任意 TSX 项目。详细验证及能力边界见 [场景编辑器验收记录](docs/ui-review/source-editor/README.md)。
