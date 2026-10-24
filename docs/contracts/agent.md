# 契约 · 对话（ChatSession / ChatMessage / Stream）

状态：**待评审冻结**。类型：`ChatSession`、`ChatMessage`、`ChatMessageCreateRequest`、`ChatStreamMessage`。
定位：工作台右栏的自然语言入口；对话可以只聊天，也可以触发任务。**对话不是任务状态源**。

## 1. 边界

- 定义会话、消息、流式回复、任务关联与附件引用。
- 不定义模型、prompt 模板、Agent 内部编排、工具调用细节。
- 消息文本只呈现给用户；**不得包含模型推理过程、内部工具日志、token 统计**。
- 任务状态仍以 `AgentTask` 为准；对话只记录「这条消息触发了哪个任务」。

## 2. 会话

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | 会话 ID |
| `projectId` | string | 所属项目；对话不跨项目 |
| `title` | string | 标题；可由首条消息摘要生成 |
| `createdAt` / `updatedAt` | ISO 8601 | 时间 |
| `messageCount` | number | 消息数（分页展示用） |
| `demo` | `true`? | 演示数据 |

端点：

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/projects/{projectId}/chat-sessions?cursor=` | 会话列表（最近更新倒序） |
| POST | `/projects/{projectId}/chat-sessions` | 新建会话 |
| GET | `/chat-sessions/{sessionId}` | 会话详情 |
| DELETE | `/chat-sessions/{sessionId}` | 删除会话（消息软删除，可审计） |
| GET | `/chat-sessions/{sessionId}/messages?cursor=&limit=` | 历史消息（时间正序返回） |
| POST | `/chat-sessions/{sessionId}/messages` | 发送消息 |
| GET | `/chat-sessions/{sessionId}/stream` | SSE 回复流 |

## 3. 消息

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | 消息 ID |
| `sessionId` | string | 所属会话 |
| `role` | `user`/`assistant`/`system` | 角色；`system` 只在内部使用，不下发展示 |
| `text` | string | 正文；Markdown 允许，渲染时防 XSS |
| `taskId` | string? | 该消息触发的任务 |
| `references` | AgentReference[]? | 结构化引用（场景/帧/区域/产物） |
| `attachments` | TaskAttachment[]? | 附件元信息 |
| `createdAt` | ISO 8601 | 时间 |
| `demo` | `true`? | 演示数据 |

`POST /chat-sessions/{sessionId}/messages`：

```json
{
  "text": "把开场字幕改成两行",
  "references": [{ "id": "scene:s01", "role": "target", "kind": "scene", "sceneId": "s01", "label": "s01 开场" }],
  "attachments": [],
  "constraints": { "preserveCamera": true, "preserveCaptions": false, "limitToSelection": false, "reuseExistingComponents": true }
}
```

返回 `202` + `{ message: ChatMessage, taskId?: string }`：

- 只是聊天：`taskId` 不出现，回复走 SSE。
- 触发任务：`taskId` 出现，消息与任务同时创建；任务状态通过 `/tasks/{taskId}/events` 订阅，不塞进对话流。
- 至多一个 `target` 引用；多个 target → `400 validation_error`。
- 空文本 + 无附件 → `400 validation_error`。

## 4. 流式回复

`GET /chat-sessions/{sessionId}/stream`：

```
event: delta
data: {"type":"delta","messageId":"m2","delta":"好的，"}

event: completed
data: {"type":"completed","message":{"id":"m2","sessionId":"c1","role":"assistant","text":"好的，我会...","createdAt":"..."}}

event: task
data: {"type":"task","messageId":"m2","taskId":"t1"}

event: end
data: {"type":"end"}
```

- `delta` 只追加文本；同一 `messageId` 的 delta 按到达顺序拼接。
- `completed` 给最终完整消息（以它为准，覆盖已拼接的文本）。
- `task` 可在 `completed` 前后出现；前端据 `taskId` 另开任务事件流。
- 流中错误：`event: error` + `ApiErrorDetail`；不得用半截文本冒充完成。
- 断线重连：`Last-Event-ID` 为消息内序号；已 `completed` 的消息不重放 delta。

## 5. 会话与任务的关系

- 一条用户消息最多触发一个任务；任务失败不删除消息。
- 任务的事件不回写对话文本（避免两份状态）；对话只显示「任务 #id · 进行中/失败」的引用卡片。
- 重试任务不新增对话消息；由任务页签发起。
- 删除会话不取消其任务；任务继续，但 UI 不再展示关联消息（服务端保留审计记录）。

## 6. 规则与边界

- Agent 未连接：`503 agent_unavailable`；消息不落库（或落库标 `failed`），不得假装已发送。
- 不允许把模型思考过程、工具调用参数明文写进 `text`；只给结论与可观察动作。
- 附件必须先上传为 `Asset` 或上传会话，再以 `fileId` 引用；不在消息里传 base64。
- 对话历史是项目数据，跨项目不可见；不提供全局聊天列表。
- 演示模式的助手回复必须带 `demo: true`，并明确「演示模式，未连接 Agent」。
