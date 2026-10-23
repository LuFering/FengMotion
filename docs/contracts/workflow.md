# 契约 · 工作流（WorkflowDefinition / WorkflowRun）

状态：**待评审冻结**（01 期交付物）。类型实体：`src/types/contracts.ts` 的 `WorkflowDefinition` / `WorkflowRun`。
口径依据：01 期施工规格书 §6.1；本文与类型、`docs/contracts/check.md`、`docs/contracts/task.md` 必须三者一致，不一致以本文 + 类型同步修正，不允许各写一套。

## 1. 边界

- 本契约只约定**字段、状态、关联、接口边界**，不含实现、不含 UI、不含 mock 后端。
- 定义（Definition）是配置，运行（Run）是实例；同一份定义可被多次运行，每次运行各自留结果快照。
- 原生页面与过渡期 iframe 共用同一份运行数据，不许各存一份。

## 2. WorkflowDefinition

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | string | 是 | 稳定 ID；同一工作流的多个版本共用此 ID |
| `name` | string | 是 | 展示名，允许修改（改名不升 version） |
| `version` | number | 是 | 结构版本，每次节点/连线/端口变更 +1 |
| `nodes` | WorkflowNode[] | 是 | 节点数组，`id` 在定义内唯一 |
| `edges` | WorkflowEdge[] | 是 | 连线数组，一条连线只能连一对端口 |
| `createdAt` / `updatedAt` | ISO 8601 | 是 | `updatedAt` 仅在结构或名称变化时更新 |

**WorkflowNode**

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | string | 是 | 定义内唯一 |
| `type` | string | 是 | 节点类型标签，由运行时注册表解释；契约不枚举具体实现 |
| `params` | Record<string, unknown> | 是 | 节点参数；结构由节点类型决定，契约只保证可序列化 |
| `inputs` / `outputs` | WorkflowNodePort[] | 是 | 端口声明；空数组表示无端口 |
| `meta` | Record<string, unknown> | 否 | 展示/归因信息，不参与执行语义 |

**WorkflowNodePort**：`name`（端口名，同侧唯一）、`type?`（数据类型标签，仅提示）、`required?`（必填端口未连线 → 运行期 failed，error 带 `nodeId` + `port`）。

**WorkflowEdge**：`id`、`from: { node, port }`、`to: { node, port }`。连线只连端口，不连节点；同一目标端口只允许一条入边。

**版本规则**：已发布 version 不可原地修改；改结构必须产生新 version。运行实例记录它当时使用的 `definitionVersion`，定义后续变更不回写历史运行。

## 3. WorkflowRun

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `runId` | string | 是 | 运行实例 ID |
| `taskId` | string | 是 | 关联任务；任务状态由运行状态派生（映射见 task.md） |
| `definitionId` / `definitionVersion` | string / number | 是 | 记录本次运行用的定义快照 |
| `status` | WorkflowRunStatus | 是 | 见 §4 状态机 |
| `nodeIO` | Record<nodeId, { inputs, outputs }> | 是 | 各节点输入输出快照；**未执行的节点不出现**，不允许用空对象冒充已执行 |
| `error` | WorkflowRunError | 否 | 仅 failed 存在：`nodeId?`、`port?`、`message`、`code?` |
| `startedAt` | ISO 8601 | 是 | 创建即开始 |
| `completedAt` | ISO 8601 | 否 | 仅终态存在；running 时字段不出现 |

## 4. 状态机

```
pending ──→ running ──→ succeeded
                     ├─→ failed
                     └─→ cancelled
```

- 单向、不回退；终态（succeeded/failed/cancelled）不可再迁移。
- 取消只在 pending/running 有效；取消后 `completedAt` 照常写入，`nodeIO` 保留已执行节点的快照。
- 失败不改写已完成节点的输出：`nodeIO` 是事实记录，不是最终态重算。

## 5. 关联与查询口径

- **一次任务最多一个活动运行**；重试产生新 `runId`，旧运行保留（只读）。
- 定位链：`taskId → runId`（运行结果）、`runId + nodeId`（节点级输入输出与错误）。
- 检查契约通过 `taskId`/`renderId` 关联本运行，不复制运行字段（见 check.md）。

## 6. 接口边界

- 前端只经 `src/services/` 取运行数据；视图不得自行拼装 `nodeIO`。
- 事件流（进度）走 task 契约的 `TaskEvent`，本契约只定义运行的**状态与结果快照**，不定义流式协议。
- 后端实现不得在契约字段外扩展隐藏字段给前端读（扩展须先改本文件与类型）。

## 7. 明确不做

- 不做运行期编辑图（DAG 变更）——定义变更即新 version。
- 不做部分成功（partial success）状态；未完成即 failed 或 cancelled。
- 不在本契约内定义画布交互、节点渲染、拖拽。
