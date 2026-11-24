# 后端开发指南

更新：2026-11-20。先读 [体系地图](SYSTEM_MAP.md) 了解实际调用与数据归属，再按本页选择修改入口、验证范围和文档落点。

## 1. 开始任务前确定六件事

| 问题 | 要明确的内容 |
|---|---|
| 用户遇到什么 | 操作入口、实际结果、期望结果、可复现条件 |
| 哪条执行路径 | 对话、源码创作、场景任务、同步渲染、轨道恢复、资源管理或纯读取 |
| 谁持有事实 | 业务表、local_documents、项目文件、内存状态或外部引擎 |
| 用什么身份校验 | projectId、sessionId、userMessageId、requestId、baseVersion、revision、sourceHash 等 |
| 何时算完成 | 收到请求、执行完、文件落盘、数据库提交和前端读到结果分别定义 |
| 失败怎样收尾 | 重试是否重复执行、取消是否保留源码、冲突产物保留/清理、进程重启后如何识别 |

仓库当前包含多轮未提交改动；开始时看 `git status` 和相关 diff，不重置别人的前端、后端或项目文件。先完成现状定位，避免把历史文档或接口规划当成已实现契约。

## 2. 按任务类型选择开发方式

### 功能开发

1. 确定所属模块，优先在已有用例上扩展，不按前端页面名称随意新增后端模块。
2. 明确输入、输出、错误、幂等、版本与资源归属；有跨模块调用时保持依赖方向。
3. 有用户可见持久状态就确定唯一事实来源；内存只持有可丢弃投影或执行句柄。
4. 需要长时间模型/渲染工作的接口，先决定受理、进度、取消与恢复语义；不要把同步入口包装成“已后台化”。
5. 以真实产物和提交结果更新能力声明，再联动前端解析与提示。

### 优化与重构

1. 写出待改善指标：查询行数/反序列化次数、渲染耗时、首帧延迟、内存、并发或职责耦合。
2. 固定行为基线：API 路径、JSON、错误码、默认值、事件顺序、数据库和文件布局。
3. 比较相同数据量/环境下的前后结果。没有测量时只描述具体减少的工作，不宣称性能提升倍数。
4. 跨包移动运行 `ModuleLayoutTest`；有旧 class 残留风险时 `clean package`，不要仅编译局部文件。
5. 不以新增抽象层、拆文件数量作为单独完成标准。当前业务存储混用 Mapper 与 JDBC 是实际状态，迁移技术应另有收益与验收。

### 缺陷修复

沿“前端请求 → Controller → Service → Store/子进程 → 响应 → 前端状态”对同一请求取证。先写可失败的边界回归，再修根因。失败文案需体现实际阶段，不把没有产物解释成成功，也不把没改源码一概解释成模型在追问。

### 文档更新

- 当前体系：本页、[SYSTEM_MAP.md](SYSTEM_MAP.md)、[ARCHITECTURE.md](ARCHITECTURE.md)。
- 接口变更：实际 Controller/DTO、前端客户端、[契约目录](../frontend/docs/contracts/README.md) 同步；注明规划与实际实现差异。
- 完成与验收：更新 [PROGRESS.md](../PROGRESS.md) 和 [CHANGELOG.md](../CHANGELOG.md) 未发布段。
- 历史记录保留日期；旧数字不能充当当前工作区验证结果。只改文档时无需为了写“通过”反复跑无关测试。

### 测试开发

优先覆盖可能造成错项目、错版本、丢消息、重复执行、产物不一致的行为。纯实现细节或低风险文案不必堆测试；关键异常路径应有断言，不能只验证方法被调用。

## 3. 按需求定位源码与测试

2026-11-23续轮入口：当前时间线/场景读模型在`creation/ProjectContentService`，分镜文件读取在`workflow/StoryboardService`，封面缓存在`render/api/ProjectPosterController`；项目摘要批量读取在`project/ProjectQueryService`。文件范围统一经`ProjectSourceLayout`，恢复和回滚必须保留外部后改/后删。HTTP JSON整数/重复字段由`JsonInputConfig`约束。新增逻辑需同时更新确定性测试及`backend/src/test/workbench-source/acceptance.mjs`，不可只依据旧报告声明完成。

下表测试名用于 `mvn -Dtest=... test`，并非要求每次全部运行。

| 需求 | 主要修改位置 | 优先回归 |
|---|---|---|
| 项目创建/幂等/目录 | project service/store/api | `ProjectApiTest,ProjectServiceTest,ProjectIdempotencyRepositoryTest,ProjectDirectoryCollisionTest` |
| 项目清除/资源关系 | ProjectPurgeService、ProjectOperationLock、SqliteProjectPurgeRepository、ResourceRefService | `ProjectPurgeServiceTest,ProjectDeletionAdmissionTest,ProjectDeletionApiTest,ReferenceAssetProtectionTest`；执行入口同时回归队列取消与租约释放 |
| 版本提交/恢复/查产物 | SceneVersionService、ProjectSourceSnapshots、ProjectSceneRepository | `ProjectSceneSnapshotTest,SceneVersionServiceTest,ProjectFilmRenderServiceTest,ProjectRenderVersionGuardTest` |
| 按工程版本读元素声明 | SceneEditMetadataService、ProjectSourceSnapshots、[元素声明契约](../frontend/docs/contracts/scene-edit-metadata.md) | `SceneEditMetadataApiTest,SceneVersionServiceTest,ProjectFilmRenderServiceTest,ProjectTimelineServiceTest` |
| 版本化文字元素写回 | creation.SceneElementEditService、SceneEditMetadataService、ProjectSourceSnapshots、ProjectFilmRenderer、VideoTimeline | `SceneElementEditApiTest,SceneEditMetadataApiTest,ModuleLayoutTest` |
| 本地文档、工作流快照 | LocalStateStore、LocalStateController、前端 local-documents | `LocalStateStoreTest` 及前端持久化/执行测试 |
| 消息保存/会话归属 | ChatMessageService、ChatReplyStore、CreationSessionBridge | `ChatMessageServiceTest,ChatReplyStoreTest,CreationSessionBridgeTest` |
| 回复正文/工具顺序/SSE | ChatTurns、ChatStreamService、ChatReplyListener、ChatSseWriter | `ChatTurnsTest,ChatStreamTimelineTest,ChatSseWriterTest,ChatStreamLifecycleTest,UnfinishedTurnTest,ChatTurnRenderStreamTest` |
| DSH 协议与模型选择 | DshSdkSession、RPC/reader/events、DshModelCatalog | `DshRpcTransportTest,DshTurnEventsTest,DshTurnReaderTest,DshSdkNarrationTest,DshSdkSelectionTest,DshHeartbeatTest,DshModelCatalogTest` |
| 原生引擎 | NativeHarnesses、HarnessService | `NativeHarnessesTest,HarnessApiTest`；引擎实测另列 |
| 源码创作/取消/结果恢复 | CreationJobs、ProjectCreationService、CreateAgentRunner | `CreationJobsTest,CreationRoutesTest,ProjectRenderVersionGuardTest,CreateAgentProgressListenerTest,PreviewImageValidationTest` |
| 原文/纠正/工作稿 | WorkflowProjectService、OriginalPromptIntegrity、WorkflowDraftService | `OriginalPromptIntegrityTest,WorkflowCorrectionRetryTest,WorkflowDraftApiTest` |
| 渲染/轨道 | RemotionRenderer、ProjectFilmRenderer、VideoTimeline、ProjectTimelineService、remotion/*.mjs | `RenderControllerTest,RemotionRendererTimeoutTest,VideoTimelineTest,ProjectTimelineServiceTest`；Node timeline.test；真实 fixture |
| 场景修改/取消/恢复 | TaskRequestGuard、TaskService、ModelModifyPlanner、ModifyPlanApplier | `TaskRequestGuardTest,TaskServiceTest,TaskRecoveryTest,ModifyPlanApplierTest,ModelModifyPlannerParseTest` |
| Skill / 预设 | skill、preset、MappingResponsibilities | `SkillPackageApiTest,SkillArchiveExtractorTest,SkillInventoryScannerTest,PresetMappingValidatorTest,MappingResponsibilitiesTest,WorkflowPresetApiTest,ProjectPresetApiTest` |
| 素材/参考/技法/检索 | asset、reference、fx、retrieval | 对应模块现有 *Test；检索重点 `RetrievalStatusTest,LiteralFallbackTermTest` |
| 数据库升级 | schema.sql、DatabaseMigration、LocalStateStore.init | `DatabaseMigrationTest,LocalStateStoreTest` + 受影响仓储测试 |
| 包归属与依赖 | 任何跨模块改动 | `ModuleLayoutTest` |

测试命名与路径随代码调整时，本表也应更新。确认名称可用：

```bash
# 从 backend/ 执行
rg --files src/test/java | sort
rg -n '@(Get|Post|Put|Patch|Delete|Request)Mapping' src/main/java
```

## 4. 回归层级与运行命令

### A. 定向测试

从 `backend/` 执行；JDK 必须是 21。测试 profile 将数据库、素材和 Skill 包放在 target 下，但部分默认目录与环境仍需显式隔离。

```bash
mvn -B -Dstyle.color=never \
  -Dfengmotion.data-dir=./target/dev-check/data \
  -Dfengmotion.workspace-root=./target/dev-check/projects \
  -Dfengmotion.retrieval.enabled=false \
  -Dfengmotion.retrieval.embedding.api-key= \
  -Dtest=ProjectSceneSnapshotTest,ProjectTimelineServiceTest,ModuleLayoutTest test
```

`src/test/resources/application-test.yml` 关闭真实 harness。不要全局打开 `FENGMOTION_LIVE_TEST=1`；`DshDirectTextModelTest` 的可选实测会使用真实 provider。API/协议测试通常使用 mock 或假子进程，不代表真实模型可用。

### B. 全量后端与 Node

```bash
mvn -B -Dstyle.color=never \
  -Dfengmotion.data-dir=./target/dev-check/data \
  -Dfengmotion.workspace-root=./target/dev-check/projects \
  -Dfengmotion.retrieval.enabled=false \
  -Dfengmotion.retrieval.embedding.api-key= test
node --test src/test/*.test.mjs
```

需要部署 JAR 或调整了包路径时，将 Maven 末尾 `test` 换成 `clean package`。数据库固定为 `target/fengmotion-test.db` 的测试不能在同一 checkout 并发开多个 Maven 实例；Node 和独立读取可并行。

当前 CI 的 [checks.yml](../.github/workflows/checks.yml) 跑 Java clean package、后端Node测试、预览/编辑/写入锁Node测试、前端测试/构建和桌面壳编译；会安装共享预览依赖与ffmpeg。真实模型与完整Remotion出片验收仍需隔离执行，不能把 CI 绿灯等同于真实模型出片或多平台安装通过。

### C. API 联调与真实渲染

优先建立临时数据目录和临时项目；使用额外端口，不让第二个服务访问桌面生产数据库。若使用已有项目副本，SQLite 用 backup API 复制一致快照，并将副本里的 root_path 指向隔离项目目录，否则启动指引升级可能写回原项目。

示例：从 `backend/` 执行，启动独立空库；目录必须已创建：

```bash
mkdir -p target/smoke-data target/smoke-projects
java -jar target/fengmotion-server-0.1.2.jar \
  --server.port=18081 \
  --fengmotion.data-dir="$PWD/target/smoke-data" \
  --fengmotion.workspace-root="$PWD/target/smoke-projects" \
  --fengmotion.remotion.project-dir="$PWD/remotion" \
  --fengmotion.remotion.node-modules="$(cd ../frontend && pwd)/node_modules" \
  --fengmotion.workflow.dir="$(cd ../frontend && pwd)/workflow-v0.1.1" \
  --fengmotion.harness.enabled=false \
  --fengmotion.retrieval.enabled=false \
  --fengmotion.retrieval.embedding.api-key=
```

实际渲染需要 Node、Chromium 与运行依赖；可通过 `--fengmotion.remotion.browser=<本机路径>` 指定已安装浏览器。不要向桌面项目写 fixture 或调用真实模型来替代协议单测。

### D. 桌面验收

核对安装路径中的 JAR、前端 dist、remotion 脚本、node_modules、workflow 和媒体工具，而不是只看仓库构建。改协议或运行时后，检查桌面实际 API 地址、日志、产物、版本和重启后恢复。

安装态变更需记录备份位置、被替换资源、重启结果和真实检查；只跑 test 没更新桌面时明确说明。新增类需要新包与新进程，不能以旧进程的 `/health` 推断新代码运行。

## 5. 核心行为验收矩阵

| 类别 | 至少检查的情形 | 应保护的事实 |
|---|---|---|
| 身份 | 错项目、错会话、错消息、重复 requestId、相同/不同内容重试 | 不串线、不重复执行 |
| 版本 | baseVersion 过期、渲染中更新、恢复后再修改、两版同长度视频 | 不覆盖新版本、不借用其他轨道 |
| 生命周期 | 排队取消、执行取消、客户端断连、进程退出、重启只订阅 | 断连与取消区分，不静默重跑 |
| 数据 | 缺快照、损坏 JSON、视频被替换、写库失败、磁盘失败 | 无效结果不提交；已有内容可核对 |
| 路径 | `..`、绝对路径、符号链接、同名产物、跨项目引用 | 文件读写留在允许范围 |
| 模型 | 无效 JSON、缺字段、职责错配、未改源码、模型不可用 | 不把模型文本当成功证据 |
| 资源 | 无素材、显式清空引用、同内容去重、共享素材删除、检索降级 | 送达/采用区分，引用保护有效 |
| 展示 | 真实 code 与 rawCode、SSE 顺序、当前/历史版本、能力缺失 | 前后端描述与执行一致 |

对上述风险未覆盖的改动，增加有意义的边界测试；不要求每个小改动机械执行整张表。

## 6. 文档与交付清单

每项任务可用如下格式结束，便于后续接手：

```text
问题 / 目标：
执行入口与所属模块：
事实来源与身份字段：
变更行为与保持兼容的部分：
提交点与失败/取消/重启处理：
实际运行的测试命令和结果：
未验证边界：
文档更新位置：
源码 / 已打包 / 已安装 / 已发布状态：
```

文档里的测试计数需注明日期与范围；单测不能替代模型实测，构建不能替代桌面验收，截图不能证明取消/事务语义。重要失败与优化结论应链接具体源码和测试，避免下轮继续依靠会话回忆。

## 7. 推荐后续拆分

1. **先统一行为说明与保护范围**：能力声明、特殊错误码、项目在途检查、文件真实路径与任务取消契约。
2. **扩展工程编辑类型**：文字写回已有版本基线、隔离快照、渲染与提交协议；下一步支持其他明确绑定的元素属性，并验证源码确实消费声明值，不假设任意 React 源码都可直接编辑。
3. **长任务后台化与资源预算**：轨道恢复作业、事件恢复、去重、队列/内存/并发限制。
4. **性能与迁移**：基于实际数据量做查询/列表/索引优化；梳理建表来源和多资源提交补偿。
5. **部署和诊断**：前后端/运行时一致性、跨阶段请求标识、干净机器测试。

具体产品优先级见 [ROADMAP.md](../ROADMAP.md)。本页提供开发方法，不代表这些事项已实现或已获全量验收。
