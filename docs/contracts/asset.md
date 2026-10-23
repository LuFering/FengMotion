# 契约 · 素材（Asset / AssetFolder / Upload）

状态：**待评审冻结**。类型：`Asset`、`AssetFolder`、`UploadSession`、`AssetUpdateRequest`。
职责边界：只管理**真实文件**的索引与元数据；不负责镜头分析（参考片库），不负责技法定义（特效库）。

## 1. 五维状态

素材必须同时表达五个正交维度，禁止压成一个 `ready`：

| 维度 | 字段 | 取值 |
|---|---|---|
| 来源类型 | `sourceType` | `builtin` / `imported` / `generated` / `sample` |
| 处理状态 | `processingStatus` | `pending` / `processing` / `ready` / `failed` |
| 审核状态 | `reviewStatus` | `none` / `pending` / `approved` / `rejected` |
| 可用状态 | `availability` | `enabled` / `disabled` / `deprecated` |
| 引用关系 | `refs` | `ResourceRef[]`（多值，不是状态） |

- 新导入素材：`processingStatus = pending`、`reviewStatus = none`、`availability = enabled`。
- **授权状态是独立字段**（`licenseStatus`），审核只改审核，不推断授权；无可靠信息一律 `unknown`。
- `deprecated` 是终态；`disabled` 时禁止新增引用，已有引用保留。

## 2. Asset

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | string | 是 | 稳定 ID |
| `name` | string | 是 | 展示名（默认文件名，可改） |
| `mediaType` | `image`/`video`/`audio`/`font`/`doc` | 是 | 媒体类型 |
| `mimeType` | string | 是 | MIME |
| `sizeBytes` | number | 是 | 字节数（服务端实测，不信前端） |
| `sourceType` | 见 §1 | 是 | 来源 |
| `processingStatus` | 见 §1 | 是 | 处理状态 |
| `processingError` | string | 否 | 仅 failed 存在，写人话原因 |
| `reviewStatus` | 见 §1 | 是 | 审核 |
| `availability` | 见 §1 | 是 | 可用性 |
| `licenseStatus` | `allowed`/`attribution_required`/`restricted`/`unknown` | 是 | 授权 |
| `licenseDetails` | string | 否 | 授权说明/署名要求 |
| `width` / `height` | number | 否 | 图像/视频尺寸 |
| `durationMs` | number | 否 | 音视频时长 |
| `tags` | string[] | 是 | 标签 |
| `folderId` | string \| null | 是 | 文件夹；根为 null |
| `refs` | ResourceRef[] | 是 | 被谁引用 |
| `fileUrl` | string | 是 | 原文件 URL（短期签名） |
| `thumbnailUrl` | string | 否 | 缩略图 |
| `createdAt` / `updatedAt` | ISO 8601 | 是 | 时间 |
| `lastUsedAt` | ISO 8601 | 否 | 最近使用 |
| `etag` | string | 是 | 条件更新 |
| `demo` | `true` | 否 | 演示数据 |

## 3. 端点

### 3.1 列表

`GET /assets?mediaType=&sourceType=&folderId=&q=&tags=&sort=recent&cursor=&limit=`

- `q` 匹配文件名与标签，不搜 OCR/台词。
- `sort`：`recent`（lastUsedAt 倒序，默认）/`name`/`size`/`created`。
- 返回 `Page<Asset>`；`refs` 在列表接口可省略（`?include=refs` 才返回），避免列表过重。

### 3.2 上传（浏览器/远程）

`POST /assets/uploads`：

```json
{ "fileName": "intro.mp4", "mimeType": "video/mp4", "sizeBytes": 104857600, "folderId": null }
```

返回 `201` + `UploadSession`（含 `uploadId`、`chunkSizeBytes`、`expiresAt`）。

- 分片：`PUT /assets/uploads/{uploadId}/chunks/{index}`，`Content-Type: application/octet-stream`，`Content-Range` 标明范围。
- 完成：`POST /assets/uploads/{uploadId}/complete` → `201` + `Asset`（`processingStatus=pending`）。
- 取消：`DELETE /assets/uploads/{uploadId}`，已收分片清理。
- 超出 `sizeBytes` 或分片越界 → `400 validation_error`；类型不支持 → `415 unsupported_media_type`。
- 上传进度只认服务端 `receivedBytes`，前端不得自造百分比。

### 3.3 路径导入（桌面端）

`POST /assets/import`：

```json
{ "filePath": "/Users/me/video-cut/token/assets/a1.jpg", "folderId": null }
```

- 仅本地服务允许；远程后端返回 `422 capability_unavailable`。
- 服务端必须校验路径在白名单根目录内，越界返回 `403`（复用 `validation_error` + `details.reason=path_not_allowed`）。
- 成功返回 `Asset`；文件不存在 `404`，重复导入返回已有 `Asset` + `200`。

### 3.4 详情/更新/删除

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/assets/{assetId}` | 详情（含 refs） |
| PATCH | `/assets/{assetId}` | 改名/标签/文件夹/授权/审核/可用性，带 `If-Match` |
| DELETE | `/assets/{assetId}` | 删除；被引用返回 `409` + 引用方 |
| POST | `/assets/batch-delete` | `{ ids: [] }`；部分失败返回 `207` + 逐项结果 |

- 删除前检查引用：任一 `refs` 非空 → `409 conflict`，`details.refs` 列出项目/工作流/场景。
- `availability=deprecated` 只能由显式请求设置，且不可逆；重复设置幂等。
- `reviewStatus=approved` 要求 `processingStatus=ready`，否则 `409 conflict`。
- 改名不改 `id`、不改文件本体。

### 3.5 文件夹

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/asset-folders` | 列表（含素材计数 `assetCount`） |
| POST | `/asset-folders` | `{ name }`；同名 `409` |
| PATCH | `/asset-folders/{folderId}` | 重命名 |
| DELETE | `/asset-folders/{folderId}` | 删除；素材移回根，不级联删除 |

## 4. 文件访问

- `fileUrl`/`thumbnailUrl` 为短期签名 URL（默认 15 分钟），支持 `Range`。
- 前端不得把 URL 持久化；过期后重新 `GET /assets/{id}` 换取。
- 禁止把文件内容 base64 内联进 JSON。

## 5. 规则与边界

- 普通视频导入后**不自动**成为「已解析参考片」；需要用户显式发起解析（见 `library.md`）。
- 内置素材（`sourceType=builtin`）删除后不恢复；`builtin` 不可改为 `imported`。
- 生成结果（`sourceType=generated`）必须记录来源任务 `refs(kind=task)`，不能悬空。
- 素材是工作区级资源，不属于单个项目；项目通过 `refs` 引用。
- 列表空态返回空数组，不用 404。
