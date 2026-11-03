# 契约 · 工作流（WorkflowDefinition / WorkflowRun）

状态：**待评审冻结**。类型：`WorkflowDefinition`、`WorkflowSummary`、`WorkflowTemplate`、`WorkflowRun`。
口径：定义是配置，运行是实例；同一份定义可被多次运行，每次运行各自留结果快照。

## 1. 边界

- 只约定字段、状态、关联、端点与错误；不含节点实现、不含 Agent 编排、不含画布 UI。
- 原生页面与过渡期 iframe 共用同一份运行数据，不许各存一份。
- 工作流定义 ≠ 创作任务：定义可复用，任务是一次具体制作。

## 2. WorkflowDefinition

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | string | 是 | 稳定 ID；多个版本共用 |
| `projectId` | string \| null | 是 | 归属项目；null = 全局模板 |
| `name` | string | 是 | 展示名，改名不升 version |
| `description` | string | 是 | 一句话用途，可为空串 |
| `version` | number | 是 | 结构版本，节点/连线/端口变更 +1 |
| `status` | `draft`/`published`/`archived` | 是 | 发布后才能被其他项目引用 |
| `tags` | string[] | 是 | 筛选标签 |
| `nodes` | WorkflowNode[] | 是 | 节点数组，`id` 定义内唯一 |
| `edges` | WorkflowEdge[] | 是 | 连线数组 |
| `createdAt` / `updatedAt` | ISO 8601 | 是 | 时间 |
| `etag` | string | 是 | 条件更新凭证 |
| `demo` | `true` | 否 | 演示数据 |

**WorkflowNode**：`id`、`type`、`params`、`inputs`/`outputs`（`WorkflowNodePort[]`）、`meta?`。
**WorkflowNodePort**：`name`（同侧唯一）、`type?`、`required?`。
**WorkflowEdge**：`id`、`from{node,port}`、`to{node,port}`。

- 连线只连端口，不连节点；同一目标端口只允许一条入边。
- `required` 端口未连线 → 运行前校验失败（`validation_error`），不创建半成品运行。
- `params` 必须可 JSON 序列化；不允许函数、文件句柄、循环引用。

## 3. 版本规则

- 已发布 version 不可原地修改；改结构必须产生新 version。
- `PATCH` 保存 = 新 version，旧 version 只读保留。
- 运行记录 `definitionVersion`；定义后续变更不回写历史运行。
- 删除有运行记录的定义 → 归档（`status=archived`），不物理删除。

## 4. 端点

### 4.1 定义

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/workflows?projectId=&status=&q=&tag=&cursor=` | `Page<WorkflowSummary>` |
| POST | `/workflows` | 新建（空白或 `templateId`） |
| GET | `/workflows/{workflowId}?version=` | 详情；不传 version 取最新 |
| PATCH | `/workflows/{workflowId}` | 保存新 version，带 `If-Match` |
| DELETE | `/workflows/{workflowId}` | 无运行时删除；有运行时归档 |
| GET | `/workflows/{workflowId}/versions` | 版本历史（只读元信息） |

`POST /workflows`：

```json
{ "projectId": "p1", "name": "口播科普 · 默认", "description": "三段式", "templateId": "tpl_oral" }
```

或：

```json
{ "projectId": null, "name": "自定义", "nodes": [], "edges": [] }
```

- `templateId` 与 `nodes/edges` 二选一，同时提供 `400 validation_error`。
- 新定义 `version = 1`，`status = draft`。

`PATCH /workflows/{workflowId}`：

- 必须带 `If-Match`；合并后若节点/连线/端口有变，`version += 1`。
- 只改 `name`/`description`/`tags` 不升 version，但要更新 `etag`。
- `status=published` 前必须通过结构校验（无环、端口存在、必填输入有来源）。

### 4.2 模板

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/workflow-templates?genomeId=&q=&tag=&cursor=` | 模板广场 |
| GET | `/workflow-templates/{templateId}` | 详情（含定义快照） |

- 模板是只读定义快照；从模板创建 = 复制为新定义，后续修改不影响模板。
- `definitionId` + `definitionVersion` 记录模板基于哪份定义；模板升级不自动改已创建的定义。

### 4.3 运行

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/workflows/{workflowId}/runs` | 启动运行，返回 `202` + `WorkflowRun` |
| GET | `/workflows/{workflowId}/runs?status=&cursor=` | 该定义的运行列表 |
| GET | `/workflow-runs/{runId}` | 运行详情（nodeIO/error） |
| POST | `/workflow-runs/{runId}/cancel` | 取消（仅 pending/running） |

`POST .../runs`：

```json
{ "projectId": "p1", "inputs": { "topic": "Token 是什么" }, "sceneIds": ["s01"] }
```

- 缺少必填输入 → `400 validation_error`，`details.missingInputs` 列端口名。
- 启动成功同时创建任务；返回 `runId` 与 `taskId`，前端用 `taskId` 订阅事件流。
- 取消语义同任务：是请求不是保证；已产生的 nodeIO 保留。

## 5. 运行状态机

```
pending ──► running ──► succeeded
   │           │
   ├───────────┴──► failed
   └───────────┴──► cancelled
```

- 单向不回退；终态不可再迁移。
- `failed` 必须带 `error.message`；能定位时带 `nodeId`/`port`/`code`。
- `cancelled` 不得显示为成功；未执行节点不出现在 `nodeIO`。

## 6. nodeIO

- `Record<nodeId, { inputs, outputs }>`；**未执行的节点不出现**，不允许用空对象冒充已执行。
- `inputs` 记录运行时实际输入（解析后的值），不是定义里的模板值。
- `outputs` 只放可序列化结果；大文件放 `outputs.fileId/url`，不内联 base64。
- 运行结束后 `nodeIO` 只读；复跑 = 新 run。

## 7. 与任务/检查的关系

- 每个运行对应一个任务，`runId` 与 `taskId` 一一对应。
- 任务事件流中的 `data.nodeId` 可用于把进度定位到画布节点。
- 运行成功不等于交付通过：检查是独立运行，见 `check.md`。
- 运行失败不自动回滚已写入的文件；回滚是 `undo` 任务，不是运行的一部分。
