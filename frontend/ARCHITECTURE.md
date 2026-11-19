# ARCHITECTURE.md — 代码地图

本文只描述相对稳定的系统边界、目录职责与核心链路，帮助贡献者判断「一个改动应该落在哪里」。它不替代模块内的设计文档与源码注释；改动不熟悉的模块前，先读对应章节，再用符号搜索定位实现。

## 鸟瞰

FengMotion Desktop 是 AI 视频创作工作台（桌面优先）。当前形态：**可运行的前端 + 明确标注的演示适配器**；Agent 后端尚未接入，任务状态均为演示数据，不伪装真实执行。

前端为 React + TypeScript + Vite 单页应用（`src/`），共 8 个视图：

- 导航级（6）：首页 `Home`、我的创作 `WorkbenchCatalog`、工作流 `WorkflowGallery`、特效库 `FxLibrary`、参考片库 `RefLibrary`、我的素材 `Assets`
- 项目级（2）：制作工作台 `Workbench`、发布与验收 `RenderDelivery`
- 其中工作流、发布与验收、项目总览（`ProjectOverview`）当前以 iframe 装载 `public/replica/` 下的静态复刻页，是过渡形态，原生化路径见 [前端开发计划](docs/dev/开发进度.md)

创作管线位于 `workflow-v0.1.1/`，定义「怎么创作」；前端工作台是它的操作界面。工作流默认采用 Prompt-first，相关规格见 `docs/design/`。

## 目录职责

| 路径 | 职责 |
|---|---|
| `src/` | 前端应用，按业务模块组织（对照后端按领域分包），见下方「src 目录」 |
| `public/` | 随构建发布的静态资源。`public/replica/` 为 iframe 过渡页，禁止继续在其中堆新功能 |
| `docs/` | 文档站（GitHub Pages，`index.html` 为站点首页）与设计规格。`docs/design/` 设计规格（设计系统、工作流规格、知识库规格、导航图）；`docs/dev/` 开发文档（规范、进度、日志、协议、决策记录）；`docs/assets/`、`docs/media/` 站点素材 |
| `design/` | 设计稿与参考素材（截图、logo 等），不是代码，不进构建 |
| `workflow-v0.1.1/` | 当前 Agent 创作管线、工具和模板 |
| `.claude/` | 维护者的本地 Agent 配置，协作者勿改 |
| `.github/` | PR / Issue 模板 |

## src 目录

| 路径 | 职责 |
|---|---|
| `main.tsx`、`index.css` | 入口与全局样式（**token 的唯一事实来源是 `src/index.css`**） |
| `app/` | 入口组装（`App.tsx`）与应用壳：侧栏导航、资源库抽屉 |
| `features/<模块>/` | 业务模块：`chat` 对话、`workbench` 工作台、`scene-editor` 场景编辑器、`workflow` 工作流、`assets` 素材、`fx` 特效库、`reference` 参考片库、`project` 项目、`creation` 创作任务、`home` 首页、`settings` 设置、`harness` 引擎。模块根目录放页面组件，内部按 `components/`、`hooks/`、`model/`（纯逻辑与类型）、`services/`、`styles/` 分。子目录按职责命名，不按「从哪个页面拆出来」命名（例如工作台 hooks 分 `session/`、`submit/`、`stage/`、`target/`、`review/`）；不是 hook 的普通函数放 `services/` 或 `model/`，样式统一放 `styles/` |
| `api/` | 后端接口客户端，一个文件对应后端一个模块；`contracts.ts` 是契约类型的统一入口，内容按领域拆在 `api/types/` |
| `shared/` | 跨模块复用：`ui/`（shadcn）、`icons/`、`components/`、`navigation/`、`local-documents/`、`pick-mode/`、`lib/`、`vendor/` |
| `demo/` | 占位演示数据，见 `CLAUDE.md`「动手前必读」第 1 条 |
| `styles/` | 全局样式：token、品牌、图标、页面骨架 |
| `remotion/shims/`、`fx-original/` | Remotion 依赖替身；特效库原片快照（不参与类型检查） |

**依赖方向**：`features/` 可以引用 `api/`、`shared/` 和其他模块；`api/`、`shared/` 不引用 `features/`。只被一个模块用到的代码放进那个模块。

**样式引入顺序**：`index.css` 里各模块样式的引入顺序决定层叠，移动文件时只改路径、不调顺序。

## 核心链路与边界

- **数据唯一入口**：视图不直接拼数据，一律经 `src/api/`（含 `studioApi`）；真实后端未接入前由演示适配器实现，UI 必须显式标注 Demo。细则见 [前后端协议](docs/dev/前后端协议.md)。
- **范式层与通用层**：当前视频范式（场景/镜头等概念）是实现层，不是产品地基；通用层（项目、任务、产物、检查）不得反向依赖范式概念。既有约定以根目录 `CLAUDE.md` 与 `docs/页面职责合同.md`、`docs/UI实现规范.md` 为准。
- **样式边界**：颜色/字体/间距/圆角只准引用 token；每页私有一套大 CSS 是已知待治理问题，迁移路线见开发进度 04 期。

## 事实来源速查

- 产品/设计规格：`docs/design/`、`docs/页面职责合同.md`
- 开发流程与规范：[docs/dev/](docs/dev/README.md)
- Agent 管线：`workflow-v0.1.1/README.md` 起读
- 给 AI 的工作约定：`CLAUDE.md`

### 工作台本地审阅（2026-10-29）

`features/workbench/services/workbenchReviewService.ts` 按项目保存本地原始需求、纠正、特别保留要求和意见快照；`features/workbench/hooks/useWorkbenchReview.ts` 管理用户标记与保存失败状态。`features/workbench/components/WorkbenchReviewDesk.tsx` 提供要求/意见/版本的按需面板，`WorkbenchPreviewCompare.tsx` 只比较现有真实文件。该链路不生成媒体，也不把用户标记当作检查运行。Remotion 原有参数编辑仍在工作台内按需打开。


### 工作台场景编辑器（2026-10-29）

`src/features/scene-editor/` 负责本机场景文档、属性面板、双引擎预览与导出，替换旧 `EditableShot` 标题覆盖层。`SceneDocument` 的图层描述通过同一个 `SceneComposition` 驱动 Remotion Player 与浏览器渲染器；素材复用 assetService 的 IndexedDB。HTML 引擎仅执行 `public/editor-sources/` 中已绑定、带原始 SHA-256 的源快照，元素修改作为独立覆盖记录，保留原 GSAP 时间轴。

`render.ts` 把真正生成的文件存入素材库，独立记录本机导出版本，再以 `origin: editor` 提供工作台预览；不制造工作流执行记录。HTML 支持工程包导出，尚不支持本机视频编码；这不是完整 Remotion Studio，也不导入任意 TSX 项目。详细验证及能力边界见 [场景编辑器验收记录](docs/ui-review/source-editor/README.md)。
