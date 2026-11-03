# 契约 · 项目与内容（Project / Timeline / Scene / Artifact）

状态：**待评审冻结**。类型：`ProjectSummary`、`ProjectDetail`、`ProjectSettings`、`Timeline`、`Scene`、`StoryboardEntry`、`ShotOverride`、`WorkbenchArtifact`、`ProjectVersion`。

## 1. 边界

- 「项目」是创作目标与产物的容器；「场景」是具体内容单元；「产物」是可审阅的版本化文档；「版本」是可恢复的来源快照。
- 项目不持有执行状态：进度、卡在哪一步，一律由任务/检查/交付派生，不另存一份 `project.statusText`。
- 场景是通用层叫法。实现内部仍可能叫 shot/unit，但 API 字段只出现 `scene`。

## 2. ProjectSummary

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | string | 是 | 稳定 ID |
| `name` | string | 是 | 项目名 |
| `tagline` | string | 是 | 一句话简介，可为空串 |
| `stage` | `idea`/`draft`/`editing`/`rendering`/`done` | 是 | 项目阶段，人工可改；不由任务状态自动覆盖 |
| `genomeId` | string \| null | 是 | 片型画像 ID，未定为 null |
| `durationMs` | number | 是 | 当前成片时长；未排完为 0 |
| `targetDurationMs` | number | 否 | 目标时长；未定不出现 |
| `counts` | ProjectCounts | 是 | `scenes`/`doneScenes`/`storyboardSegments`/`compositions`/`timelineClips` |
| `coverUrl` | string \| null | 是 | 封面；无封面为 null |
| `rootPath` | string | 是 | 项目根目录绝对路径 |
| `createdAt` / `updatedAt` | ISO 8601 | 是 | 时间 |
| `planned` | `true` | 否 | 仅本次会话有效、尚未落盘；UI 必须标注 |
| `etag` | string | 是 | 条件更新凭证 |
| `demo` | `true` | 否 | 演示数据 |

`ProjectDetail` = `ProjectSummary` + `settings`：

| `settings` 字段 | 类型 | 说明 |
|---|---|---|
| `width` / `height` | number | 画布尺寸（1920×1080） |
| `fps` | number | 帧率（30） |
| `targetDurationMs` | number | 目标时长 |
| `genomeId` | string \| null | 片型 |

## 3. 端点

### 3.1 列表

`GET /projects?stage=&q=&sort=updated_desc&cursor=&limit=`

- `q` 只匹配项目名与 tagline，不搜内容。
- `sort`：`updated_desc`（默认）/`updated_asc`/`name_asc`。
- 返回 `Page<ProjectSummary>`。

### 3.2 新建

`POST /projects` + `Idempotency-Key`：

```json
{ "name": "新片", "genomeId": "g-oral", "targetDurationMs": 180000, "rootPath": "/Users/me/video-cut/xin-pian" }
```

- 成功 `201` + `ProjectDetail`。
- `rootPath` 缺省时用 `workspaceRoot/slug(name)`；同名目录已存在返回 `409 conflict`。
- 落盘失败（权限/磁盘）返回 `500 internal_error`，**不得**返回 `planned: true` 冒充成功。
- 仅当后端明确处于「会话内草稿」模式时，才返回 `planned: true` 并在 UI 标注「仅本次会话有效」。

### 3.3 详情

`GET /projects/{projectId}` → `ProjectDetail`；不存在 `404`。

### 3.4 更新

`PATCH /projects/{projectId}`，必须带 `If-Match: <etag>`；返回更新后的 `ProjectDetail`。

- 允许改：`name`、`tagline`、`stage`、`genomeId`、`targetDurationMs`。
- 不允许改：`id`、`counts`、`durationMs`（由时间轴派生）、`rootPath`（改路径 = 新项目）。
- 重名不禁止（不同目录可同名），但同目录同名返回 `409`。
- 成功返回新 `etag`；`If-Match` 缺失返回 `412`（不是 428，保持错误码表最小）。

### 3.5 删除

`DELETE /projects/{projectId}`：

- 有未完成渲染/任务时返回 `409 conflict`，`details.blockingTasks` 列任务 ID。
- 已落盘项目默认**归档**而非物理删除；`?purge=true` 才物理删除（需 UI 二次确认）。
- 成功 `204`。

## 4. 时间线与场景

### 4.1 时间线

`GET /projects/{projectId}/timeline` → `Timeline`

- `durationMs` 是成片总时长，必须等于 `max(startMs + durationMs)`，不允许另算一套。
- `source`：`assembly` = 真实组装；`demo` = 演示数据。演示时间轴不得驱动渲染。
- 片段按 `startMs` 升序返回，同起点按 `track` 升序。

### 4.2 场景列表

`GET /projects/{projectId}/scenes` → `Scene[]`（场景数量有限，不分页；超过 500 才改分页）

| 字段 | 说明 |
|---|---|
| `index` | 从 1 开始，展示序号；重排后允许变化 |
| `startMs` | 在成片时间轴上的起点；`inTimeline=false` 时为 null |
| `status` | `done`/`running`/`waiting`/`failed`/`idle`/`untracked`，与全站状态色一一对应 |
| `timingKnown` | false = 时长是估算，UI 标「未实测」 |
| `compositionUrl` | 合成页 URL；无合成文件为 null |
| `storyboardId` | 关联分镜段；无关联为 null |

场景状态是**派生值**：`done` 需要该场景在时间轴中且无未处理 blocker；`running` 来自活动任务；`waiting` 来自 Gate/待确认；`failed` 来自任务失败或检查 blocker；`untracked` = 分镜里有、实现里没有。

### 4.3 场景详情

`GET /projects/{projectId}/scenes/{sceneId}` → `Scene` + 可选 `storyboard`（分镜段对象）。

## 5. 分镜

`GET /projects/{projectId}/storyboard` → `StoryboardEntry[]`

- 分镜是**规划**，不是实现；分镜段数与场景数可以不等。
- `timecode` / `duration` 保留原始文本（如 `00:12–00:19`、`7s`），不在这里解析成毫秒；需要数值时用场景的 `startMs`/`durationMs`。
- 分镜表是只读来源（来自脚本文件）；改分镜 = 改源文件后重新导入，不走 PATCH。

## 6. 镜头参数（ShotOverride）

`GET /projects/{projectId}/scenes/{sceneId}/override` → `ShotOverride`；未保存过返回 404（不是空对象）。

`PUT /projects/{projectId}/scenes/{sceneId}/override`，带 `If-Match`（首次保存不需要）：

```json
{
  "settings": {
    "title": "Token 是什么",
    "subtitle": "黄仁勋两小时反复提的那个词",
    "accent": "#3B8CF8",
    "fontScale": 1,
    "motion": "rise",
    "align": "left",
    "durationSeconds": 6
  }
}
```

- 保存成功返回新 `etag`。
- `durationSeconds` 是**视图内的展示时长**，不改时间轴；与 `Scene.durationMs` 冲突时以时间轴为准，UI 必须提示。
- 参数只影响字幕/版式，不得改变场景内容的渲染结果（那是任务的事）。

## 7. 工作台产物（WorkbenchArtifact）

| 端点 | 说明 |
|---|---|
| `GET /projects/{projectId}/artifacts?type=` | 列表，按 `updatedAt` 倒序 |
| `POST /projects/{projectId}/artifacts` | 新建（`type`/`title`/`summary`/`body`/`relatedSceneIds`） |
| `GET /projects/{projectId}/artifacts/{artifactId}` | 详情 |
| `PATCH /projects/{projectId}/artifacts/{artifactId}` | 更新（带 `If-Match`） |

- `status`：`draft` → `needs-review` → `confirmed`；`confirmed` 后内容变更必须回 `needs-review`，不得原地改内容还保持已确认。
- `version` 是展示版本号，内容每次提交递增；不提供删除端点（产物只归档）。
- `body` 是 Markdown 文本，不是 HTML；前端渲染时必须防 XSS。

## 8. 项目版本与恢复

`GET /projects/{projectId}/versions` → `ProjectVersion[]`

- `restorable=false` 的来源（旧成片、分镜草稿）**禁止**显示可用恢复按钮；只能查看。
- `kind`：`render`（成片）/`storyboard`（分镜）/`snapshot`（代码快照）。

`POST /projects/{projectId}/versions/{versionId}/restore` + `Idempotency-Key`：

- `restorable=false` → `422 capability_unavailable`（只读来源），不是 500。
- 成功 `202` + `TaskAcceptedResponse`（`task.kind = restore`）；恢复本身是异步任务，完成后才改项目内容。
- 恢复不删除当前版本；当前版本自动成为新的可恢复快照。

## 9. 规则与边界

- 项目阶段是人工判断，不与任务状态自动同步；「渲染中」可由后端建议，但必须用户可见可改。
- 场景状态派生自任务/检查，不允许前端自己拼；任何页面读同一份派生结果。
- 演示数据必须带 `demo: true`，且 `planned: true` 的项目不得参与渲染/检查。
- 删除场景/分镜不在本期契约内（01–06 期不做内容删除）。
- 产物与版本的区别：产物是**可审阅文档**，版本是**可恢复快照**，不得互相冒充。
