# FengMotion 前后端 API 契约 · 总则

状态：**待评审冻结**（2026-10-23 重写，替代 PR #2 的三份局部契约）。
范围：前端全部八个视图 + 项目级工作台 + Agent 对话所需的数据与动作。
类型实体：`src/types/contracts.ts`（纯类型、零 import、零运行时）。
边界：只约定字段、状态、关联、端点与错误；**不含后端实现、不含 Agent 编排、不含 UI**。

---

## 1. 契约地图

| 文档 | 覆盖域 | 主要类型 |
|---|---|---|
| `README.md`（本文） | 通用约定、错误、分页、SSE、端点总表、跨域状态机 | `Page`、`ApiErrorDetail`、`Capabilities` |
| `project.md` | 项目、设置、时间线、场景、分镜、镜头参数、产物、版本 | `ProjectSummary`、`Scene`、`Timeline`、`WorkbenchArtifact` |
| `task.md` | 任务请求、任务实体、事件流、变更集、取消/重试 | `TaskRequest`、`AgentTask`、`TaskEvent` |
| `workflow.md` | 工作流定义与版本、运行、模板 | `WorkflowDefinition`、`WorkflowRun` |
| `check.md` | 检查运行、问题项、证据、处理状态、结论派生 | `CheckRun`、`CheckFinding` |
| `render.md` | 渲染作业、产物、交付状态、验收 | `RenderJob`、`DeliveryState`、`AcceptanceRecord` |
| `asset.md` | 素材、五维状态、文件夹、分片上传 | `Asset`、`AssetFolder`、`UploadSession` |
| `library.md` | 特效库、参考片库、片型画像、收藏/集合 | `FxTechnique`、`ReferenceShot`、`Genome` |
| `agent.md` | 对话会话、消息、流式输出、任务关联 | `ChatSession`、`ChatMessage` |
| `settings.md` | 能力声明、应用设置、健康检查 | `Capabilities`、`AppSettings` |

八页与端点对照：

| 页面 | 读 | 写 |
|---|---|---|
| 首页 | 项目列表（最近）、片型、能力 | 创建项目、创建任务 |
| 我的创作 | 项目列表、项目详情 | 重命名、改阶段、删除 |
| 制作工作台 | 项目、时间线、场景、分镜、产物、版本、任务、检查 | 镜头参数、任务、取消、重试、恢复版本 |
| 工作流 | 模板、定义、运行 | 创建/保存定义、运行、取消 |
| 特效库 | 技法列表、详情、筛选面 | 复制配方（前端）、用于工作流（后续） |
| 参考片库 | 参考片、镜头段、十维分析、集合 | 收藏、最近、集合成员 |
| 我的素材 | 素材、文件夹、引用 | 导入、改名、标签、移动、删除、授权/审核 |
| 发布与验收 | 交付状态、渲染、检查、验收记录 | 渲染、检查、验收决定 |

---

## 2. 通用约定

### 2.1 基址与传输

- 基址：`http://127.0.0.1:<port>/api/v1`（桌面端由本地 Agent 服务提供；端口从设置读取，不写死在视图）。
- 编码：JSON UTF-8；文件走独立 URL，不把 base64 塞进 JSON。
- 方法语义：`GET` 只读、`POST` 创建/动作、`PATCH` 局部更新、`PUT` 整体替换（上传分片除外）、`DELETE` 删除。
- 异步动作（任务、渲染、检查、解析）返回 `202 Accepted` + 资源句柄，进度走 SSE 或轮询，不用长连接 HTTP 阻塞。

### 2.2 认证

- 桌面端本地服务：启动握手换取短期 token，请求头 `Authorization: Bearer <token>`。
- token 只放内存，**不进 localStorage**；过期返回 `401`，前端重新握手。
- 本地服务默认只监听 `127.0.0.1`，不暴露局域网。

### 2.3 成功响应

- 单资源：直接返回对象（不套 `{ data }`）。
- 列表：`Page<T>` = `{ items, nextCursor, total? }`。
- 删除：`204 No Content`。
- 异步动作：`202` + `TaskAcceptedResponse` / `RenderJob` / `CheckRun`。
- 空态：返回空数组 + `nextCursor: null`，不用 `null` 冒充「没有数据」。

### 2.4 错误

所有错误统一为：

```json
{ "error": { "code": "precondition_failed", "message": "项目已被其他窗口修改", "details": { "etag": "..." }, "requestId": "req_..." } }
```

| HTTP | code | 场景 |
|---|---|---|
| 400 | `validation_error` | 字段缺失/越界、必填输入未提供 |
| 404 | `not_found` | 资源不存在或已删除 |
| 409 | `conflict` | 唯一名冲突、删除被引用资源 |
| 412 | `precondition_failed` | `If-Match` 不匹配、版本已过期 |
| 415 | `unsupported_media_type` | 导入不支持的文件类型 |
| 413 | `payload_too_large` | 单文件/单请求超限 |
| 409 | `idempotency_conflict` | 同一 `Idempotency-Key` 携带不同请求体 |
| 422 | `capability_unavailable` | 解析 / ASR / 云渲染 / 检查执行未接入 |
| 503 | `agent_unavailable` | Agent 进程未连接（能力存在但当前不可用） |
| 429 | `rate_limited` | 超出并发/频率限制，`Retry-After` 给秒数 |
| 409 | `cancelled` | 对已取消对象继续操作 |
| 500 | `internal_error` | 未预期错误，必须带 `requestId` |

**铁律**：能力未接入返回 `capability_unavailable`，不得返回空数组或伪造成功；UI 必须按能力声明置灰并写一句人话。

### 2.5 分页、筛选、排序

- 游标分页：`?cursor=<opaque>&limit=50`；`limit` 上限 200。
- 列表筛选参数写在各域文档；未知参数忽略，非法枚举返回 `validation_error`。
- 排序默认按「最近更新倒序」；显式 `sort` 才改变。
- 不在服务端做跨域模糊聚合搜索；搜索按域提供 `q`，避免一个 `/search` 承担全部语义。

### 2.6 时间、时长、ID

- 时间点：ISO 8601 UTC 字符串（`2026-10-23T06:27:00Z`）。
- 时长/偏移：毫秒整数，字段名必须带 `Ms`（`durationMs`、`startMs`、`timecodeMs`）。
- 帧号：整数，从 0 开始；`frame` 与 `timecode` 同时出现时以帧为准，时间码仅供展示。
- ID：不透明字符串，客户端不得解析；跨实体引用只存 ID，不嵌套整对象。
- 空值：字段缺失表达「不适用/未产生」；不用空字符串、0 或 `null` 冒充未知。`null` 只用于「明确无此关联」。

### 2.7 并发与幂等

- 可变资源（项目、素材、工作流定义、产物、问题项、参考偏好）返回 `etag`。
- 更新必须带 `If-Match: <etag>`；不匹配返回 `412 precondition_failed`，前端提示「已被其他窗口修改」并刷新。
- 创建型 `POST`（任务、渲染、检查、上传、对话消息）接受 `Idempotency-Key`，24 小时内同 key 同 body 返回首次结果，不同 body 返回 `409 idempotency_conflict`。
- 删除被引用资源（素材被项目/工作流引用）返回 `409 conflict` 并列出引用方，不静默级联。

### 2.8 文件与 URL

- 返回短期签名 URL（默认 15 分钟），需要 `Range` 支持以便视频拖动。
- 缩略图与预览图独立 URL，不要求前端下载原文件再裁。
- 上传：`POST /assets/uploads` 建会话 → `PUT .../chunks/{index}` 逐片 → `POST .../complete` 生成 `Asset`；分片大小由会话返回，客户端不得自行假设。
- 上传进度必须是服务端已确认的字节数，不用前端假百分比。

### 2.9 SSE（任务与对话）

- `GET /tasks/{taskId}/events`、`GET /chat-sessions/{sessionId}/stream`。
- 请求头：`Accept: text/event-stream`；断线重连带 `Last-Event-ID: <seq>`。
- 每条消息：`id: <seq>` + `event: <type>` + `data: <JSON>`，JSON 形状见 `TaskStreamMessage` / `ChatStreamMessage`。
- 事件类型：`snapshot`（重连时首帧，含最近 200 条事件）、`event` / `delta` / `completed` / `task`、`end`、`error`。
- 服务端每 15 秒发一次注释心跳（`: ping`）；客户端 45 秒无消息则重连。
- 终态后服务端主动 `end` 并关闭连接；客户端不得把断线当作完成。

### 2.10 Demo 与能力

- `demo: true` 只出现在演示数据上；真实数据不返回该字段。
- `GET /capabilities` 是按钮可用性的唯一依据；能力为 `unavailable` 时动作必须置灰并标注原因。
- 演示数据不得驱动真实写操作；演示任务只推进可见状态，不写文件、不生成产物。

---

## 3. 端点总表

### 3.1 系统

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/health` | 服务健康与版本 |
| GET | `/capabilities` | 七项能力状态 |
| GET | `/settings` | 应用设置 |
| PATCH | `/settings` | 主题、工作区根目录、上次项目 |

### 3.2 项目与内容

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/projects` | 项目列表（筛选/搜索/排序） |
| POST | `/projects` | 新建项目（未落盘时 `planned: true`） |
| GET | `/projects/{projectId}` | 项目详情（含 settings） |
| PATCH | `/projects/{projectId}` | 改名、阶段、片型、目标时长 |
| DELETE | `/projects/{projectId}` | 删除项目（仅未落盘或用户确认后） |
| GET | `/projects/{projectId}/timeline` | 成片时间轴 |
| GET | `/projects/{projectId}/scenes` | 场景列表 |
| GET | `/projects/{projectId}/scenes/{sceneId}` | 场景详情 |
| GET | `/projects/{projectId}/storyboard` | 分镜表 |
| GET | `/projects/{projectId}/scenes/{sceneId}/override` | 镜头参数 |
| PUT | `/projects/{projectId}/scenes/{sceneId}/override` | 保存镜头参数 |
| GET | `/projects/{projectId}/artifacts` | 工作台产物列表 |
| POST | `/projects/{projectId}/artifacts` | 新建产物 |
| GET | `/projects/{projectId}/artifacts/{artifactId}` | 产物详情 |
| PATCH | `/projects/{projectId}/artifacts/{artifactId}` | 更新产物 |
| GET | `/projects/{projectId}/versions` | 项目版本/来源 |
| POST | `/projects/{projectId}/versions/{versionId}/restore` | 恢复版本（异步任务） |

### 3.3 任务

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/projects/{projectId}/tasks` | 创建任务（modify/render/check/analyze/undo/redo/restore） |
| GET | `/projects/{projectId}/tasks` | 项目任务列表 |
| GET | `/tasks/{taskId}` | 任务详情 |
| POST | `/tasks/{taskId}/cancel` | 取消（仅 queued/running/building） |
| POST | `/tasks/{taskId}/retry` | 重试（新任务，不覆盖旧任务） |
| GET | `/tasks/{taskId}/events` | SSE 事件流 |
| GET | `/tasks/{taskId}/events/history` | 事件历史（`afterSeq` 补齐） |
| GET | `/tasks/{taskId}/changes` | 变更集 |

### 3.4 工作流

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/workflows` | 定义列表 |
| POST | `/workflows` | 新建定义（空白或从模板） |
| GET | `/workflows/{workflowId}` | 定义详情（可带 `?version=`） |
| PATCH | `/workflows/{workflowId}` | 保存（产生新 version） |
| DELETE | `/workflows/{workflowId}` | 删除定义（有运行记录时归档） |
| GET | `/workflows/{workflowId}/versions` | 版本历史 |
| POST | `/workflows/{workflowId}/runs` | 启动运行 |
| GET | `/workflows/{workflowId}/runs` | 该定义的运行列表 |
| GET | `/workflow-runs/{runId}` | 运行详情（nodeIO） |
| POST | `/workflow-runs/{runId}/cancel` | 取消运行 |
| GET | `/workflow-templates` | 模板广场 |
| GET | `/workflow-templates/{templateId}` | 模板详情 |

### 3.5 检查

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/projects/{projectId}/checks` | 创建检查运行 |
| GET | `/projects/{projectId}/checks` | 项目检查列表 |
| GET | `/checks/{checkRunId}` | 运行详情（含结论派生） |
| GET | `/checks/{checkRunId}/findings` | 问题项列表 |
| PATCH | `/check-findings/{findingId}` | 只改处理状态 |
| GET | `/renders/{renderId}/checks` | 某产物的检查记录 |

### 3.6 渲染与交付

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/projects/{projectId}/renders` | 创建渲染任务 |
| GET | `/projects/{projectId}/renders` | 渲染历史 |
| GET | `/renders/{renderId}` | 渲染详情与产物 |
| POST | `/renders/{renderId}/cancel` | 取消渲染 |
| GET | `/projects/{projectId}/delivery` | 交付状态与缺件清单 |
| POST | `/renders/{renderId}/acceptance` | 验收决定（accepted/rejected） |
| GET | `/projects/{projectId}/acceptances` | 验收历史 |

### 3.7 素材

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/assets` | 素材列表（类型/来源/文件夹/标签/搜索） |
| POST | `/assets/uploads` | 创建上传会话 |
| PUT | `/assets/uploads/{uploadId}/chunks/{index}` | 上传分片 |
| POST | `/assets/uploads/{uploadId}/complete` | 完成上传，生成素材 |
| DELETE | `/assets/uploads/{uploadId}` | 取消上传 |
| POST | `/assets/import` | 按绝对路径导入（桌面端） |
| GET | `/assets/{assetId}` | 素材详情 |
| PATCH | `/assets/{assetId}` | 改名/标签/文件夹/授权/审核/可用性 |
| DELETE | `/assets/{assetId}` | 删除（被引用时 409） |
| POST | `/assets/batch-delete` | 批量删除 |
| GET | `/asset-folders` | 文件夹列表 |
| POST | `/asset-folders` | 新建文件夹 |
| PATCH | `/asset-folders/{folderId}` | 重命名 |
| DELETE | `/asset-folders/{folderId}` | 删除文件夹（素材移回根） |

### 3.8 知识库

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/fx-techniques` | 特效列表（分类/执行类型/实现/输入/复杂度/搜索） |
| GET | `/fx-techniques/facets` | 筛选面与计数 |
| GET | `/fx-techniques/{techniqueId}` | 特效详情 |
| GET | `/genomes` | 片型画像列表 |
| GET | `/genomes/{genomeId}` | 片型画像详情（含方法步骤） |
| GET | `/reference-videos` | 参考片列表 |
| GET | `/reference-videos/{videoId}` | 参考片详情 |
| POST | `/reference-videos/{videoId}/analyze` | 发起解析（能力未接则 422） |
| GET | `/reference-shots` | 镜头段列表（十维分析） |
| GET | `/reference-shots/{shotId}` | 镜头段详情 |
| GET | `/reference-collections` | 集合列表 |
| POST | `/reference-collections` | 新建集合 |
| PATCH | `/reference-collections/{collectionId}` | 改名/备注/成员 |
| DELETE | `/reference-collections/{collectionId}` | 删除集合 |
| GET | `/reference-preferences` | 收藏/最近/成员关系 |
| PATCH | `/reference-preferences` | 更新偏好 |

### 3.9 对话

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/projects/{projectId}/chat-sessions` | 项目会话列表 |
| POST | `/projects/{projectId}/chat-sessions` | 新建会话 |
| GET | `/chat-sessions/{sessionId}` | 会话详情 |
| DELETE | `/chat-sessions/{sessionId}` | 删除会话 |
| GET | `/chat-sessions/{sessionId}/messages` | 消息历史（游标） |
| POST | `/chat-sessions/{sessionId}/messages` | 发送消息（可触发任务） |
| GET | `/chat-sessions/{sessionId}/stream` | SSE 回复流 |

---

## 4. 跨域状态机

### 4.1 任务（唯一执行状态源）

```
queued ──► running ──► building ──► completed
   │          │            │
   ├──────────┴────────────┴──► failed
   └──────────┴────────────┴──► cancelled
```

- `building` 是 `running` 的子阶段，不是独立终态。
- 任务状态由 `WorkflowRun` 派生，映射见 `task.md` §4；任何页面不得各存一份。

### 4.2 工作流运行

`pending → running → succeeded | failed | cancelled`，终态不可回退。

### 4.3 检查

`running → completed | failed | cancelled`；结论是派生值，不落库：

```
无 run / 未完成            → not_run
completed 且无 blocker/major → passed
completed 且有 blocker/major → failed
```

### 4.4 渲染与交付

```
渲染：queued → running → completed | failed | cancelled
交付：unassembled → assembling → deliverable → delivered
                    ↘ missing / acceptance_failed
```

- `deliverable` 必须同时满足：时间轴已组装、渲染完成、检查结论不是 `failed`/`not_run`、验收未拒绝。
- `missing` 必须带 `missing[]` 逐项说明缺什么；不能只给一个状态词。

### 4.5 资源五维（素材/特效/参考片）

```
处理：pending → processing → ready | failed（failed 可重试回 pending）
审核：none → pending → approved | rejected（rejected 修订后可重提）
可用：enabled ⇄ disabled；enabled|disabled → deprecated（终态）
引用：任意时刻增删；disabled/deprecated 禁止新增引用，保留历史引用
```

非法组合（必须 4xx 或 UI 置灰）：未 `ready` 就 `approved`；`deprecated` 回 `enabled`；`disabled` 时新增引用。

---

## 5. 版本与变更流程

1. 本目录文档 + `src/types/contracts.ts` 是同一份契约的两个视图，必须同步改；只改一处视为未完成。
2. 兼容变更（加可选字段、加枚举值、加端点）走 PR + 双人复核；破坏性变更必须新开 `/api/v2` 并给迁移期。
3. 已冻结字段不直接改义：新增字段或枚举值，旧值标 `@deprecated` 并写明替代项。
4. 实现跟不上契约时，先让适配器保持 Demo 标注，不私自改契约迁就实现。
5. 冲突（前端可呈现性 vs 后端可实现性）不私下改口径，上报用户裁决。

---

## 6. 现状与目标态差距

| 现状 | 目标态 | 迁移期 |
|---|---|---|
| `studioApi` 只有任务/版本六个方法 | 本契约 60+ 端点 | 按域分 PR 接入，视图不动 |
| 任务类型在 `studioApi.ts` 内定义，`mock: true` | `src/types/contracts.ts` 单一来源，`demo: true` | 接入第一个真实端点时切换 |
| 项目数据来自 `src/data/projects.ts` 常量 | `GET /projects` | 02 期 |
| 场景/分镜来自 `src/data/productionData.ts`，时长用秒 | `GET /scenes`，毫秒 | 03 期 |
| 镜头参数存 localStorage | `PUT /scenes/{id}/override` | 03 期 |
| 素材存 IndexedDB，无服务端 | `/assets` + 分片上传 | 04-A 期 |
| 参考片收藏/集合存 localStorage | `/reference-preferences` | 04-C 期 |
| 工作流/发布与验收/项目总览是 iframe 复刻 | 同一 API 数据源 | 05/06 期 |
| 对话是本地 useState | `/chat-sessions` + SSE | 03 期 |
| 能力写死在 `studioAdapter` | `GET /capabilities` | 接入时 |

字段单位差异（迁移时统一在适配器层转换，不在视图里换算）：

| 现值 | 契约值 |
|---|---|
| `ProjectSummary.duration`（秒） | `durationMs` |
| `Unit.duration` / `start`（秒） | `Scene.durationMs` / `startMs` |
| `ReferenceShot.start` / `end`（秒） | `startMs` / `endMs` |
| `MyAsset.createdAt`（毫秒数） | ISO 8601 |
| `TaskEvent.mock` | `demo` |

---

## 7. 冻结前必须确认

1. 项目根目录是否允许前端直接传绝对路径（`rootPath` / `AssetImportRequest.filePath`）——本地桌面端可以，远程后端不可以。
2. 文件 URL 用短期签名还是本地 `file://` 代理——影响 Electron 与浏览器两种运行形态。
3. 检查运行由渲染完成自动触发，还是只允许用户显式发起——影响 `delivery` 的 `missing` 判定。
4. 验收人 `decidedBy` 的取值：本地用户 ID 还是系统账户 ID。
5. 工作流定义的 `projectId` 是否允许多项目复用同一份定义（当前类型允许 `null` = 全局模板）。
