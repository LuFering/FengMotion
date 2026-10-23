# 契约 · 任务协议（TaskRequest / AgentTask / TaskEvent / ChangeSet）

状态：**待评审冻结**。类型：`TaskRequest`、`AgentTask`、`TaskEvent`、`ChangeSet`、`TaskStreamMessage`。
定位：前端触发一切异步执行的唯一入口。视图只经 `studioApi` 调用，不直接拼装任务、不自行维护状态。

## 1. 边界

- 定义：任务请求、任务实体、事件流、变更结果，以及与工作流运行/检查/渲染/恢复的关系。
- 不定义：模型提示词、Agent 内部编排步骤、构建实现、UI 交互。
- 任务状态是**全站执行状态的唯一驱动源**：工作台摘要、任务页签、创作列表卡片读同一份 `AgentTask.status`，不各存一份。
- 事件流是状态迁移的唯一可观察出口；除事件外不存在「静默改状态」的通道。

## 2. 任务种类

| kind | 作用 | 必填块 | 产物关联 |
|---|---|---|---|
| `modify` | 按 prompt/引用修改内容 | — | `ChangeSet` |
| `render` | 渲染当前项目/片段 | `render.preset` | `RenderJob` |
| `check` | 对已渲染产物执行质量检查 | `check.renderId` | `CheckRun` |
| `analyze` | 解析参考片/素材 | `analyze.referenceVideoId` | `ReferenceShot[]` |
| `undo` / `redo` | 对已发生变更做反向操作 | — | `ChangeSet` |
| `restore` | 恢复到某个项目版本 | `restore.versionId` | `ProjectVersion` |

- `check` / `analyze` 的能力未接入时，后端返回 `422 capability_unavailable`，**不创建**任务壳。
- `render` / `check` / `restore` 的 `prompt` 可为空串；`modify` 必须有非空 prompt 或至少一个 `target` 引用。

## 3. TaskRequest

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `kind` | TaskKind | 是 | 见 §2 |
| `prompt` | string | 是 | 用户自然语言意图；可为空串（见 §2） |
| `scope` | `project`/`scene`/`selection` | 是 | 作用域；与 `sceneIds` 配合 |
| `sceneIds` | string[] | 是 | `scope=scene` 时 ≥1；其余为空数组 |
| `references` | AgentReference[] | 是 | 结构化引用，无引用为空数组 |
| `constraints` | ModificationConstraints | 是 | 硬约束，见 §5 |
| `attachments` | TaskAttachment[] | 是 | 无附件为空数组 |
| `render` | `{ preset, range? }` | 否 | `kind=render` 必填 |
| `check` | `{ renderId, categories? }` | 否 | `kind=check` 必填 |
| `analyze` | `{ referenceVideoId }` | 否 | `kind=analyze` 必填 |
| `restore` | `{ versionId }` | 否 | `kind=restore` 必填 |

**请求不可变**：任务开始后请求内容不得被改写；改需求 = 新任务（新 `Idempotency-Key`）。

## 4. AgentReference（指认）

| kind | 定位字段 | 说明 |
|---|---|---|
| `project` | `projectId` | 整个项目 |
| `scene` | `sceneId` | 一个场景 |
| `frame` | `sceneId` + `frame` + `timecode`（+`snapshotId?`） | 精确帧 |
| `range` | `sceneId` + `startFrame` + `endFrame` + `timecode` | 帧区间 |
| `region` | `sceneId` + `frame` + `bbox{x,y,w,h}` | 归一化 0–1 区域 |
| `artifact` | `artifactId` + `version` | 产物版本 |

规则：

- 一个请求**至多一个 `target`**；多个 target 由后端以 `validation_error` 拒收。
- 没有可解析引用时，后端必须回到用户澄清（新建对话消息），不做兜底猜测。
- `label` 只用于展示，不参与定位；定位只用 ID/帧/区域。

## 5. ModificationConstraints

| 字段 | 类型 | 说明 |
|---|---|---|
| `preserveCamera` | boolean | 不动运镜 |
| `preserveCaptions` | boolean | 不动字幕 |
| `limitToSelection` | boolean | 只改选区 |
| `reuseExistingComponents` | boolean | 复用已有组件，不新建 |
| `durationSeconds` | number? | 目标时长（秒） |
| `resolution` | `1080p`/`1440p`/`4k`? | 目标分辨率 |

约束是**硬约束**：与 prompt 冲突时拒绝执行并回报冲突（`failed` + `TaskError.code = constraint_conflict`），不擅自取舍。

## 6. 端点

### 6.1 创建任务

`POST /projects/{projectId}/tasks`，头带 `Idempotency-Key`，返回 `202` + `TaskAcceptedResponse`：

```json
{
  "task": { "id": "01J...", "projectId": "p1", "kind": "modify", "status": "queued", "title": "调整开场字幕", "createdAt": "2026-10-23T07:00:00Z", "updatedAt": "2026-10-23T07:00:00Z" },
  "runId": "run_01J...",
  "checkRunId": null,
  "renderId": null
}
```

- 关联句柄按 kind 出现：`modify/undo/redo` → `runId`；`render` → `renderId` + `runId`；`check` → `checkRunId`；`analyze` → `runId`；`restore` → `runId`。
- 同一 `Idempotency-Key` 24h 内重放返回首次结果（`200`，同 body）。

### 6.2 查询

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/projects/{projectId}/tasks?status=&kind=&sort=created_desc` | `Page<AgentTask>` |
| GET | `/tasks/{taskId}` | 任务详情 |
| GET | `/tasks/{taskId}/changes` | `ChangeSet`；无变更返回 `files: []`，不是 404 |

### 6.3 取消

`POST /tasks/{taskId}/cancel`：

- 仅 `queued`/`running`/`building` 可取消；终态返回 `409 cancelled`（幂等：重复取消也返回当前终态，不报 500）。
- 取消是**请求**不是保证：后端尽力停止，最终以 `cancelled` 事件为准；停止前产生的变更必须保留并如实汇报。
- 取消不删除任务、不删除已产生的变更集。

### 6.4 重试

`POST /tasks/{taskId}/retry`：

- 生成**新任务**，旧任务与其事件只读保留；新任务的 `retryOfTaskId` 记录来源（见 §8 扩展字段）。
- 重试沿用原请求的 prompt/引用/约束，但必须重新校验版本（`If-Match` 语义）；版本已变则 `412`，要求用户确认后重新发起。
- 仅 `failed`/`cancelled` 可重试；`completed` 重试返回 `409 conflict`。

## 7. 事件流

### 7.1 事件

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | 事件 ID |
| `seq` | number | 单任务内单调递增，从 1 开始；断线续传依据 |
| `taskId` | string | 所属任务 |
| `kind` | `accepted`/`progress`/`build`/`complete`/`error`/`cancelled` | 与状态迁移一一对应 |
| `status` | TaskStatus | 事件发生后的任务状态 |
| `message` | string | 面向用户的可观察说明；**不得包含模型推理** |
| `at` | ISO 8601 | 时间 |
| `data` | object? | 机器可读补充（节点、文件数等） |
| `demo` | `true`? | 演示事件 |

**顺序保证**：同一任务的事件按 `seq` 严格递增；不同任务之间无顺序保证。

**终态唯一**：`complete`/`error`/`cancelled` 三者只出现一个；出现后再无事件（心跳除外）。

### 7.2 SSE

`GET /tasks/{taskId}/events`：

```
id: 1
event: snapshot
data: {"type":"snapshot","task":{...},"events":[...]}

id: 2
event: event
data: {"type":"event","event":{"id":"e2","seq":2,...}}

event: end
data: {"type":"end","status":"completed"}
```

- 重连带 `Last-Event-ID: <seq>`，服务端从 `seq+1` 继续；超过 200 条缺口先发 `snapshot`。
- 终态后发 `end` 并关闭；连接断开**不得**被前端解释为完成。
- 事件历史接口 `GET /tasks/{taskId}/events/history?afterSeq=&limit=` 用于 SSE 不可用时的轮询补齐。

## 8. 类型扩展字段

以下字段在 `AgentTask` 上按需出现（本契约冻结时一并纳入类型）：

- `retryOfTaskId?: string` —— 重试来源。
- `cancelRequestedAt?: IsoDateTime` —— 已请求取消、尚未终止。
- `finishedAt?: IsoDateTime` —— 终态时间；`updatedAt` 可能因其他元数据变化，不用它判断完成时间。

## 9. 与运行/检查/渲染的派生关系

| WorkflowRunStatus | TaskStatus |
|---|---|
| `pending` | `queued` |
| `running`（未进入构建） | `running` |
| `running`（事件 kind=build） | `building` |
| `succeeded` | `completed` |
| `failed` | `failed` |
| `cancelled` | `cancelled` |

- 映射由后端完成，前端不自行推导。
- `render` 任务的完成 = `RenderJob.status=completed`；渲染失败映射 `failed`，取消映射 `cancelled`。
- `check` 任务的完成 = `CheckRun.status=completed`（**不等于检查通过**）；`failed` 表示检查器出错。
- `restore` 任务完成前，项目内容保持原样；完成事件之后才可重新读取项目。

## 10. 错误与边界

- 无 Agent 进程：`503 agent_unavailable`，前端保持任务入口可用但提交后立刻失败并提示「Agent 未连接」，不创建假任务。
- 能力未接入：`422 capability_unavailable`，`details.capability` 指明是哪项。
- 任务标题由后端生成，前端不传；标题必须是人话（「调整开场字幕」），不是模型名或技术动作。
- 不提供「修改任务请求」端点；改需求 = 新任务。
- 不提供跨项目任务列表；任务属于项目。
- 事件 `message` 不得出现思考过程、prompt 原文、token 统计。
