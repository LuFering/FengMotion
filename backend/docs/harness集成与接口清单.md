# Harness 集成与接口清单

> ⚠️ **本文记录的是当时的规划与决策，其中「未实现」「包占位」「尚未接入」等说法已过期。**
> 现状请看 [`当前实现状态.md`](./当前实现状态.md)。本文保留原样以便追溯当时的取舍，
> 请勿据本文判断当前能力，也不要照本文重做已完成的模块。

本文回答两个问题：DSH（DeepSeek Harness）以什么方式接进后端，以及为了接它需要实现哪些接口。它是**实现前的对齐文档**，不是契约；对外字段与端点仍以 `../FengMotion-desktop/docs/contracts/` 为准。

文中标注「已查验」的结论来自实际命令输出或源码，标注「未验证」的是设计推断。

---

## 1. 结论

**接入 DSH 用官方 SDK（stdio JSON-RPC），已实现并端到端验证通过。**

状态（2026-11-02）：`GET /api/harnesses`、`GET /api/harnesses/{id}/models`、
`GET /api/chat-sessions/{id}/stream` 三个接口已落地，真实调用 DSH 成功产出助手回复，
多轮续接上下文验证通过。实现细节见 §10。

上一版文档曾建议「直连第三方提供商」拿 token 级流——**那是绕过 DSH，方向错了**，已删除。接入对象必须是 DSH。

按官方文档与实测，DSH 面向进程外集成的正式入口是 **SDK**（[官方指南](https://deepseekdocs.com/en/docs/guides/drive-harness-from-program)、[Python SDK](https://github.com/deepseek-ai/deepseek-harness/blob/master/python/sdk/README.md)）：SDK 启动 `dsh` profile 子进程，用换行 JSON-RPC 走 stdio，自己负责关闭。这比 `headless --json` 更正式（headless 只是「一次性任务」，SDK 才有 `initialize` / `session/prompt` / 通知订阅）。

### 1.1 流式能力的真实边界（已实测）

这是本文档最需要说清的一件事。DSH 内部**确实有** token 级实时流，但它**不走任何官方对外通道**（SDK / headless / ACP 都拿不到），只有 Web Remote `follow` 显式提供：

> **2026-11-02 修订：本节结论已被 §11 推翻。** `agent/assistant-stream` 是**进程内公开事件**，插件可以订阅；我们据此自写插件打通了 token 级流并实测成功。下表「official 通道拿不到」仍然成立，但「因此做不了」不成立。保留原文以记录当时的判断依据，读时以 §11 为准。

| 通道 | token 级实时流 | 实测/源码依据 |
|---|---|---|
| **SDK**（`dsh --profile sdk`） | ❌ 只发持久事件 | 实测：`step/start` 后 7.5 秒静默，直到 `assistant/message` |
| headless `--json` | ❌ 提交点投影 | 实测：`thinking`+`text` 同毫秒到达 |
| headless 默认模式 | ⚠️ 只有 stderr 推理，非最终文本 | 实测：1.6~2.0 秒一批，仅 `dsh: reasoning:` |
| ACP `session/update` | ❌ 提交点 | 实测：`agent_thought_chunk`+`agent_message_chunk` 同毫秒 |
| **Web Remote `follow`** | ✅ **有**，但「for the Web client」 | 源码：`SessionFollowRequest.assistantStream?: true` |

关键源码证据（`dsh-api-session-controller`）：

```ts
@Remote({ mode: 'stream', resources: { session: addressedSession } })
follow(request: SessionFollowRequest, signal: AbortSignal): AsyncIterable<SessionFollowFrame>

export interface SessionFollowRequest extends Pick<SessionPageRequest, 'maxMessages' | 'turnWindow'> {
    readonly address: SessionAddress;
    /** Include process-local assistant presentation frames for the Web client. */
    readonly assistantStream?: true;
}

export type SessionFollowFrame = ... | { readonly type: 'assistant-stream'; readonly frame: SessionAssistantStreamFrame; };

export type SessionAssistantStreamFrame =
  | { readonly type: 'start'; readonly attemptId; readonly revision; ... }
  | { readonly type: 'chunk'; readonly attemptId; readonly revision; readonly index; readonly time; readonly chunk: JsonValue; }
  | { readonly type: 'end'; ... };
```

`assistant-stream` 的 `chunk` 帧就是逐 token 实时推送，注释明确写「**for the Web client**」——它不是给进程外集成用的通用接口。

**结论**：走 SDK 时，文本是**步骤提交点**到达（整段），拿不到打字机效果。这不是实现缺陷，是 DSH 对外接口的既定边界。

### 1.2 DSH 自身持久化了 token 分片（可作为「事后回放」）

虽然实时推送拿不到，但 **DSH 把 token 级分片完整写进了会话日志**，SDK 的 `session.event` 会带上它们。实测（SDK 通知里的 `assistant/message.data.stream`）：

```
chunk: block-start idx=0
reasoning-chunks: n=43  time0=1793546646207
   texts=['The', ' user wants exactly', ' "HELLO WORLD', ...]
   dt=[0, 1, 0, 0, 0, 1, 0, ...]        ← 每个 token 的相对时间间隔(ms)
chunk: block-start idx=1
text-chunks: n=1  time0=1793546646294
   texts=['HELLO WORLD']
chunk: block-end idx=0 / block-end idx=1
chunk: usage
chunk: finish
```

也就是说：**能拿到完整的 token 切分 + 真实时间间隔（`dt`）**，但整条记录在生成结束后才到达。

用途：**回放**。前端可以在收到后按 `dt` 节奏重放，得到视觉上的打字机效果，但它不是真的实时——用户仍需等整段生成完。是否要这种「伪流式」需产品决策；**不建议**，因为它会把「等待」拉得更长。

### 1.3 那 SSE 还有意义吗

有。SDK 的 `session.event` / `session.status` 虽然是持久事件，但**它们本身就是增量到达的**：`turn/start`、`step/start`、`tool/call`、`tool/result`、`step/end` 逐个推来。实测时序：

```
  4.035 [EVENT] permission/preset
  4.042 [STATUS] running
  4.043 [EVENT] turn/start
  4.096 [EVENT] step/start
  4.111 [EVENT] request/header
 11.615 [EVENT] assistant/message
 11.616 [EVENT] turn/end
 11.617 [STATUS] idle
```

所以 SSE 能如实呈现「**正在思考 → 调用工具 → 完成**」的阶段进度，只是最终文本一次性出现。这与 Claude Code 的 VSCode 插件体感一致（它也是按消息块提交，不是逐字）。

**推荐方案**：SDK + SSE 阶段级流式，`delta` 帧不发（见 §4.3），只发 `status` / `completed` / `end`。

---

## 2. DSH 对外能力（已查验）

### 2.1 四条通道

| 通道 | 启动方式 | 流式粒度 | 鉴权 | 适用 |
|---|---|---|---|---|
| **SDK stdio JSON-RPC** | `dsh --profile sdk` | 持久事件（增量到达） | 无 | ✅ **采用** |
| headless CLI | `dsh headless --json` | 提交点 | 无（本机进程） | 备选 |
| ACP stdio | `dsh --profile acp` | 提交点 | 无 | 否 |
| Web `/api` | `dsh web` | token 级（Remote 流） | 需 401 鉴权 | 否（仅 Web 客户端） |

Web 的 HTTP 接口一律返回 `401`（已查验：`/api`、`/api/health`、`/api/sessions`、`/api/plugins` 均为 401）。它的 token 级流走 Remote/WebSocket 协议，注释明确标注「for the Web client」，不适合 Java 侧直接接。

**为什么选 SDK 而不是 headless**：headless 是「一次性任务」，跑完即退，没有会话续接的正式契约、没有通知订阅、没有 `session/wait`；SDK 专为「进程外驱动本地 DSH」设计，有完整的 `initialize` / `session/prompt` / 通知订阅 / 生命周期关闭，官方也提供了 TypeScript 与 Python 两种客户端实现。两者都是 spawn 子进程，但 SDK 的协议更完整。

### 2.2 headless 事件流格式

实测输出（`dsh headless --json "..."`，已查验）：

```json
{"type":"session","sessionId":"session-...","cwd":"/tmp"}
{"type":"status","phase":"turn_start","turn":1}
{"type":"status","phase":"step_start","turn":1,"step":1}
{"type":"status","phase":"step_end","turn":1,"step":1}
{"type":"status","phase":"turn_end","turn":1,"reason":{...}}
{"type":"final","text":"..."}
```

关键约束（来自官方 README，已查验）：

- 事件流**以 `session` 开头、以 `final` 结尾**。
- 每个字符串与对象键上限 8 KiB，单行上限 32 KiB，超出标记 `truncated`；**只有 `final` 不受限**。
- 轮次内失败仍以 `final`（通常为空）结束且**没有** `error` 事件——**格式良好不代表成功**，必须同时看退出码与 `turn_end` 的 `reason`。
- runner 在轮次之外失败时发 `error` 事件、**不发** `final`。
- 退出码：`turn/end` 完成 → 0；aborted / error / 无轮次 → 1。

这两条决定了后端适配器的错误判定逻辑：**不能只看 `final` 是否存在**。

### 2.3 会话续接

`--session-id <id>` 可续接同一段对话（已查验，见 `--help`）。约束（官方 README）：

- 要求组合了 `sessionPersistence` 与 `sessionQuery`。
- 拒绝：记录在别的 cwd、未记录 cwd、子 agent / fork 会话、本 profile 不组合的 preset。
- 本进程内已有存活 Agent 持有该 id 时拒绝。

对本项目的含义：`ChatSession.id` **不能**直接当 `--session-id` 用（后端自己的会话 id 与 DSH 的 `session-<uuid>` 是两套标识）。需要在 chat 会话上增加一列保存 DSH session id，见 §4.1。

### 2.4 凭证（已查验，含实测）

headless 默认禁用托管凭据（`cordis.patch.yml` 中 `credentials` / `authorization` / `deepseek-account` 均 `disabled: true`，已查验），只用启动环境、`.env` 与 `$DSH_HOME/.env` 里的 `DEEPSEEK_API_KEY`。

要复用 GUI 已登录的 DeepSeek 账号，需要一份 patch，关键是下面**五个条目**（少任何一条都会退回 API key 路由）：

```yaml
- id: credentials
  disabled: false
- id: authorization
  disabled: false
- id: deepseek-account
  disabled: false
- id: llm-deepseek-account      # 容易被漏掉：只重开上面三行仍走 API key 路由
  disabled: false
- id: agent-default-model        # 默认是 deepseek-official（API key 路由）
  config:
    provider: deepseek-account   # 账号路由的 provider id
    model: deepseek-flash
```

实测结果（已查验）：

```
[llm-deepseek-account] model listing from https://api.deepseek.com/models loaded 2 model(s), skipped 0 row(s)
{"type":"status","phase":"turn_end","turn":1,"reason":{"kind":"error",
 "error":{"message":"Insufficient Balance (request_id: ...)","code":"ACCOUNT_QUOTA","status":402}}}
```

即：**凭证链路已打通，请求真的到达 `api.deepseek.com` 并成功列出模型**，当前阻塞是账号余额不足（402），不是技术问题。

注意 `--dump-config` 可以验证 patch 是否生效（`disabled` 应从 `true` 变 `false`），这是排查凭证问题的第一手段。

### 2.5 让 DSH 走第三方提供商（已实测）

这台机器的实际路由不是 `deepseek-official`，而是第三方提供商。**这不改变接入方式**——SDK 照样启动 `dsh` 子进程，只是要让子进程的组合里带上提供商的 provider 配置。配置在 `~/.dsh/profiles/desktop/cordis.patch.yml`（`llm-pi-ai` 的 `providers`）：

| provider id | 端点 | 凭据引用 | 可达性 |
|---|---|---|---|
| `agent2api-ecs` | `http://127.0.0.1:13067/v1` | `AGENT2API_ECS_API_KEY` | ✅ 实测 200 |
| `zhipu` | `https://open.bigmodel.cn/api/paas/v4/` | `ZHIPU_API_KEY` | 未测 |
| `wb-china` / `wb-world` | `http://127.0.0.1:8788/v1` | `WB_*_API_KEY` | ❌ 连接失败（`acp` profile 默认用这个，所以 `acp` 需覆盖 provider 才能跑） |

`agent2api-ecs` 是 OpenAI 兼容网关。让 SDK 子进程走它需要这份 patch（实测可用，`--profile sdk` 与 `headless` 都能用）：

```yaml
- id: credentials          # 必须重开：否则读不到 .credentials.yaml 里的 key
  disabled: false
- id: authorization
  disabled: false
- id: llm-pi-ai
  config:
    providers:
      agent2api-ecs:
        apiKeyEnv: AGENT2API_ECS_API_KEY
        api: openai-completions
        baseURL: http://127.0.0.1:13067/v1
        models:
          - id: deepseek-v4.1-flash
            name: DeepSeek-V4.1-Flash
            contextWindow: 1000000
            maxTokens: 128000
- id: agent-default-model
  config:
    provider: agent2api-ecs
    model: deepseek-v4.1-flash
```

实测成功输出（这是**第一次拿到完整成功事件流**）：

```json
{"type":"session","sessionId":"session-c509fa0a-...","cwd":"/tmp"}
{"type":"status","phase":"turn_start","turn":1}
{"type":"status","phase":"step_start","turn":1,"step":1}
{"type":"thinking","text":"The user asks to count 1 to 5 ..."}
{"type":"text","text":"1, 2, 3, 4, 5"}
{"type":"status","phase":"step_end","turn":1,"step":1,"usage":{"inputTokens":6257,"outputTokens":103,"totalTokens":6360}}
{"type":"status","phase":"turn_end","turn":1,"reason":{"kind":"completed"}}
{"type":"final","text":"1, 2, 3, 4, 5"}
```

注意 `step_end` 携带 `usage`（`inputTokens`/`outputTokens`/`totalTokens`），可用于计费与配额。

### 2.6 SDK 协议（推荐接入方式，已实测）

SDK 是 DSH 面向进程外集成的正式入口。官方指南原文：

> the SDK starts a `dsh` profile as a subprocess, drives it over newline JSON-RPC on stdio, and owns shutdown

启动方式（`sdk` 是内置 profile，无需创建）：

```sh
dsh --profile sdk --patch <your-patch.yml>
```

实测握手成功（`initialize` 返回）：

```json
{"jsonrpc":"2.0","id":1,"result":{"serverInfo":{"name":"deepseek-harness-sdk-runtime","version":"0.0.1"}}}
```

**协议方法**（来源：官方 SDK 指南 + `dsh-sdk-protocol` 类型定义，已查验）：

| 方向 | 方法 | 载荷 |
|---|---|---|
| client→server | `initialize` | `{cwd, provider, model, reasoningEffort?, maxTokens?}` |
| client→server | `session/prompt` | `{sessionId, contentBlocks:[{type:'text',text:'...'}]}` → `{messageId}` |
| client→server | `session/resume` | `{sessionId}` |
| client→server | `session/wait` | `{sessionId}` |
| client→server | `shutdown` | `{}` |
| server→client | `session.event` | 完整会话日志事件（**所有会话，未过滤**） |
| server→client | `session.status` | 整个 Agent 的 `running` / `idle` |
| server→client | `subagent.started` / `subagent.finished` | 子会话生命周期 |

两个实测踩过的坑：

1. **字段名是 `contentBlocks`，不是 `prompt`**。写成 `prompt` 会得到 `-32603 Cannot read properties of undefined (reading 'filter')`——这个错误信息完全没有提示性。
2. **`session/prompt` 的 `sessionId` 是 SDK 侧标识，未知 id 会惰性创建**。它和 DSH 持久化会话的 `session-<uuid>` 是两套命名，但同一个 id 会持续对应同一个会话。

`session.event` 的 `event` 字段就是会话日志里的原始记录（含 `seq` / `time` / `data`），因此可以直接用 `seq` 做去重与断点续传，这对实现 `Last-Event-ID` 有帮助。

**stdout 只承载 JSON-RPC 帧**，诊断走 stderr——后端解析时不要把 stderr 混进 stdout 流。

---

## 3. 接口清单

分三批。P0 是打通 SSE 的最小闭环，P1 是让首页引擎选择器可用，P2 是状态真实化。

### 3.1 P0：harness 探测与 SSE 回复流

| # | 方法 | 路径 | 说明 | 现状 |
|---|---|---|---|---|
| 1 | GET | `/api/harnesses` | 引擎列表与可用性 | 未实现 |
| 2 | GET | `/api/harnesses/{id}/models` | 该引擎可用模型 | 未实现 |
| 3 | GET | `/api/chat-sessions/{sessionId}/stream` | 回复流（SSE） | 端点存在，固定 503 |

**#1 `GET /api/harnesses`**

```json
{
  "items": [
    {
      "id": "dsh-sdk",
      "name": "DeepSeek Harness",
      "kind": "sdk",
      "status": "available",
      "version": "0.2.1-rc.2",
      "note": null,
      "capabilities": { "streaming": "commit", "cancel": "process", "resume": true }
    }
  ]
}
```

- `status`：`available` / `unavailable` / `misconfigured`。
- `capabilities.streaming` 取 `commit` 或 `token`，**如实反映 §1.1 的落差**，让前端能解释为什么没有打字机效果。
- 探测方式：`dsh --version` 与 `dsh --profile sdk --dump-config` 退出码，结果缓存（建议 60 秒），避免每次请求都 spawn 进程。
- 探测失败不得返回空列表冒充「没有引擎」，应返回 `status: "unavailable"` 并带 `note`。

**#2 `GET /api/harnesses/{id}/models`**

```json
{ "items": [ { "id": "deepseek-flash", "label": "deepseek-flash", "default": true } ] }
```

数据来源是 DSH 的模型目录，**不在后端硬编码**。探测成本高，应缓存并在 `GET /api/harnesses` 里给出缓存时间。

**#3 SSE 回复流**

保留现有前置校验（会话存在、`Last-Event-ID` 合法），把 503 换成真实流。

**帧映射**（SDK 通道，无 token 级）：

| SDK 通知 | SSE 帧 | 说明 |
|---|---|---|
| （连接建立） | `event: heartbeat` | SDK 无内建心跳，后端每 15~30 秒发注释帧 |
| `session.status: running` | `event: status` | 界面显示「正在思考」 |
| `session.event: step/start` | `event: status` | 步骤开始 |
| `session.event: tool/call` | `event: status`（或 `event: task`） | 工具调用；映射到任务需 `task` 领域 |
| `session.event: tool/result` | `event: status` | 工具返回 |
| `session.event: assistant/message` | `event: completed` | **不发 `delta`**，见 §4.3；取 `data.message` 的完整文本 |
| `session.event: turn/end` | — | 看 `reason.kind` 判成败 |
| `session.status: idle` | `event: end` | 活动区间结束 |
| `turn/end` 的 `reason.kind=error` | `event: error` + `ApiErrorDetail` | 不得当成正常结束 |
| 子进程异常退出 / 超时 | `event: error` | 不得静默结束 |

**注意 `session/prompt` 的响应不是结果**：它立即返回 `{messageId}`（入队回执），真正的结束要等 `session.status: idle`。把 `messageId` 当成回复内容是最容易犯的错。

**必须遵守的现有契约**（`agent.md` §4，已查验）：

- `delta` 只追加文本，同一 `messageId` 的 delta 按到达顺序拼接。
- `completed` 给最终完整消息，**以它为准**。
- 流中错误发 `event: error`，**不得用半截文本冒充完成**。
- 已 `completed` 的消息重连时不重放 delta。

### 3.2 P1：能力状态真实化

| # | 方法 | 路径 | 现状 |
|---|---|---|---|
| 4 | GET | `/api/capabilities` | 已实现，但全部 `unavailable` |

`agent` 一项应按真实探测结果返回，而不是硬编码 `unavailable`。其余项（`remotionEditor`、`cloudRender`、`asr` 等）在对应能力未接入前保持 `unavailable`。

### 3.3 P2：对话流与任务的关联

`agent.md` §3 规定发消息可返回 `taskId`。DSH 的 `tool_call` 事件可映射为任务引用，但这需要先有 `task` 领域的实现（当前是包占位）。**建议本轮不做**，等 `task` 落地后再补。

---

## 4. 实现要点

### 4.1 会话标识映射（必须新增）

后端 `ChatSession.id` 与 DSH 的会话标识是两套。SDK 的 `session/prompt` 用 SDK 侧 `sessionId`，同一个 id 会持续对应同一个持久化会话（未知 id 惰性创建）。

做法：在 `chat_sessions` 增加一列（如 `harness_session_id`），第一次调用时生成并回写，之后每次带同一个值。

- 不回写的话每次都是全新 DSH 会话，**多轮对话会丢上下文**。
- 该列可空：从未调用过 harness 的会话保持 `NULL`。
- 迁移走现有 `config.DatabaseMigration`（启动期补列），沿用既有做法。

### 4.2 进程管理

SDK 的生命周期是「启动一个常驻子进程，多次 `session/prompt` 复用它」，与 headless「一次一进程」不同。两种做法：

| 策略 | 优点 | 缺点 |
|---|---|---|
| **常驻一个 SDK 进程** | 启动开销只付一次；会话续接自然 | 崩溃影响所有会话；需要健康检查与重启 |
| 每会话一个进程 | 隔离好 | 进程数随会话增长，内存开销大 |

**建议常驻单进程 + 按会话复用**，因为本机开发场景并发很低。要点：

- 必须有硬超时（建议 120 秒可配），到时终止子进程并发 `event: error`，**不得静默结束**。
- 取消：SDK 协议**没有** cancel 方法（官方明确写了「abandon a turn by closing the runtime process」）。因此 `capabilities.cancel` 如实标为 `process`，不要假装能优雅取消。
- 子进程意外退出：`TransportClosedError` 语义——需要检测并重启，同时在流里发 `event: error`。
- **`ELECTRON_RUN_AS_NODE` 不影响后端**（那是 Electron 的问题），但 `dsh` 必须在 `PATH` 或配置里给出绝对路径。

### 4.3 `delta` 取舍（原定不发 delta，已被 §11 推翻）

SDK 通道拿不到 token 级增量（见 §1.1），所以只有两个诚实的选择：

**方案 A：发 `delta`，内容是整段文本。**
前端不用改，但语义上 `delta` 不再是增量，违背契约「只追加文本」的假设。

**方案 B：不发 `delta`，只发 `completed`。**
严格诚实——没有增量就不假装有增量。源码上成立：`streams.ts` 中 `onDelta` 是可选参数（`onDelta?: (messageId: string, delta: string) => void`），`completed` 分支独立处理（已查验），缺 `delta` 不会破坏状态机。

**结论：B。** 理由：符合项目「不编造」的一贯原则。若将来 DSH 开放 token 级通道，补 `delta` 是纯增量改动，前端不用二次返工。

> **2026-11-02 修订**：§1.1 曾据此判定「SDK 通道拿不到 token 级增量」，这个结论**已作废**。`agent/assistant-stream` 是 DSH 的公开进程内事件，插件可以订阅，token 级增量因此可得。我们已用自写插件打通并实测（见 §11），`delta` 帧现已真实下发。原 A/B 取舍中 B 的「等 DSH 开放」前提不再成立。

### 4.4 分层落点

沿用 `ARCHITECTURE.md` 的依赖方向 `api → service → domain / store / client`：

```
harness/client/    DshSdkClient：spawn、JSON-RPC 帧收发、事件映射、超时、回收、重启
harness/domain/    HarnessDescriptor、HarnessModel、HarnessStatus（对外 record）
harness/service/   探测与缓存、模型目录、子进程生命周期与健康检查
harness/api/       /api/harnesses、/api/harnesses/{id}/models
chat/service/      把 SDK 通知写成 SSE（复用现有 ChatMessageService 落库）
chat/api/          替换 ChatStreamController 的 503
```

**边界**：`client` 只做进程与协议，不含业务判断；`service` 决定何时落库、何时发帧。这与 `harness/package-info.java` 里已写的计划一致（已查验）。

### 4.5 Java 侧如何实现 JSON-RPC

没有官方 Java SDK（官方只提供 TypeScript 与 Python）。但协议很简单——换行分帧的 JSON-RPC 2.0，不需要引入库：

- 用 `ProcessBuilder` 启动 `dsh --profile sdk --patch <file>`。
- 读 stdout 按行 `readLine()`，每行 `ObjectMapper.readValue` 成 `JsonNode`。
- 按 `method` 分派通知，按 `id` 匹配响应。
- 写 stdin 时 `write(json + "\n")` 并 flush。
- stderr 单独读，只用于诊断日志（**不要**混进事件流）。

唯一要注意的：`session/prompt` 是**立即返回 `{messageId}`**，真正的回复要靠 `session.event` + `session.status(idle)` 判定结束——不能等 `session/prompt` 的响应当成结果。

---

## 5. 前端契约缺口

接 CLI 通道会暴露三个契约未冻结的点，需要评审后回写 `docs/contracts/`：

1. **`delta` 的粒度未定义**。契约写「只追加文本」，但没规定必须是 token 级。CLI 通道只能给整段。
2. **心跳帧未定义**。`README §2.9` 提了空闲超时 45 秒，但没规定服务端心跳的帧名与间隔。CLI 无内建心跳，必须由后端补。
3. **`Last-Event-ID` 的语义未定义**。契约写「消息内序号」，但 CLI 通道没有跨进程的可重放事件流；重连只能重新 spawn，无法续读。**如实做法**：重连时若该消息已 `completed` 则直接补发 `completed`，否则从头重跑——两者都不算「续读」，需要写进契约。

---

## 6. 被否掉的方案

### 6.1 直连第三方提供商（方向性错误）

上一版文档曾建议绕过 DSH、直接调提供商的 `/v1/chat/completions` 来拿 token 级 SSE。**这个方案是错的**：它绕过了要接入的对象。即便能拿到逐字流，得到的也只是「裸对话」，没有 DSH 的工具、人设、多步编排、会话持久化——那不是接入 DSH。

记录下来是为了避免再次走偏。

### 6.2 headless `--json`

`dsh headless --json` 能跑，但它是一次性任务运行器：跑完即退，没有正式的会话续接契约、没有通知订阅、没有 `session/wait`。SDK 覆盖同样的能力且更完整，没有必要退回 headless。若只需要「一次性问答、不要 Agent 能力」，headless 仍是更轻的选择。

### 6.3 ACP stdio

`dsh --profile acp` 是标准 Agent Client Protocol 服务器，实测能跑（`initialize` 正常、`session/update` 正常）。但它刻意只提供标准 ACP 界面，明确不支持 DSH 特有呈现数据，且事件流同样是提交点。相比 SDK 没有优势，还多一层协议翻译。

### 6.4 Web Remote / WebSocket（token 级的唯一来源）

这是**唯一**能拿到 token 级实时流的地方（§1.1 的 `assistant-stream` 帧），但它：

- 需要实现 Typert 编解码与 `remote.mux` WebSocket 协议；
- 需要处理 Peer / principal / 访问判定；
- 注释明确写「**for the Web client**」，不是给进程外集成的通用接口；
- **耦合 DSH 内部协议**，版本升级会破。

如果产品后续硬性要求打字机效果，这是唯一的技术路径，但代价很高，且应作为独立项目评估，而不是顺手接上。

---

## 7. 验收标准

每个接口按现有 `ARCHITECTURE.md` 的要求验证「成功、参数错误、资源不存在、真实前端请求」四条路径。

针对本批：

- [ ] `GET /api/harnesses` 在 `dsh` 不在 PATH 时返回 `unavailable` 而**不是**空列表或 500。
- [ ] `GET /api/harnesses` 在正常机器上返回真实 `version`（与 `dsh --version` 一致）。
- [ ] `GET /api/harnesses/{id}/models` 的模型来自 DSH，不在代码里硬编码。
- [ ] SDK 子进程能被正确启动并完成 `initialize` 握手（`serverInfo.name` 为 `deepseek-harness-sdk-runtime`）。
- [ ] `session/prompt` 返回的 `{messageId}` 不被当成回复内容。
- [ ] SSE 流在模型报错（如余额不足 402）时发 `event: error` 且**不**发 `completed`。
- [ ] SSE 流在子进程非零退出时发 `event: error`，**不**被当成正常结束。
- [ ] SSE 流超时后发 `event: error` 并回收子进程（用 `ps` 确认无残留）。
- [ ] 客户端断开后子进程被回收，无僵尸进程。
- [ ] 子进程崩溃后能被检测并重启，后续请求仍可用。
- [ ] 同一会话并发第二个请求被拒（409 或排队），不产生两条回复。
- [ ] 多轮对话能续接上下文（`harness_session_id` 回写生效）。
- [ ] 前端 `streams.ts` 对「无 delta、只有 completed」的流能正确显示（方案 B 的前提）。

---

## 8. 未验证事项

以下是我**没有**实测的部分，实现前需要确认：

- SDK 的 `tool/call` / `tool/result` 事件的具体字段形状（本次只跑了纯文本任务）。
- 子进程收到 `SIGTERM` 时是否立即退出、DSH 内部是否会留下孙进程。
- 常驻子进程长时间运行的内存增长情况。
- 单次任务的典型耗时与 token 消耗，用于定超时与配额。
- 模型目录接口在无网络时是否可用（`/models` 拉取会失败）。
- `session/wait` 的实际行为（本次未测；`session/resume` 已实测，见 §10）。
- 并发多个 `session/prompt` 时的行为（官方说可并发分派，未实测）。

补充一条已解决的历史问题：上一版曾因账号余额 402 拿不到成功事件流，现已被第三方提供商路由（§2.5）解决，成功流已实测拿到。

---

## 10. 实现记录（2026-11-02）

### 10.1 已落地

| 接口 | 状态 | 说明 |
|---|---|---|
| `GET /api/harnesses` | ✅ 实测 | 返回真实版本 `0.2.1-rc.2`，`status: available` |
| `GET /api/harnesses/{id}/models` | ✅ 实测 | 来自配置的 provider/model，未知引擎 404 |
| `GET /api/chat-sessions/{id}/stream` | ✅ 实测 | 真实调用 DSH，产出助手回复 |
| `GET /api/capabilities` | ✅ 实测 | `agent` 由真实探测驱动 |

### 10.2 代码落点

```
harness/config/HarnessProperties.java   fengmotion.harness.* 配置
harness/client/DshLauncher.java         启动子进程、探测版本
harness/client/DshProcess.java          JSON-RPC 通道（换行分帧）
harness/client/DshSdkSession.java       initialize / resume / prompt + 事件解析
harness/service/HarnessService.java     探测与缓存、模型目录
harness/api/HarnessController.java      /api/harnesses 两个接口
chat/service/ChatStreamService.java     事件 → SSE 帧、助手消息落库
```

### 10.3 实现中发现并修掉的三个真 bug

**1. 会话续接会失败（严重）**

DSH 的子进程是「一次请求一个进程」，而会话是持久化的。直接对已存在的会话发
`session/prompt` 会被拒绝（实测报 `session "..." already exists`），导致**第二轮
对话必然失败**。

修复：首次用 prompt 创建并绑定标识，后续先调 `session/resume` 再 prompt。
实测第二轮能准确引用第一轮内容（回答「上一条原文是：ROUND ONE」），证明上下文未丢。

**2. 校验顺序错误**

Controller 原本先检查「有没有可发送内容」再检查引擎可用性，导致引擎不可用时
返回 `400 validation_error` 而不是 `503 agent_unavailable`——用户会收到「请先发一条
消息」这种指向错误方向的提示。已调整为先判引擎、再判内容。

**3. 测试会 spawn 外部进程**

`application-test.yml` 没有禁用 harness，测试真的去执行 `dsh --version`，
断言随「本机是否装了 dsh」而变。已在测试 profile 中 `enabled: false`，
并新增 `HarnessApiTest` 覆盖「未启用时如何如实表达不可用」这条路径。

### 10.4 端到端实测记录

第一轮（新建会话）：

```
event: completed
data: {"type":"completed","message":{"role":"assistant","text":"ROUND ONE",...}}
event: end
```

第二轮（续接同一会话，验证上下文）：

```
event: completed
data: {"type":"completed","message":{"role":"assistant",
      "text":"...上一条消息的原文是：\n\nROUND ONE",...}}
```

失败路径（模型名配错）：

```
event: error
data: {"error":{"code":"agent_unavailable","message":"JSON-RPC 错误：-32603
      pi-ai provider \"agent2api-ecs\" has no configured model \"no-such-model-xyz\""}}
event: end
```

注意失败时**只发 error 不发 completed**，且错误信息保留了 DSH 的原始原因。

### 10.5 CORS

`fengmotion://app` 已加入白名单（`application.yml`），实测预检返回
`Access-Control-Allow-Origin: fengmotion://app`，Electron 壳可直接调用。

### 10.6 仍未做

- `session/wait` 未使用（当前靠 `session.status: idle` 判定结束）。
- 子进程为「一次请求一个」，没有常驻复用；并发与会话级锁未实现。
- 取消只能杀进程（`capabilities.cancel = process`），未提供取消接口。
- `tool/call` / `job/*` 等事件目前只映射为 `status` 帧，未暴露结构化详情。

---

## 11. Token 级流式实现记录（2026-11-02）

### 11.1 结论先行

`delta` 帧现在是**真的 token 级增量**，实测一次回复内 31 帧、跨度 0.89 秒，前端按「只追加文本」的契约直接 `+=` 即可。手段不是改 DSH、也不是直连提供商，而是**自写一个 DSH 插件**订阅官方公开事件 `agent/assistant-stream`。

### 11.2 为什么 SDK 通道原本拿不到增量

DSH 的 SDK stdio 协议（`session.event` / `session.status`）只在**一轮结束时**给出完整 assistant 消息；token 级帧是进程内事件，不走 stdio。已查验 dsh 实现目录源码：

- `dsh-agent-loop` 在流式循环里 `for await (const chunk of stream) live.push(chunk)` 的同时，执行 `this.dispatch.emit("agent/assistant-stream", { frame })`。
- 这是官方公开事件，任何插件都能用 `ctx.on('agent/assistant-stream', ...)` 订阅，不需要私有 hook。
- dsh 文档对此的表述是「Process-local `agent/assistant-stream` frames carry live presentation」，即它本就是给「实时呈现」用的。

### 11.3 插件设计

落点：`dsh-plugin/`（随仓库分发）

```
dsh-plugin/
  index.js          插件本体，export const inject = ['loader']
  cordis.patch.yml  - insert: [{id: fengmotion-stream, name: "./index.js"}]
  package.json      name: fengmotion-stream, type: module
```

插件做的事只有一件：订阅 `agent/assistant-stream`，把每帧压成**单行 JSON-RPC 通知**写到 **stderr**：

```json
{"jsonrpc":"2.0","method":"stream/delta","params":{"kind":"text","text":"你"}}
```

`kind` 取值：`start` / `text` / `thinking` / `block_start` / `block_end` / `usage` / `finish` / `end`。

后端启动时由 `DshLauncher` 生成一份临时 `.patch.yml` 插入该插件，作为**第二个 `--patch`** 传给 dsh，不改用户的 profile 配置文件。插件目录缺失时 `writePluginOverlay` 返回 null 并继续——流式是增强，不能阻塞对话主链路。

### 11.4 两个非显然的坑（都已实测确认）

**坑一：写 stdout 得到 0 帧，必须写 stderr。**
插件最初用 `process.stdout.write`，后端一帧都收不到。原因是 SDK server 自己拥有 stdout 的写入时序，插件写进去的内容被吞。改成 `process.stderr.write` 后立刻收到 32 帧。所以后端的 stderr 读取不再是「仅诊断日志」，而是**一条正式的数据通道**——`DshProcess.drainStderr` 现在按行分类：能解析成 JSON 且有 `method` 字段的行判为流帧回调出去，其余仍保留最后 N 行作诊断尾巴。

**坑二：`Writer.flush()` 不够，必须 `response.flushBuffer()`。**
后端帧写得没问题，但前端收到的所有 `delta` 时间跨度是 **0.00s**——全部堆在最后一次性到达。Tomcat 的 character writer `flush()` 只把字符推给 buffer，不推到 socket。改成在每次写帧后调用 `response.flushBuffer()`，跨度立刻变成 **0.89s**。

`flushBuffer` 需要 `HttpServletResponse`，而 `ChatStreamService` 是单例 bean，直接存字段会在并发请求间串线。落法是 `ThreadLocal<Runnable> currentFlush`：`stream(...)` 入口 set，结束时 clear，`writeFrame` 里 `currentFlush.get().run()`。

### 11.5 帧序列实测

一次正常回复的 SSE 帧顺序：

```
status  phase=thinking
status  phase=done
delta   × N          ← 新增，token 级
completed
end
```

插件侧计量（同一轮）：26 个 `text` 帧，跨度 0.61s，成批到达，每批约 5–6 帧。
后端 SSE 侧计量（加了 flushBuffer 之后）：31 帧，首帧 27.16s，末帧 28.04s，跨度 **0.89s**。加 flushBuffer 之前跨度 0.00s。

前端契约模拟校验（复刻 `src/services/api/streams.ts` 的 dispatch 规则跑真帧）：`status phase=thinking ✅`、`status phase=done ✅`、`delta` 被识别为「追加文本」、`completed` 带全文、`end ✅`，**未知帧类型：无**。

### 11.6 `messageId` 的诚实说明

`delta` 帧里的 `messageId` 是 `pending-<uuid>`，因为增量到达时后端还没有真实 message id（要等 `completed` 才落库拿到）。同一轮流内该值稳定，`completed` 帧给出的才是权威 id。前端应把 delta 当「正在生成的那条消息」的追加缓冲，以 `completed` 覆盖为准，不要用 delta 的 id 去建消息索引。

### 11.7 已放弃的替代路径

- 改 DSH 自身源码：不要动上游。
- 直连提供商拿增量：方向性错误（见 §6.1）。
- Web Remote / WebSocket：§6.4 曾认为这是 token 级唯一来源，现在证明插件路线更轻、不需要额外端口与鉴权。
- 用 `session/event` 做「会话活跃」门控：该事件名在总线上不存在，加了门控反而 0 帧，已整个移除。帧本身不带 session id，因此不做会话过滤，由后端按会话串行保证不串。

### 11.8 测试

`StreamFrameTest`（6 个用例）覆盖 stderr 行分类（JSON 帧 / 非 JSON / 有 JSON 无 `method` / 空行）与 `kind` → 回调映射。

`mvn -o test`：**139 tests, 0 failures, BUILD SUCCESS**，跑完无残留 `--profile sdk` 进程。

### 11.9 仍未做

- 前端**未在真实浏览器验证**过 delta 渲染，只做了契约级模拟（当时浏览器插件未连接）。这是唯一还没落地的验证环节。
- 常驻进程复用 / 会话级进程池未做。实测一次 spawn 的启动+握手约 1.46–1.64s，占 3.79s 一轮的约 39%；单进程 RSS 约 248MB。省 1.5s/轮 vs 固定 248MB vs 崩溃爆炸半径，需要产品侧拍板。
- `tool/call` 结构化暴露、取消接口、`task` 域、`session/wait` 均未做。

---

## 12. 进程模型定案：A 方案（每轮一个进程）

### 12.1 结论

**采用 A：每轮起一个 `dsh` 子进程，用完即关；会话靠 `session/resume` 冷续接。不做常驻进程池。**

### 12.2 依据：open-design 就是这么做的（已查验安装包）

对比对象选 open-design 0.25.0——同一个 DSH、同样驱动桌面 UI、同一个问题。逐个模块查证后确认它也是 A：

**① 每轮一条 `execute`，然后直接 `stdin.end()`。**
`@open-design/daemon/dist/agent-protocol/dsh-profile/session.js` 的 `attachDshProfileSession` 收一个已 spawn 好的 `child`，发

```js
{ v: 1, type: 'execute', request_id, cwd, prompt, ...(resumeSessionId ? { resume_session_id } : {}) }
```

结束走 `finish()` → `stdin.end()`。**没有任何「复用该 child 跑下一轮」的代码路径。**

**② spawn 发生在每一次 run 内部，带 per-run 目录。**
`daemon/dist/server.js:12004`：

```js
const spawnedAgent = spawnAgentProcess({ ..., runDir: path.join(RUNTIME_DATA_DIR, 'runs', run.id), runId: run.id });
child = spawnedAgent.child; run.child = child;
```

配套还有 `destroyChildStdio()` / `tearDownAttemptForRetry()` / `terminateProcessTree()`——典型的「进程是消耗品」写法。

**③ 它自己的注释写明「每轮起新进程」是主流形态。**
`server.js:9868`：

> Every runtime gets it, not just the 6 with native resume: **the 21 that start a fresh process each turn** are exactly the ones with no other way to know.

27 个 runtime 中只有 6 个用常驻原生 resume，**其余 21 个明确每轮新进程**，dsh 属于后者。

**④ 它把「冷续接」写成了术语。**
`server.js:13460` 注释：

> Preserve that handle when the user cancels the current process so a later OD run can **cold-resume** the same conversation.

即冷启动 + 按 session id 恢复，正是我们的 `session/resume`。

**⑤ 全程没有进程池。**
搜 `server.js` 与整个 `runtimes/`：`process pool`、`reuse process`、`warm process`、`hot process` 全部零命中（命中的 `keepAlive` 都指 HTTP 连接保活）。

### 12.3 对照表

| | open-design 0.25.0 | FengMotion |
|---|---|---|
| 进程模型 | 每轮 spawn | 每轮 spawn |
| 会话续接 | `resume_session_id` 冷续接 | `session/resume` |
| 进程池 | 无 | 无 |
| 宿主 | 独立 daemon + sidecar 生命周期 | 后端进程内，`close()` 于 finally |

我们还少一层复杂度：open-design 的 daemon 要独立管理 `daemon-health.json`、崩溃上报、`reapLeftoverAgentProcesses`（僵尸进程回收），这些在我们的进程模型里不存在。

### 12.4 顺带澄清一个旧疑问

open-design 用 `--profile open-design --stdio`，而我们本地 `--profile sdk` 没有 `--stdio` / `--probe` / `--models`。原因在此：**这些 flag 由 open-design 自己的 profile bundle 提供**（其 `dsh-profile` 插件实现 `v:1/execute` 那套 JSONL 协议），不是 dsh 通用能力；它还专门写 `hasOpenDesignProfile()` 判断该 profile 装没装。我们没必要照抄协议——`--profile sdk` 的官方 `session/prompt` 与它等价。

### 12.5 实测数据（2026-11-03，本机）

加入分段埋点后两轮真实请求：

| 轮次 | resume | spawn | handshake | firstToken | total |
|---|---|---|---|---|---|
| 1 | false | 1ms | 1535ms | 2366ms | 3931ms |
| 2 | true | 1ms | 1589ms | 2985ms | 4593ms |

读法：

- **`spawn` 只有 1ms**——`ProcessBuilder` 返回极快，之前说的「1.46s 启动开销」实际几乎全部落在 **handshake（`initialize`）**，约 1.5–1.6s。
- 这一项占整轮 39%–41%，与早先估值吻合，但**归因变了**：不是「起进程慢」，而是「dsh 启动插件树并等它 settle 慢」。这意味着常驻进程能省的正是这 1.5s，收益确实存在。
- `firstToken` 2.4–3.0s 是模型侧耗时，与进程模型无关。
- 第 2 轮 `resume=true` 的 handshake 并没有更贵（1589ms vs 1535ms），说明续接不额外付启动成本——冷续接的代价可忽略，这是 A 方案能成立的关键。

埋点位置：`ChatStreamService.TurnTiming`，日志关键字 `turn timing`。留成日志而非仅内存统计，是为了从真实使用中持续取样——上面只是 2 个样本，不足以定论，但足以支撑「A 不劣于 B」的判断。

### 12.6 什么情况下再考虑 B

不是永不考虑。触发条件：

| 信号 | 阈值 |
|---|---|
| handshake 占整轮比重中位数 | > 40%（现在是 39%–41%，临界） |
| 出现高频连续追问形态 | 轮次间隔接近 handshake 耗时 |
| 首 token 被压到 1s 以内 | 那时 1.5s handshake 成主要瓶颈 |

跑几天真实使用、攒够 `turn timing` 样本后再看。届时若决定上 B，形态应是「**一个常驻进程 + 多会话**」的轻量版（dsh 的 SDK server 原生支持一个进程开多会话并排队，已实测 multi-A/multi-B 并发 2.82s/2.83s），而不是会话级进程池。

### 12.7 本轮修掉的一个真 bug：管道 FD 泄漏

`DshProcess.close()` 原先只关 `stdin`，`stdout` 的 `BufferedReader` 与 `stderr` 的 reader 都没关，靠 GC 回收。每轮起进程的模型下这会积压管道 FD——open-design 在 issue #4100 里正是踩了这个：**几百次重试后累积 10k+ FD，`posix_spawn` 报 EBADF**。

修法：

- `DshProcess` 在构造时就持有 `stdout` 的 `BufferedReader`（原先 `openStdout()` 每次 new 一个新的，同一进程流被包多份），`close()` 统一关闭。
- `close()` 顺序为：关 stdin → `destroy()` → `waitFor(3s)` → `destroyForcibly()` → **最后**关 stdout / stderr / 三个原始流。stdout/stderr 放最后是必须的：先关读端会让子进程收到 EPIPE 而非正常退出，真实错误信息就丢了。
- 清理阶段的异常一律吞掉，不把「清理失败」升级成「本轮失败」。

### 12.8 可借鉴但未做

查 open-design 时发现它比我们细的几处，记录备后续：

1. **协议级 `cancel`**：`{ v:1, type:'cancel', request_id }`，不杀进程。我们的 SDK 协议没有 cancel，只能杀进程（`capabilities.cancel = process`），无法照搬。
2. **`usage` 帧带完整 token 计数**（含 `cache_read_tokens` / `cache_write_tokens`），我们目前丢弃。
3. **`tool_call` / `tool_result` 给结构化 `call_id` / `name` / `arguments` / `is_error`**，我们只映射成 `status` 帧。原待办事项。

---

## 13. 工具调用结构化 + 探测状态（2026-11-03）

### 13.1 工具调用结构化（原 §12.8 第 3 条，已完成）

DSH 的 `tool/call` 事件本来就带 `callId` / `name` / `arguments`，`tool/result` 带 `callId` / `isError`。这些在映射成 SSE `status` 帧时**被丢掉了**，界面只能显示「正在调用工具」。

现在透传：

```
event: status
data: {"type":"status","phase":"tool","name":"bash","label":"bash",
       "callId":"call_00_tHl4...","arguments":"{\"command\":\"ls -la\"}"}

event: status
data: {"type":"status","phase":"tool","callId":"call_00_tHl4..."}      ← 结果帧
```

字段规则：

| 字段 | 何时出现 | 说明 |
|---|---|---|
| `callId` | 开始帧 + 结果帧 | 两帧共用同一值，前端据此配对「调用」与「结果」 |
| `arguments` | 仅开始帧 | 超过 4000 字符以 `…` 截断（可能是整段文件或 base64） |
| `isError` | 仅结果帧且失败时 | 该字段**存在**即为失败；成功时不写 |
| `name` / `label` | 仅开始帧 | 结果帧不重复下发 |

**顺带修掉的一个真 bug**：`onToolCall` 原先走 `emitPhase`，而那个方法按 phase 去重。一轮里连续调两个工具都是 `tool` 相位，**第二次会被吞掉**，界面永远停在第一个工具。现在工具帧直接发，只更新 `lastPhase` 供后续 thinking 帧去重。

前端契约 `ChatStreamStatus` 增加三个可选字段（向后兼容，旧代码只读 `phase`/`name`/`label` 不受影响）。

实测帧序列（真实工具调用一轮，197 个 delta + 5 个 status）。

### 13.2 首屏「状态未知」误报（已修）

`useHarnesses` 初始 `access: 'unknown'`，而 `unknown` 是「测了但读不到」的**结论**。首屏探测需 1.5~3 秒，这段时间界面显示「未接入 AI / 状态未知」，每次刷新都会闪。

修法：新增 `probing`（还没测完）与 `checking`（界面态），与 `unknown`（结论）区分。初始值与 `refresh()` 开头都置 `probing`。

`checking` 期间发送仍禁用（探测未完成不该允许发送），探测完成后自动转 `available`。

### 13.3 仍未做

- **`usage` 帧**：token 计数（含缓存命中）仍丢弃。前端目前没有展示位置，接了也看不到，等有需求再做。
- **协议级 `cancel`**：SDK 协议没有 cancel 方法，只能杀进程，无法照搬 open-design 的 `{type:'cancel'}`。
- **`task` 域**：仍是包占位。

---

## 14. 工具调用展示 + token 用量（2026-11-03 续）

### 14.1 工具调用展示（前端）

后端已透传 `callId`/`name`/`arguments`/`isError`（见 §13.1），前端原先只显示「正在调用工具：bash」一行。现在改为调用列表：

- 每条可展开看完整参数（默认收起：参数常是整段 JSON/脚本，铺开会顶走对话区）
- 状态文字 + 颜色双表达（执行中/完成/失败），不单靠颜色
- 展开后参数限高 240px 可滚动

**归并规则**：带 `arguments` 的帧 = 新调用（建条目）；不带 `arguments` 但带 `callId` 的帧 = 结果（回填 `done`/`isError`）。不能用「有没有 `isError`」判断，因为成功的结果帧两者都没有。

### 14.2 token 用量（重要修正：原判断错误）

§12.8 曾写「`usage` 帧带着完整 token 计数，我们丢弃」，暗示存在一个 `usage` 事件可以接。**这个前提是错的。**

实测原始事件流（直接驱动 `dsh --profile sdk`，抓全部 `session.event`）：

```
agent/inbox/spliced, approval/policy, assistant/message, permission/preset,
request/context, request/header, sandbox/mode, session/title, step/end,
step/start, system/message, turn/end, turn/start, user/message
```

**没有任何 `usage` 事件。** 进一步的发现：

1. dsh 有 `@deepseek-ai/dsh-token-meter` 包，但它是**聚合器**——从 `turn/start` 到 `turn/end` 的持久事件里折叠出用量，不是事件源。
2. 用量真正挂在 `assistant/message` 事件的 `usage` 字段上：

```json
{"usage": {"inputTokens": 211, "outputTokens": 13,
           "totalTokens": 5728, "cacheReadTokens": 5504}}
```

所以实现方式是**在解析 `assistant/message` 时顺带取出**，而不是等一个不会来的事件。

### 14.3 usage 帧

```
event: usage
data: {"type":"usage","inputTokens":871,"outputTokens":59,
       "cacheReadTokens":4864,"totalTokens":5794}
```

规则：

- **字段全部可选**：上游没报的桶不出现，不补 0 ——「用了 0 个 token」与「不知道用了多少」是两件事。
- `totalTokens` **不等于** input + output（它含缓存命中）。实测这轮 input 871 + output 59 = 930，但 total 5794（含 cacheRead 4864 + 缓存写入部分）。**不要自行相加代替它。**
- 位置固定在最后一个 delta 之后、`completed` 之前。
- 前端按桶累加（一轮可能有多次模型调用），缓存命中单独标注。

### 14.4 浏览器验收（已完成，验出三个真问题）

用浏览器插件在真机上跑完整对话后，发现三个脚本和类型检查都发现不了的问题：

**① 回复结束后工具列表与 usage 整体消失（最严重）**
两个组件都挂在 `pending &&` 上，`pending` 一落就被卸载。工具调用是这一轮回复的**组成部分**，属于历史而非瞬时状态；去掉 `pending` 条件后恢复正常。这个问题是「功能看起来能用、实际用一次就丢记录」。

**② 工具名与正文粘连**
界面显示成 `…一句话总结。bash`。块级上边距 4px 在真实排版下不足，改为 10px。

**③ CSS 类名冲突**
新建的 `.cv3-tools` 与既有「工具调用行」样式同名。这类冲突不报错、静默覆盖，极难排查，已改名 `.cv3-tool-list`。

教训：**前端渲染问题类型检查和复刻脚本都验证不出来**，必须真实渲染一遍。

### 14.5 仍未做

- **协议级 `cancel`**：SDK 协议没有 cancel 方法，只能杀进程。
- **`task` 域**：仍是包占位。
- **工具调用历史的持久化**：目前 `toolCalls` 只存在组件状态里，切走会话再回来就没了。要长期保留需随消息一起落库（后端 `chat_message` 加列或单独表），属于数据结构改动。

---

## 15. 工具调用记录持久化（2026-11-03）

### 15.1 为什么做

此前工具调用记录只活在前端组件状态里（`toolCalls`），**切走会话再回来就没了**。视频类应用里用户需要回看「上次渲染跑了哪些命令、为什么失败」，这条链路是硬缺口。

### 15.2 数据结构

`chat_messages` 新增一列 `tool_calls_json TEXT`（JSON 数组），与 `references_json` / `attachments_json` 同一套模式：

- 只跟随消息整体读写，没有独立查询需求 → 不单开表
- 新库由 `schema.sql` 建出，旧库由 `DatabaseMigration` 用 `PRAGMA table_info` 判断后 `ALTER TABLE` 补列（可重复执行）
- 无工具调用时存 `null` 而非 `[]`：读回来仍是「没有」

记录形状：

```json
[{"callId":"call_00_...","name":"bash","arguments":"{\"command\":\"ls\"}","done":true}]
```

`done` 表示有结果帧；失败时另有 `isError: true`。字段与 SSE `status` 帧的工具字段一致，只多了 `done`。

### 15.3 全链路

后端 `SseListener` 在 `onToolCall` / `onToolResult` 时同步累积一份记录（与发帧并行：帧是「正在发生」，落库是「事后可查」），整轮结束后随助手消息一起 `append`。

API 响应 `ChatMessageResponse` 增加 `toolCalls`（`@JsonInclude(NON_NULL)`，没有时不出现）。前端 `toViewMessage` 映射为视图层的 `executedTools`。

### 15.4 前端渲染的两个坑（真机验收发现）

**① 实时列表与历史记录重复渲染**
实时列表（组件状态）在消息块**外**，历史记录（`m.executedTools`）在消息块**内**。回复完成后两者同时存在，界面上出现**两条「bash 完成」**。修法：实时列表在消息已挂上 `executedTools` 时让位。两者是同一份数据的前后两个阶段，只能显示一个。

**② `onCompleted` 闭包读不到最新 state**
`onCompleted` 是建流那一刻捕获的闭包，读 `toolCalls` 只会拿到当时的空数组。加 `toolCallsRef` 镜像，并在每次 `setToolCalls` 的同一个更新函数里同步写 ref（拆开写会漏路径）。

顺带：视图层新增 `executedTools` 字段而不复用既有 `toolCalls`——后者是演示适配器用的 `{label, detail}` 摘要，形状与语义都不同，合并会破坏演示路径。

### 15.5 验证

- 后端 `ChatMessageRepositoryTest` 新增 2 个用例：`roundTripsToolCalls`（跨 JSON 序列化 + SQLite 文本列 + 反序列化三跳）、`storesNullWhenNoToolCalls`
- 全量测试 **146 passed**
- 端到端：curl 起一轮真实工具调用 → 查 SQLite `tool_calls_json` 有值 → 历史接口 `/api/chat-sessions/{id}/messages` 正确返回 → 浏览器内直接访问该接口确认前端能拿到
- 真机界面确认过修复前的重复渲染，修复后 `npx tsc -b` / `npm run build` 通过

### 15.6 仍未做

- **协议级 `cancel`**：SDK 协议没有 cancel，只能杀进程。
- **`task` 域**：仍是包占位。
- **历史工具记录在浏览器里的最终目视确认**：接口层已确认数据正确返回，但「切走会话再回来，列表仍显示」这一步没能在界面上点到位——该项目下的会话行与项目节点共用同一个可点区域，自动化点击总是折叠项目而非打开会话。需人工点一次确认。

---

## 16. session/title 接通 + approval/policy 查清（2026-11-03）

### 16.1 approval/policy：只是策略声明，不是审批请求

**结论：不会卡住执行，无需接审批界面。**

实测（`danger-full-access` + `policy: never` 下跑一轮带 bash 调用的对话），收到三类相关事件：

```
permission/preset  {"preset": "danger-full-access"}
sandbox/mode       {"mode": "danger-full-access"}
approval/policy    {"policy": "never"}
```

三者在 `turn/start` 之前各发**一次**，内容是**当前策略的声明**，没有 `request` / `decide` / `pending` 这类请求态字段。全程没有出现任何需要用户批准才能继续的阻塞点。

所以此前担心的「Agent 请求危险操作时我们没有审批界面、可能卡住」**不成立**：DSH 在 SDK 通道下按预设策略直接放行，不等外部审批。

如果将来要让用户逐次确认危险操作，需要的是 dsh 侧的 approval answerer 机制（`ctx` 上注册应答方），不是在本后端补一个 UI——那是另一件事，目前没有需求。

### 16.2 session/title：已接通

`session/title` 事件实测载荷：

```json
{"title": "analyze video pacing techniques",
 "messageSeqs": [8],
 "source": {"kind": "fallback"}}
```

- `source.kind = "fallback"` 表示标题直接取用户原话（未配标题模型时的行为）；配了标题模型时 `kind` 会是别的值，`title` 更短更贴题。
- `messageSeqs` 指出标题基于哪几条消息，本实现不使用（不需要回溯）。

**实现**：`DshSdkSession` 增加 `case "session/title"` → `Listener.onSessionTitle`（默认空实现，不强制所有监听器实现）→ `SseListener` 落库（`sessions.updateTitle`）并发 `title` 帧 → 前端 `onTitle` 更新左栏。

新增 `ChatSessionRepository.updateTitle`，**刻意不刷新 `updated_at`**：标题是引擎在回复过程中顺带给出的元信息，不是用户动作；刷新会让左栏「N分钟前」在回复结束时突然归零。

### 16.3 title 帧

```
event: title
data: {"type":"title","title":"帮我分析一下视频节奏的把控"}
```

- 空标题不发、不落库：用空串覆盖会让本来有名字的会话变成无名。
- 位置不固定（引擎命名的时机由它自己决定），前端当作幂等更新处理。

### 16.4 验证

- 端到端：起一轮真实对话 → SSE 收到 `title` 帧 → 查 SQLite `chat_sessions.title` 已更新 → 左栏显示新名字
- **界面实测**：新建会话显示「未命名对话」→ 发第一条消息 → 左栏**实时**变成「用三句话说说短视频开头三秒」，无需刷新
- 全量测试 **146 passed**

### 16.5 DSH 接通度现状（截至本轮）

已接：`initialize` / `session/prompt` / `session/resume`；事件 `turn/start` / `step/start` / `tool/call` / `tool/result` / `assistant/message` / `turn/end` / `session/title` / `usage`（来自 assistant/message 字段）。

未接（评估后认为不需要）：

| 项 | 结论 |
|---|---|
| `session/wait` | 靠 `session.status: idle` 判定结束已够用 |
| `session/created`、`session/working` | 信息由现有事件覆盖 |
| `system/message` | 是系统提示词，不下发展示 |
| `step/end`、`user/message`、`request/*`、`sandbox/mode`、`permission/preset`、`approval/policy`、`agent/inbox/spliced`、`job/*` | 诊断/策略声明类，不影响业务 |

协议硬限制（DSH 不提供，非未做）：**取消**（无 cancel 方法，只能杀进程）。

---

## 17. 附件上传端点（2026-11-03）

### 17.1 背景

前端 `src/services/api/assets.ts` 已有完整的上传编排（分片、重试、形状兼容），但后端 `upload` 包只有 `package-info.java` 写着计划，没有任何实现。契约要求附件「先上传为 Asset、再以 fileId 引用」，端点缺失时前端只能不带附件发消息。

### 17.2 实现

```
POST /api/uploads     multipart，字段名 file
→ 201 {fileId, name, size, kind, mimeType, sha256}
```

分层：`upload/api/UploadController` → `upload/service/UploadService` → `upload/domain/UploadedFile`。

### 17.3 安全边界（都有单测）

| 边界 | 做法 | 理由 |
|---|---|---|
| 路径穿越 | 落盘名 = 随机 UUID + MIME 推导的扩展名 | 原始文件名用户完全可控，含 `../` 时拿它拼路径就是漏洞 |
| 展示名 | 只取最后一段、去 NUL、限 200 字符 | 浏览器可能回传带路径的文件名 |
| 类型 | MIME 前缀白名单，**不看扩展名** | 扩展名改一下就能绕过 |
| 大小 | 服务层 64 MiB + Spring multipart 64MB（留 4MB 封装余量） | Spring 默认只有 1MB，素材截图稍大就被容器层拒绝且报框架异常 |
| 路径外泄 | 响应只给 `fileId`，不含路径与目录 | 契约明确要求「只带 fileId，不带路径」 |
| resolve 入参 | 正则校验 UUID 格式 | `resolve()` 将来给「让模型读附件」用，入参不可信 |

### 17.4 实测

```
$ curl -X POST /api/uploads -F "file=@test.png;type=image/png"
{"fileId":"283db0ad-...","name":"test-upload.png","size":32,"kind":"image",
 "mimeType":"image/png","sha256":"a9bc727f..."}
HTTP 201

$ curl -X POST /api/uploads -F "file=@bad.exe;type=application/x-msdownload"
{"error":{"code":"unsupported_media_type",...}}
HTTP 415
```

落盘核对：`~/.fengmotion/uploads/283db0ad-....png` 存在、内容与上传一致；响应体中 grep 不到任何路径字段。

### 17.5 测试

`UploadServiceTest` 8 个用例：正常落盘、带路径文件名被剥离、空文件拒绝、非法 MIME 拒绝、超限拒绝、按 MIME 归类、MIME 带参数时的规范化、resolve 拒绝非法 id。

全量 **154 passed**。

### 17.6 仍未做

- **附件与消息的关联**：目前上传只产出 `fileId`，消息体里引用它需要前端的 `attachments` 字段配合（契约已有该字段，后端已有 `attachments_json` 列）。这条链路本身是通的，但**没有做端到端联调**。
- **让模型读到附件内容**：`UploadService.resolve()` 已具备能力，但 DSH 的 prompt 目前只发文本。要真正把图片交给模型，需要构造 `contentBlocks` 的图片块 —— 这是下一步。
- **上传文件的生命周期**：没有过期清理，落盘文件只增不减。

---

## 18. 让模型真正读到附件图片（2026-11-03）

### 18.1 做了什么

此前上传端点只产出 `fileId`，但消息发出去时图片**没有进入模型上下文** —— 上传了图，模型看不见。现在接通：

```
消息 attachments[].fileId  →  读盘  →  base64  →  contentBlocks 图片块  →  DSH 模型
```

`session/prompt` 的 `contentBlocks` 现在先放文本块，再依次追加图片块：

```json
[{"type":"text","text":"..."},
 {"type":"image","data":"<base64>","mimeType":"image/png"}]
```

### 18.2 协议约束（DSH 侧）

`SdkEncodedImageBlock.mimeType` 是**字面量联合类型**，只接受四种：

```
image/png | image/jpeg | image/webp | image/gif
```

传别的（含 `image/svg+xml`、`image/bmp`）不会得到「格式不支持」这种可读错误，而是在准入阶段被拒、**整条消息失败**。所以 `InlineImage.isSupported()` 先过滤，不支持的附件直接跳过 —— 一个附件不该让整条消息发不出去。

DSH 会把这些内联 base64 交给它的附件库存成内容寻址引用，再进模型上下文。我们只负责送字节，持久化与去重是 DSH 的事。

### 18.3 调试过程中发现的一个真 bug

第一版实现后模型回复「你这条消息里没有附带任何图片」。加日志才发现：

```
prompt images: attachmentsPresent=true resolved=0
```

`attachments` 确实到了，但**一张图都没解析出来**。根因在 `UploadService.resolve()`：

- 落盘名是 `id + 扩展名`（如 `bba564ea-....png`）
- `resolve()` 返回的是 `root/id`（**没有扩展名**）
- `Files.isRegularFile()` 因此永远 false，静默返回 null

这个 bug 单测抓不到，因为原来的 `resolve` 测试只验证「拒绝非法 id」，没验证「能找回合法文件」。修复后补了两条测试：`resolvesFileWithExtension`、`asInlineImageConvertsSupportedFormats`。

修法是按目录扫描匹配 id 前缀（扩展名不可知时也能找回），仍受 root 约束。

### 18.4 决定性验证

造一张**红底白字「42」**的图上传，让模型描述：

```
$ prompt: 这张图里是什么内容？只回答你看到的数字和背景颜色
模型回答：数字：42  背景颜色：红色（纯红）
```

后端日志同时确认 `resolved=1`。**模型确实看到并理解了图片内容**，不是靠文件名猜的。

### 18.5 模型能力核对

`deepseek-v4.1-flash` 在 desktop profile 的 `llm-pi-ai` 配置里声明了 `image` 输入。`/api/harnesses/{id}/models` 不返回输入能力字段，需要看 profile 配置。

### 18.6 保留的诊断日志

`ChatStreamService` 里保留了一行：

```
prompt images: attachmentsPresent={} resolved={}
```

它是排查「图到底有没有发给模型」的唯一线索，成本可忽略。`resolved=0` 而 `attachmentsPresent=true` 就是链路断了。

### 18.7 仍未做

- **非图片附件不被模型读取**：视频、PDF、文本附件目前只上传不使用（协议无对应内联块）。它们仍在服务端，将来协议支持可直接接上。
- **附件与消息的完整联调**：前端 UI 还没有选附件发消息的入口（后端链路已通）。
- **上传文件生命周期**：没有过期清理。

---

## 19. 前端附件发送入口（2026-11-03）

### 19.1 之前缺什么

后端上传与识图链路都已通（§17、§18），但前端**选完文件从不上传**：`addFiles` 只把 `name/size/kind` 塞进组件状态，发送时消息体里没有 `attachments`。等于后端能力空转。

### 19.2 实现

**选完就传，不等发送**。这样用户能看到进度，发送时也不必等上传。

```
选文件 → 界面立即占位（上传中）→ POST /api/uploads → 拿到 fileId → 标记完成
发送   → 只带 fileId 等元信息的附件 → 后端读盘转 base64 → 模型识图
```

关键取舍：

| 决定 | 理由 |
|---|---|
| 上传中/失败的附件**不随消息发送** | 带一个没有 `fileId` 的附件过去，后端只能忽略或报错 |
| 失败的附件**仍显示在输入框**，带原因 | 静默消失会让用户以为选上了 |
| 附件字段用契约的 `TaskAttachment` 形状（`sizeBytes`、不带 `kind`） | 后端能由 `mimeType` 推出归类，重复字段只带来不一致风险 |
| 走 `studioHttpApi().chat.uploadAttachment`，不走 `chatApi` | 后者是演示适配器（本地 mock），没有上传能力 |

新增前端方法 `studioHttpApi().chat.uploadAttachment(file)`，对应后端 `POST /api/uploads`。它和 `assets.uploads.*` 的分片协议不是一回事：那是「项目素材」（有归属、可版本化），这是「为这一条消息临时带上的文件」，后端存储位置也不同。

### 19.3 实测

用契约形状的附件（`sizeBytes` 而非 `size`）走完整流程：

```
上传 blue-bg-yellow-88.png → POST /api/uploads → fileId
发送消息（attachments: [{fileId, name, mimeType, sizeBytes}]）→ 202
起流 → prompt images: attachmentsPresent=true resolved=1
模型回答：图里的数字是 88（黄色），背景是蓝色（约 #1A3EDB 附近）
```

模型准确读出了数字、前景色、背景色 —— 说明契约形状的附件确实一路传到了模型。

### 19.4 验证

- 后端 **160 passed**、`npx tsc -b` 通过、`npm run build` 通过
- 端到端：契约形状附件 → 模型识图正确

### 19.5 仍未做

- **浏览器 UI 未目视确认**：浏览器插件当时未连接，选文件 → 上传中 → 发送这条交互没能在界面上点一遍。后端链路已用 curl 走通。
- **上传失败的重试入口**：失败时只显示原因，没有「重试」按钮，用户得自己删掉重选。
- **非图片附件不被读取**：视频/PDF/文本仍只上传不使用（协议无对应内联块）。
