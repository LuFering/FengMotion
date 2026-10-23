# 契约 · 任务协议（TaskRequest / AgentTask / TaskEvent / ChangeSet）

状态：**待评审冻结**。类型实体：`src/types/contracts.ts` 的任务段。
定位：后端与 agent 集成的唯一入口契约。视图只经 `src/services/studioApi.ts` 调用，不直接拼装任务、不自行维护状态。

## 1. 边界

- 本契约定义：任务请求、任务实体、事件流、变更结果、与运行/检查的关系。
- 不定义：模型提示词、agent 内部编排步骤、构建实现、UI 交互。
- 任务状态是**全站执行状态的唯一驱动源**：工作台摘要、任务页签、创作列表卡片读同一份 `AgentTask.status`，不各存一份。
- 事件流是状态迁移的唯一可观察出口；除事件外不存在「静默改状态」的通道。

## 2. TaskRequest（请求）

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `kind` | TaskKind | 是 | `modify` / `render` / `undo` / `redo` / `restore` |
| `prompt` | string | 是 | 用户自然语言意图；`render`/`undo`/`redo`/`restore` 可为空串 |
| `scope` | `project`/`scene`/`selection` | 是 | 作用域；与 `sceneIds` 配合 |
| `sceneIds` | string[] | 是 | `scope='scene'` 时必填 ≥1；其余为空数组 |
| `references` | AgentReference[] | 否 | 结构化引用（target/context），见 §3 |
| `constraints` | ModificationConstraints | 是 | 修改约束，见 §4 |
| `attachments` | TaskAttachment[] | 是 | 附件元信息（name/type/size），无附件为空数组 |

**请求不可变**：任务开始后请求内容不得被改写；改需求 = 新任务。

## 3. AgentReference（指认）

`kind` 六选一：`project` / `shot` / `frame` / `range` / `region` / `artifact`。
共同字段：`id`（引用项自身 ID）、`role`（`target` 修改对象 / `context` 只读上下文）、`label`（展示文案）。

定位一律用稳定 ID / 精确帧 / 归一化区域 / 产物版本：

- `frame`：`shotId + frame + timecode`，可带 `snapshotId`
- `range`：`shotId + startFrame + endFrame + timecode`
- `region`：`shotId + frame + bbox{x,y,w,h}`（归一化 0–1）
- `artifact`：`artifactId + version`

规则：

- 一个请求**至多一个 `target`**；多个 target 视为无效请求，由后端拒收。
- 不让模型从「这里/这段」猜位置：没有可解析的引用，就必须回到用户澄清，不做兜底猜测。

## 4. ModificationConstraints（约束）

| 字段 | 类型 | 说明 |
|---|---|---|
| `preserveCamera` | boolean | 不动运镜 |
| `preserveCaptions` | boolean | 不动字幕 |
| `limitToSelection` | boolean | 只改选区 |
| `reuseExistingComponents` | boolean | 复用已有组件，不新建 |
| `durationSeconds` | number? | 目标时长（秒） |
| `resolution` | `1080p`/`1440p`/`4k`? | 目标分辨率 |

约束是**硬约束**：与用户 prompt 冲突时，拒绝执行并回报冲突，不擅自取舍。

## 5. AgentTask 与 TaskEvent

**AgentTask**：`id`、`kind`、`status`、`title`、`createdAt`（ISO 8601）、`demo?`。

**TaskEvent**：`id`、`taskId`、`kind`、`status`、`message`、`at`（ISO 8601）、`demo?`。

事件规则：

1. **单调**：`status` 只前进不回退；`at` 单调不减；同一任务内 `id` 唯一且可按序比较。
2. **可重放**：把某任务的事件按序重放，必须得到与实时订阅一致的最终状态（含消息列表）。
3. **不描述推理**：`message` 只写可观察操作与结果，不写模型思考过程。
4. **必达的第一个事件**：`accepted`（status=`queued`）。没有 `accepted` 的任务视为未创建。
5. **终态唯一**：`complete` / `error` / `cancelled` 三者只出现一个，且必须是最后一个事件。

**事件种类 → 状态迁移**

| kind | status | 出现时机 |
|---|---|---|
| `accepted` | `queued` | 请求被接受并排队（第一个事件） |
| `progress` | `running` | 开始执行 |
| `build` | `building` | 进入构建/编译子阶段（仍在运行中） |
| `complete` | `completed` | 成功结束 |
| `error` | `failed` | 失败结束，`message` 说明可操作原因 |
| `cancelled` | `cancelled` | 用户取消或运行被中止 |

> 取消是**幂等**的：对同一任务重复取消只产生一个 `cancelled` 事件；对终态任务取消是 no-op（不报错、不补发事件）。

## 6. 与运行、检查的关系（不重复定义）

- 任务 ↔ 运行：`WorkflowRun.taskId` 指向本任务；一次任务最多一个活动运行，重试产生新 `runId`。
- 任务 ↔ 检查：`CheckRun.taskId` / `renderId`；检查不复制任务的字段。
- **状态派生方向**：`WorkflowRun.status` 是执行事实，`AgentTask.status` 是产品可见派生值，映射如下（只在事件出口写一次）：

| WorkflowRunStatus | TaskStatus | 事件 |
|---|---|---|
| `pending` | `queued` | `accepted` |
| `running` | `running` / `building` | `progress` / `build` |
| `succeeded` | `completed` | `complete` |
| `failed` | `failed` | `error` |
| `cancelled` | `cancelled` | `cancelled` |

## 7. ChangeSet（变更结果）

| 字段 | 类型 | 说明 |
|---|---|---|
| `taskId` | string | 所属任务 |
| `files` | `{path, summary, additions, deletions}[]` | 变更文件与摘要；无改动为空数组 |
| `buildStatus` | `not-run`/`passed`/`failed` | 构建结论；未跑构建必须为 `not-run`，不得默认 `passed` |
| `demo?` | DemoFlag | 演示数据标记 |

规则：

- `ChangeSet` 只在任务 `completed` 后存在完整数据；运行中读取返回 `null`，不得返回半成品当结果。
- 构建失败 ≠ 任务失败：任务可以 `completed` 且 `buildStatus='failed'`，此时 UI 必须显式提示，不得显示为全绿。

## 8. 演示标记

- 演示适配器产出的 `AgentTask` / `TaskEvent` / `ChangeSet` 带 `demo: true`，UI 必须显示「演示」标识。
- 真实后端**不返回该字段**（不是返回 `false`）。
- 演示链路只能表述为「交互连通」，不得表述为「真实执行完成」。

## 9. 已知实现债（随实现阶段消化，不在本 PR 改）

- 演示适配器的时间字段目前输出本地时间文案（`HH:mm:ss`），契约要求 ISO 8601；实现阶段统一改为 ISO，并在视图侧格式化。
- `undo`/`redo`/`restore` 目前走与 `modify` 相同的演示链路，未体现「反向操作」语义。
- 取消对已终态任务是 no-op，演示适配器当前未显式处理该分支。
