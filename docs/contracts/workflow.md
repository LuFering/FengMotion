# 契约 · 项目工作流上下文与工作稿（本次改动范围）

> 说明：本文档仅记录本次工作流改造涉及的项目上下文、工作稿文件、原文完整性检测、制作循环提交与前端定义迁移契约，不补全整个工作流域。

---

## 1. 上下文状态与原文完整性检测

### `GET /api/projects/{projectId}/workflow`

读取项目的 Prompt-first 创作上下文状态。

响应新增字段（B2）：

| 字段 | 类型 | 说明 |
| :--- | :--- | :--- |
| `originalIntegrity` | `'ok' \| 'suspect' \| 'unknown' \| null` | 原文（`prompt.original.md`）完整性检测结论；判据包括：同一 20 字以上段落重复出现，或混入工作稿模板标题。只报告，不自动修改。 |
| `originalIntegrityReasons` | `string[] \| null` | 判为 `suspect` 时的原因列表。 |

### 可选：`POST /api/projects/{projectId}/workflow/original/repair`

仅当 `originalIntegrity === 'suspect'` 时允许调用。请求体：

```json
{
  "content": "用户确认后的原始需求全文",
  "baseSha256": "..."
}
```

服务端先将旧文件备份为 `prompt.original.<时间>.bak.md`，再写入用户确认后的原文，返回更新后的上下文状态。

---

## 2. 项目工作稿文件接口（B1）

工作稿（`lookdev-brief.md`、`film-plan.md`）落盘为项目文件，不在工作流画布连线里传递。`{name}` 仅允许 `lookdev-brief` 与 `film-plan`。

### 2.1 列出工作稿状态

`GET /api/projects/{projectId}/workflow/drafts`

响应为数组（或 `{ drafts: [...] }`），每项包含：

| 字段 | 类型 | 说明 |
| :--- | :--- | :--- |
| `name` | `'lookdev-brief' \| 'film-plan'` | 工作稿标识 |
| `file` | `string` | 对应文件名（`lookdev-brief.md` / `film-plan.md`） |
| `exists` | `boolean` | 文件是否已存在于项目目录 |
| `content` | `string \| null` | 正文；列表接口为 `null` |
| `sha256` | `string \| null` | 当前文件内容 SHA-256（用于乐观并发校验，不存在时为 `null`） |
| `template` | `boolean \| null` | 是否仍为初始模板原样（模板目录不可用时为 `null`） |
| `size` | `number` | 字节数 |
| `updatedAt` | `string \| null` | ISO 8601 修改时间 |

### 2.2 读取单份工作稿

`GET /api/projects/{projectId}/workflow/drafts/{name}`

返回完整 `Draft` 对象（`{ name, file, exists, content, sha256, template, size, updatedAt }`）。

### 2.3 保存单份工作稿

`PUT /api/projects/{projectId}/workflow/drafts/{name}`

请求体：

```json
{
  "content": "工作稿 Markdown 内容",
  "baseSha256": "读取时拿到的 sha256"
}
```

约束与错误码：
- `409 Conflict`：文件已被外部或 Agent 修改（`baseSha256` 不匹配），或当前项目有制作任务正在运行（`ProjectOperationLock` 占用）。前端提示冲突并提供刷新合并，不覆盖未确认更改。
- `400 / 413`：非法 `name` 或内容超出限制大小。
- 服务端先写临时文件再原子替换，成功返回最新 `{ name, content, sha256, ... }`。

---

## 3. 创作初始化与制作循环提交

### 3.1 `POST /api/projects/{projectId}/workflow/init`

- 仅使用创作需求节点（`prompt`）的原始文本初始化 `prompt.original.md`，严禁传入由多个工作稿拼接而成的 `intent`。

### 3.2 `POST /api/projects/{projectId}/creation-jobs`（及 `/workflow/create`）

工作流中 `create` 节点在项目模式下提交制作任务时：
- `intent` 传空串 `""`，服务端默认按 `prompt.original.md` 与 `corrections.md`（以及项目内 `lookdev-brief.md`、`film-plan.md`）推进。
- 当审片节点（`review`）标记「需要修改」时，前端清除本次运行周期内 `create`、`review`、`delivery` 的旧结果，并将审片意见通过 `correction` 字段传入；`requestId` 须使用标准 UUID（`[0-9a-fA-F-]{36}`），供服务端 `recordCorrection` 幂等写入 `corrections.md`。

---

## 4. 前端工作流定义与迁移规则（`schemaVersion: 2`）

- **规则**：节点类型与端口 ID **只增不改**。
- **活跃节点类型（Prompt-first）**：`prompt`、`refs`、`capability`、`create`、`review`、`delivery`。
- **纯函数迁移**：读取旧版定义时在内存中无 IO 迁移至 `schemaVersion: 2`（下次保存写回）：
  - 删除 `lookdev`、`filmplan` 节点及关联边，将其文本保留至 `legacyDrafts`；
  - 将 `finishing` 转为 `delivery`，保留原节点 ID 与兼容端口（`render`、`notes`）；
  - 历史运行记录不改动，旧节点类型仅保留只读显示定义，执行器与图校验不再接受。
- **循环与交付**：
  - 图保持无环（`edges` 不存回边），画布仅绘出虚线「返工」箭头提示；
  - `delivery` 为确定性节点（不调用 Agent）：仅当上游 `review` 审片通过且绑定的就是最新一次渲染时输出成片，否则停在 `awaiting_info`（「等待审片通过」）。
