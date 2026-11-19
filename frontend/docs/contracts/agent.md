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

- `delta` 默认追加文本；同一 `messageId` 按到达顺序拼接。可选 `replaceFrom` 为 UTF-16 字符偏移，表示从该位置替换尾部，用于重试或已提交段落修正流式临时文本。
- `completed` 给最终完整消息（以它为准，覆盖已拼接的文本）。
- DSH 多阶段的公开正文会依次保留，阶段内部允许无正文的连续工具调用。`status.phase=tool` 开始帧与消息的 `toolCalls[]` 可带 `textOffset`，标记调用发生时正文的 UTF-16 长度；实时和历史均按这些位置交替展示阶段正文与调用组。旧记录无偏移时保留原分区展示，不猜顺序。
- `done` 只表示整轮结束，不在首段阶段说明到达时提前发送。
- 思考按阶段分段：`reasoning` 帧在按阶段排正文时带 `textOffset`（发生时正文的 UTF-16 长度）与 `order`；`status.phase=tool` 开始帧与 `toolCalls[]` 也带同一套 `order`。同一正文位置上，思考与工具调用按 `order` 分先后（DSH 每一步是「思考 → 正文 → 工具」，这一步的思考与上一步的工具落在同一位置）。
- 落库消息与 `completed` 帧可带 `reasoningSegments: [{ textOffset, order, text }]`；`reasoning` 仍是整段拼接。旧消息没有分段，界面整块显示 `reasoning`；分段或工具缺 `order` 时同样不分段，不猜顺序。
- 对话与制作 Agent 使用按工作块交流的指引：阶段开始前短述目标，完成、切换或遇阻时说明结果，同阶段可以连续调用工具，不要求逐工具旁白。规则写在项目 `AGENTS.md` 的「交流方式」一段（指引 v5，启动时自动升级带框架标记的旧项目）；工作目录的指引里没有这一段时，才拼进本轮消息兜底。模型内部推理仍与用户可见正文分离。
- 自动出片：会话属于项目、且这一轮改动了工程源码（`src/`、`public/`、`film.config.json`、`package.json`）时，后端在 `completed` 之后渲染一次，按顺序发 `render` 帧：`{ type:"render", state:"rendering", message }`，渲染期间每 15 秒一帧 `heartbeat`，最后 `state` 为 `rendered`（带 `version`、`artifactPath`）、`failed` 或 `skipped`（没有可用的 `film.config.json` 入口，或项目正在制作/渲染）。源码没变时不发。这一轮失败（非用户停止）时同样先渲染，`render` 帧在 `error` 之前。
- `task` 可在 `completed` 前后出现；前端据 `taskId` 另开任务事件流。
- 流中错误：`event: error` + `ApiErrorDetail`；不得用半截文本冒充完成。
- 一轮的运行与订阅分开：后端在自己的线程里跑一轮，每一帧带 `id`（这一轮内从 1 递增）存进缓冲；回复流请求只是订阅，先补发、再推后续，等待期间每 15 秒一帧 `heartbeat`。请求断开不影响这一轮，它照常跑完、落库、出片。没有前台时长、不再转后台（不再发 `background` 帧），只有一个 6 小时的防卡死兜底。
- 同一条用户消息只跑一次：再次订阅（含跑完之后）都是补发。可选查询参数：`attach=true` 只接上已有的一轮，没有就返回 409 `turn_not_running`，不新开；带 `Last-Event-ID` 时同样只接上；`rerun=true` 表示用户点了「重新执行」，上一轮跑完了也再跑一次。另一条消息的一轮还在跑时返回 409 `session_busy`。每个会话只保留最近一轮的缓冲，后端重启后清空。
- 没跑完的一轮（引擎失败、进程退出，用户主动停止除外）：已有正文或工具调用时存成一条回复，正文末尾标明「这一轮没有完成：原因」，先发 `completed` 再发 `error`。
- 断线重连：`Last-Event-ID` 为这一轮内的帧序号，从它之后补发。

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
