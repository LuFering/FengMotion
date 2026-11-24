# 后端架构与目录归属

本文件描述当前代码组织，更新于 2026-11-20。整体进度和验证范围见 [PROGRESS.md](../PROGRESS.md)，专题与历史记录见 [docs/README.md](docs/README.md)。

完整的运行链路、接口/数据地图、并发边界与缺口见 [SYSTEM_MAP.md](SYSTEM_MAP.md)；后续功能、优化、文档和测试的开发方法见 [DEVELOPMENT.md](DEVELOPMENT.md)。本页继续维护目录和职责约定，避免重复充当接口规范。

## 运行边界

后端是 Java 21 / Spring Boot 模块化单体，使用 SQLite，默认监听 `127.0.0.1:8080`，API 前缀为 `/api`。Java 负责业务编排与持久化，Node.js / Remotion 负责渲染，DSH 和本机原生引擎负责模型执行。

目录重构不更改 HTTP 路径、JSON 字段、数据库表、项目目录或配置名称。`/api/projects/{projectId}/workflow/*` 是已公开的路由，按职责由 `workflow.api` 和 `creation.api` 分别处理。

## 根目录

```text
backend/
├── src/main/java/com/fengmotion/server/   按业务职责划分的 Java 模块
├── src/main/resources/                  配置、建表 SQL、打进 JAR 的模型桥接资源
├── src/test/java/                       与生产包对应的单元和接口测试
├── src/test/                            Node.js 桥接插件测试
├── remotion/                            两类渲染入口及共用实现
├── dsh-plugin/                          独立于 JAR 的实时流桥接插件
├── docs/                                当前说明与历史记录索引
├── pom.xml
├── README.md
└── ARCHITECTURE.md
```

`target/`、`remotion/.cache/`、`remotion/.remotion/` 是已忽略的本机生成数据；它们不属于源码。`_wip/` 是已忽略的本机草稿目录，不参与编译或打包。本次不删除这些内容，也不改变桌面打包脚本引用的运行时目录。

## 业务模块

| 包 | 当前职责 | 关键入口 |
|---|---|---|
| `project` | 项目元数据、目录、工程配置、源码指纹、快照与恢复、同项目互斥 | `ProjectService`、`ProjectFilmConfig`、`ProjectSourceSnapshots`、`SceneVersionService` |
| `workflow` | 原始需求、纠正、工作稿和 Prompt-first 上下文 | `WorkflowProjectController`、`WorkflowProjectService`、`WorkflowDraftService` |
| `creation` | 异步创作请求、Agent 修改源码、资源上下文、参考检索、候选稿、渲染与版本提交的编排 | `CreationController`、`CreationJobController`、`CreateAgentRunner`、`CreationReferenceService`、`ProjectCreationService`、`ProjectFilmRenderService`、`SceneElementEditService`、`ShotCandidateService`、`CreationJobs` |
| `render` | Remotion 子进程适配、超时、进程清理、渲染输入输出 | `ProjectFilmRenderer`、`RemotionRenderer`、`RenderController` |
| `artifact` | 项目产物读取、下载与路径边界 | `ArtifactController` |
| `task` | 原有场景数据修改/渲染任务、事件、取消和恢复 | `TaskService`、`ModifyTaskRunner`、`RenderTaskRunner` |
| `chat` | 会话、消息、回复生命周期、阶段流与会话归属 | `ChatTurns`、`ChatStreamService`、`CreationSessionBridge` |
| `harness` | 执行引擎、模型目录、DSH 协议与进程适配 | `HarnessService`、`DshSdkSession`、`NativeHarnesses` |
| `skill` | Skill 包导入、静态清单、文件引用和依赖识别 | `SkillPackageService`、`SkillInventoryScanner` |
| `preset` | Skill 映射、职责校验、预设生命周期及项目落地 | `WorkflowPresetService`、`PresetApplyService` |
| `asset` | 本机素材、导入去重、元数据缩略图、引用保护与文件夹 | `AssetService`、`AssetImportService`、`AssetMediaTypes`、`AssetFolderService` |
| `reference` | 参考视频、片段、集合与偏好 | `ReferenceVideoService` |
| `fx` | 特效技法、来源导入和能力候选 | `FxTechniqueService`、`FxCapabilityImporter` |
| `retrieval` | 语义索引、语料和召回结果 | `SemanticIndex`、`RetrievalCorpus` |
| `upload` | 会话附件的临时上传与读取 | `UploadService` |
| `system` | 健康与真实能力声明 | `SystemController` |
| `common` / `config` | 通用错误、分页、Spring 配置及数据库兼容迁移 | `ApiExceptionHandler`、`DatabaseMigration` |

`workspace` 的空占位包已经移除。原 `catalog` 的产物和渲染职责分别归入 `artifact`、`render`，不保留转发包。

## 包内分层

- `api`：HTTP 路由、参数和响应映射。请求类型有多个调用方时放在独立 `domain` 类型中，服务不依赖 Controller 的内部 record。
- `domain`：业务数据、约束和模块协作接口。
- `service`：用例、生命周期与跨能力编排。
- `store`：持久化接口和具体实现。同一包中保留 `XxxRepository` 与 `SqliteXxxRepository`，不再为单一实现加一层 `impl`。
- `store/mapper`：MyBatis SQL 与数据库行映射。
- `client`：外部进程、模型、网络和协议适配。没有实际需要时不强行创建所有层。

持久化混用 MyBatis / MyBatis-Plus 和 JDBC。`SqliteProjectSceneRepository`、`SqliteProjectPurgeRepository`、`CreationTaskStore`、`LocalStateStore`、语义索引和语义建议等仍直接使用 JDBC；`CreationStateStore` 保存项目内最近创作状态文件。建表也分布在 schema.sql、DatabaseMigration 和 LocalStateStore 初始化中，详见体系地图。目录迁移不顺便替换持久化技术。

## 协作边界

1. `workflow` 只保留需求与工作稿，不拥有执行队列、渲染器或版本恢复。
2. 创作服务依赖 `CreationSessionAccess`，由 `chat.service.CreationSessionBridge` 实现会话/消息校验及幂等回复写入；创作模块不直接访问聊天仓储。
3. 工作稿通过 `ProjectCreationActivity` 查询是否有排队或执行中的创作，接口由创作队列实现，不依赖队列具体类。
4. 工程指纹由 `project.service.ProjectSourceFingerprint` 计算，快照和版本恢复不依赖 Agent 实现。
5. 预设专用的校验错误处理放在 `preset.api`，通用错误处理不反向依赖业务模块。
6. 业务包依赖应保持无环。`ModuleLayoutTest` 检查源码包路径、禁用旧 `store.impl` 层，并检测业务包引用环。

## 两种渲染与两种任务

视频轨道按产物保存在视频旁的隐藏文件 `.<视频文件名>.sequences.json`，由 `render.service.VideoTimeline` 做结构、路径、视频 SHA-256 校验与原子写入。两种渲染路径均在登记视频前保存清单，取消或丢弃产物时同时清理；清单不再依赖项目根目录的同名文件。

`creation.service.ProjectTimelineService` 提供 `GET /api/projects/{projectId}/timeline?path=...` 与 `POST /api/projects/{projectId}/timeline/recover`。恢复只读对应历史版本：源码片核对快照指纹后逐帧采集，场景片按旧版渲染的帧舍入规则重建，再通过 ffprobe 核对视频帧率、时长与帧数。恢复不重渲视频、不改工程或数据库版本。没有可靠来源的外部视频仅显示成片轨；采集不完整或超限时保留成片后备轨，禁止把它当精确片段修改目标。

轨道恢复经 `ProjectSceneRepository.findLatestVersionByArtifact` 查询项目与产物路径对应的最新快照，SQL 使用 `ORDER BY version DESC LIMIT 1`。历史列表接口保持不变；恢复路径不再加载并解析整个项目的历史 JSON。

`RemotionRenderer` 调用 `remotion/render.mjs`，处理已有场景数据；`ProjectFilmRenderer` 调用 `remotion/render-project.mjs`，处理项目源码入口。两者共享 `render-shared.mjs`，目前仍有调用方，不能作为重复实现删除。

实时预览也归入 `render`：`LivePreviewController` 提供启动/查询/停止接口，`LivePreviewService` 管理每项目会话、并发启动复用、三个就绪预览和单个临时启动名额、空闲回收；`LivePreviewLauncher` 解析共享运行时与日志路径；`LivePreviewProcess` 处理首行就绪信号、HTTP 健康检查与进程树终止。启动握手、HTTP 检查及停止等待都在共享状态锁外进行，启动中的失败只由启动流程解析；新预览就绪后才淘汰旧的。预览依赖项目配置但不提交工程版本、不阻塞 Agent 创作。协议见 [live-preview.md](../frontend/docs/contracts/live-preview.md)。

`task` 保留场景修改和渲染任务，`creation` 保留自由源码创作请求。两者有不同的请求、事件和恢复语义，本次只整理归属，不合并状态机或改写历史记录。

`ProjectCreationService` 编排工程修改、任务幂等、项目互斥和创作状态；`ProjectFilmRenderService` 专门负责工程配置校验、源码快照、Remotion 执行、版本快照提交、冲突产物清理与源码文件列表。两者共用原来的项目版本与渲染服务，不改变 `/film` 和 `/render` 的响应契约。

`ShotCandidateService` 是镜头装配的受控两阶段入口：从当前版本快照构造隔离候选，局部渲染并保存可校验的预览；只有确认时才重新装配、完整渲染、恢复工作区并条件提交 `shot_edit` 版本。候选目录不进入当前源码指纹，确认失败清理新产物并保留候选重试；它不替代不受信代码沙箱，也不把硬切镜头规则推广到转场工程。

`CreateAgentRunner` 负责创作准备、Agent 会话、源码改动判定和进度；`CreationReferenceService` 承担检索候选选择、检索状态解释和 `retrieval-log.md` 追加。检索失败与字面匹配降级的提示、检索日志格式和写入位置保持不变。

`asset.service.AssetService` 负责用户记录、审核/授权约束、引用检查、删除及查询；`AssetImportService` 负责流式复制、哈希去重、文件修复和元数据/缩略图落盘；`AssetMediaTypes` 集中 MIME、扩展名与媒体类型判断。`AssetService` 的导入入口和结果 DTO 保持兼容；独立的导入服务承接数据库事务，不改素材表或文件目录格式。

## 聊天回复与 DSH 事件流

工作台源码编辑新增：`project.service.ProjectWorktreeService` 按工作区和当前版本指纹返回 dirty 状态；`creation.service.SourceRenderJobs` 持久化显式出片请求，调用 `ProjectFilmRenderService.renderGuarded` 冻结并复核源码快照；版本中的请求凭据用于回执恢复。`SourceTargetService` 通过 `render.service.SourceTargetInspector` 的共享 Babel 解析器定位 JSX，运行副本并校验写回范围。`SourceWriteGuard` 与预览服务的同协议锁协调短期写入。类型和错误见 [工作台源码契约](../frontend/docs/contracts/workbench-source.md)。

`chat.service.ChatStreamService` 保留一轮回复的编排：引擎和模型选择、会话续接、执行中进程登记、停止、失败收尾与自动渲染。流式输出和保存由同包内的组件承担：

| 组件 | 职责 |
|---|---|
| `ChatReplyListener` | 把引擎事件归集成回复正文、工具记录、推理时间线、任务清单、用量与交付文件 |
| `ChatSseWriter` | 保持 SSE 事件名称和 JSON 字段，写帧并刷新当前请求的响应缓冲 |
| `ChatReplyStore` | 在事务内获取写锁、追加回复并刷新会话时间；空附加字段仍存为 `null` |
| `ChatTurnTiming` | 记录启动、握手、首个正文增量和整轮耗时 |

`harness.client.DshSdkSession` 保留原有公开构造方法、`initialize`、`resume`、`prompt` 及嵌套的 `Listener`、`Outcome`、`InlineImage` 类型；调用方不需要迁移。内部按协议职责拆分：

| 组件 | 职责 |
|---|---|
| `DshRpcTransport` | JSON-RPC 请求与回执匹配、交错通知缓存、插件增量队列；不接管进程关闭 |
| `DshTurnReader` | 单轮读取循环、心跳、前台截止交接、硬超时和 idle 前的增量排空 |
| `DshTurnEvents` | 会话过滤、协议与插件事件解释、推理去重、单轮结果累计 |

上下文分档累加器仍由 `DshSdkSession` 持有并跨轮复用；单轮事件状态随每次 `prompt` 新建。进程和输入输出流仍由 `DshProcess` 统一管理，回复结束由原编排方关闭进程。取消登记、后台收集、正文与工具的阶段顺序、历史回放字段及未完成回复的保存语义保持原样。

## 验证和后续边界

2026-11-23后端续轮新增边界组件：`ProjectSourceLayout`统一源码范围，`SourceEditSession`与恢复日志负责候选应用及异常保护；`ProjectContentService`读取已验证成片内容，`StoryboardService`读取规划，`ProjectPosterController`位于render避免项目与渲染循环依赖。`PreviewLogSink`为常驻预览有界读取输出；`ProcessOutput`约束短命工具结果读取；`JsonInputConfig`限制隐式整数截断和重复JSON字段。`AssetFileCleanup`仅在删除事务提交后取得新写事务、复核共用者并清理文件，导入在内容复制/哈希之后取得相同数据库写入资格。最新范围和证据见持续台账，不能把这些组件视为完整审核/交付产品的替代品。

目录修改后运行 `mvn clean package`，以避免旧包编译产物造成重复 Bean；再用独立数据库做启动和路由检查。测试覆盖原有 API、会话归属、幂等、取消、草稿冲突、渲染超时及版本恢复，以及工程渲染的快照、提交与冲突清理、创作检索状态和证据日志；回执间通知不丢失、跨会话隔离、后台交接、推理去重、回复字段往返与事务回滚。

渲染缓存迁移、常驻引擎进程和统一任务运行时仍需单独设计与验收；本轮拆分不引入这些行为变化。
