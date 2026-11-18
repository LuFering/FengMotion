# 契约 · 项目创作上下文（工作稿与原文完整性）

状态：**已实现，待前端接入**（2026-11-18）。
范围：只覆盖本次新增或变更的两处：工作稿文件读写、上下文状态里的原文完整性字段。工作流定义、版本与运行仍见 `workflow.md`（该文档尚未落地）。
路径：后端实际挂在 `/api`，不是总则里的 `/api/v1`。

背景：画布收敛为「输入 → 制作循环 → 交付」后，「视觉构想 / 导演处理」不再是节点，改为项目目录里的 `lookdev-brief.md`、`film-plan.md`。用户在界面里编辑、agent 在创作中写入，落在同一份文件上。

## 1. 工作稿 Draft

| 字段 | 类型 | 说明 |
|---|---|---|
| `name` | `lookdev-brief` / `film-plan` | 对外名称，只开放这两份 |
| `file` | string | 项目内文件名 |
| `exists` | boolean | 文件是否存在 |
| `content` | string \| null | 正文；列表接口为 `null`，单份接口在文件不存在时为 `""` |
| `sha256` | string \| null | 正文 sha256；文件不存在时为 `null`。写入时原样回传 |
| `template` | boolean \| null | 是否仍是初始化时的模板原样；找不到模板目录时为 `null`（未知） |
| `size` | number | 字节数 |
| `updatedAt` | ISO 8601 \| null | 文件修改时间 |

### 1.1 端点

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/api/projects/{projectId}/workflow/drafts` | 两份工作稿的状态，固定顺序，不含正文 |
| `GET` | `/api/projects/{projectId}/workflow/drafts/{name}` | 单份正文与状态 |
| `PUT` | `/api/projects/{projectId}/workflow/drafts/{name}` | 整份替换，请求体 `{ content, baseSha256 }` |

`PUT` 规则：

- `content` 逐字保存，上限 200,000 字节（UTF-8）。
- `baseSha256` 必须等于服务端当前文件的 sha256；文件不存在时省略或传 `null`。不一致即 `409 draft_conflict`，文件不动。前端应重新 `GET`，让用户看过最新内容再决定。
- 项目有制作请求在排队或运行时返回 `409 project_busy`，因为 agent 可能同时在写这两份文件。
- 写入是原子替换（临时文件 + rename），失败时原文件不变。

### 1.2 错误

| HTTP | code | 场景 |
|---|---|---|
| 400 | `validation_error` | 缺请求体、`content` 缺失、超过大小上限、项目没有目录 |
| 400 | `workflow_not_initialized` | 项目还没有 `prompt.original.md` |
| 404 | `not_found` | 项目不存在，或 `name` 不是两份工作稿之一 |
| 409 | `draft_conflict` | `baseSha256` 与当前文件不一致（含文件已被删除、已存在却未传） |
| 409 | `project_busy` | 项目正在制作 |
| 409 | `draft_unsafe` | 工作稿是符号链接，读写都拒绝 |
| 500 | `draft_unreadable` / `draft_write_failed` | 文件读写失败 |

## 2. 上下文状态：原文完整性

`GET /api/projects/{projectId}/workflow`（以及 `POST .../init`、`POST .../corrections` 返回的状态）新增两个字段：

| 字段 | 类型 | 说明 |
|---|---|---|
| `originalIntegrity` | `ok` / `suspect` / `unknown` / `null` | 未初始化为 `null`；原文读取失败为 `unknown` |
| `originalIntegrityReasons` | string[] | 可疑原因，`ok` 时为空数组 |

`suspect` 表示 `prompt.original.md` 像被旧版工作流拼进了工作稿。旧版首次运行时把「提示词 + 视觉构想 + 导演处理」逐层拼接后当成原文写入，特征是：

- 同一段落重复出现（8 个非空白字符以上；首段不限长度，因为拼接总是从提示词开始重复）；
- 出现单独成行的 `draft`（旧版视觉构想节点的状态值）。

后端**只报告，不修改**原文。是否修复、怎么修复由用户决定；修复接口尚未提供。

## 3. 前端接入要点

- create 节点初始化上下文时，只能用「创作需求」节点的原文调用 `init`，不能再用拼接后的 intent。这是污染的根源，后端无法替前端区分。
- 工作流每次运行都调用 `init`。后端和最近一次需求修改比较（没改过需求时和原文比较）：相同返回 `UNCHANGED`，不同则带 `<!-- fengmotion-requirement:<sha256> -->` 标记追加到 `corrections.md` 并返回 `RECORDED_AS_CORRECTION`。审片意见和对话纠正不带这个标记，不参与比较。
- 返工时把审片意见放进创作请求的 `correction` 字段；后端已按 `requestId` 幂等追加到 `corrections.md`。
- 编辑工作稿：先 `GET` 拿 `sha256`，保存时回传；收到 `409 draft_conflict` 时展示最新内容，不要自动重试覆盖。
