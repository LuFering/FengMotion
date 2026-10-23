# 契约 · 渲染与交付（Render / Delivery / Acceptance）

状态：**待评审冻结**。类型：`RenderJob`、`RenderOutput`、`RenderPreset`、`DeliveryState`、`AcceptanceRecord`。
边界：只约定渲染作业、产物、交付状态与验收；不含渲染器实现、不含云渲染调度。

## 1. 渲染作业

### 1.1 RenderJob

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `renderId` | string | 是 | 渲染作业 ID |
| `projectId` | string | 是 | 所属项目 |
| `taskId` | string | 是 | 关联任务 |
| `status` | `queued`/`running`/`completed`/`failed`/`cancelled` | 是 | 状态 |
| `preset` | RenderPreset | 是 | 分辨率/帧率/格式/质量 |
| `output` | RenderOutput | 否 | 仅 completed 存在 |
| `error` | TaskError | 否 | 仅 failed 存在，`retryable` 明确 |
| `startedAt` | ISO 8601 | 是 | 开始 |
| `completedAt` | ISO 8601 | 否 | 仅终态 |
| `demo` | `true` | 否 | 演示数据 |

`RenderPreset`：`resolution`（`1080p`/`1440p`/`4k`）、`fps`、`format`（`mp4`/`webm`）、`quality`（`draft`/`standard`/`high`）。

`RenderOutput`：`fileId`、`url`、`thumbnailUrl?`、`durationMs`、`sizeBytes`、`width`、`height`、`fps`、`createdAt`。

### 1.2 端点

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/projects/{projectId}/renders` | 创建渲染，`202` + `RenderJob` |
| GET | `/projects/{projectId}/renders?status=&cursor=` | 渲染历史 |
| GET | `/renders/{renderId}` | 详情（含 output/error） |
| POST | `/renders/{renderId}/cancel` | 取消（仅 queued/running） |

`POST .../renders`：

```json
{ "preset": { "resolution": "1080p", "fps": 30, "format": "mp4", "quality": "high" }, "range": null }
```

- 云渲染未接入 → `422 capability_unavailable`（`details.capability="cloudRender"`）；不得创建永远 queued 的假作业。
- 项目未组装完成 → `409 conflict`，`details.missing` 列缺件。
- 创建成功后同时生成 `kind=render` 任务；前端订阅任务事件即可。
- 取消是请求，不保证停止；已写出的部分产物保留并标注。

## 2. 交付状态

`GET /projects/{projectId}/delivery` → `DeliveryState`

| 字段 | 类型 | 说明 |
|---|---|---|
| `status` | `unassembled`/`assembling`/`deliverable`/`delivered`/`missing`/`acceptance_failed` | 交付阶段 |
| `renderId` | string? | 当前候选产物 |
| `missing` | DeliveryMissingItem[] | 缺件清单；非空时不得给下载 |
| `acceptance` | AcceptanceRecord? | 最近一次验收 |
| `updatedAt` | ISO 8601 | 更新时间 |
| `demo` | `true`? | 演示数据 |

`DeliveryMissingItem`：`kind`（`scene`/`render`/`check`/`asset`/`acceptance`）、`refId?`、`label`、`reason`（一句人话）。

### 2.1 状态判定

| 条件 | status |
|---|---|
| 时间轴未组装 / 无渲染 | `unassembled` |
| 渲染或检查进行中 | `assembling` |
| 渲染完成 + 检查 `passed` + 验收未拒绝 | `deliverable` |
| 已验收 `accepted` | `delivered` |
| 缺场景/缺产物/检查 `not_run` | `missing` |
| 验收 `rejected` | `acceptance_failed` |

- `deliverable` 是**服务端派生**，前端不得自行判断。
- `missing` 必须带非空 `missing[]`；只给状态词视为契约违规。
- 检查 `failed` → `missing` 或 `acceptance_failed` 由服务端按缺件原因给出，不默认通过。

## 3. 验收

### 3.1 端点

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/renders/{renderId}/acceptance` | 提交验收决定 |
| GET | `/projects/{projectId}/acceptances?cursor=` | 验收历史 |

`POST .../acceptance`：

```json
{ "decision": "rejected", "note": "片尾字幕有遮挡" }
```

- 只有 `deliverable` 状态可验收；其他状态 `409 conflict`。
- `rejected` 必须带 `note`（≥1 字），否则 `400 validation_error`。
- 同一渲染重复验收：以最新一次为准，历史全部保留，不覆盖。
- 验收人是人，不是 Agent；`decidedBy` 由服务端从会话身份取，客户端不得伪造。

### 3.2 AcceptanceRecord

| 字段 | 类型 | 说明 |
|---|---|---|
| `acceptanceId` | string | ID |
| `projectId` / `renderId` | string | 关联 |
| `decision` | `accepted`/`rejected` | 决定 |
| `note` | string? | 拒绝时必填 |
| `decidedBy` | string | 验收人 ID |
| `decidedAt` | ISO 8601 | 时间 |

## 4. 与检查/任务的关系

- 渲染完成不自动等于检查通过；检查是独立 run（`check.md`）。
- `render` 任务完成 = `RenderJob.completed`；渲染失败/取消映射任务 `failed`/`cancelled`。
- 交付状态变化由服务端在渲染完成、检查完成、验收提交后重算；前端不本地推导。
- 重新渲染产生新 `renderId`；旧产物只读保留，验收记录仍指向旧 `renderId`。

## 5. 规则与边界

- 未 `deliverable` 不显示下载按钮，只显示缺件清单与下一步入口。
- 演示产物必须 `demo: true`，且不得进入 `deliverable`/`delivered`。
- `output.url` 是短期签名 URL，支持 `Range`；不把视频 base64 内联。
- 不做「一键交付」：验收必须由人显式提交。
- 不做云渲染调度细节（队列、机器、计费）——只约定作业状态与结果。
