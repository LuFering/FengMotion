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

### 当前后端摘要来源（2026-11-23）

列表与详情的 `durationMs`、画布及帧率读取数据库当前版本，不再始终返回 0 / 1920×1080 / 30。源码成片采用 `film.output.durationInFrames / fps`；旧场景采用合成总帧数规则。`fps` 保留小数，不把 29.97 截断为 29。无有效时序时返回时长 0，缺失画布使用初始值；不通过扫描 MP4 或执行源码来查询列表。列表批量读取当前版本，避免逐项目查询。

`counts.scenes` 读取当前镜头装配实例或旧场景数组，`compositions` 为已登记的当前源码合成数（0 或 1）。无镜头声明的普通源码不猜测 DOM 场景数；`doneScenes`、`storyboardSegments`、`timelineClips` 仍未聚合审核、规划和运行时轨道，暂为 0，不能据此宣称项目无轨道或已审片。这些剩余统计尚待对应内容模型接入。

版本历史写入不覆盖已有同号记录；发现冲突返回 `409 scene_history_conflict`，当前版本递增与历史写入一同回滚。

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

- 已落盘项目默认**归档**而非物理删除；`?purge=true` 才物理删除（需 UI 二次确认）。
- 物理删除取得项目独占准入；有排队/运行的创作、出片、聊天、旧任务、同步渲染、实时预览或其他已登记写操作时返回 `409 project_busy`。实时预览须先通过停止接口关闭；取消执行任务后仍需等线程退出。
- 删除期间的新任务、预览和已接入的写操作返回 `409 project_deleting`。旧任务表中残留的未完成记录仍可返回 `409 conflict`，当前响应不承诺 `details.blockingTasks` 字段。
- 删除前取得源码写入锁；其他写入或遗留锁存在时返回 `409 source_busy`。数据库失败保留目录并释放本次准入；成功删除也清理会话的消息幂等记录。
- 成功 `204`。

删除身份补充：根目录符号链接、损坏/不匹配身份标记拒绝；工作区根及其祖先、文件系统根与用户主目录不能因存在标记而获准删除。没有标记的旧项目仅在工作区子目录范围内兼容。项目删除后使用原创建幂等键重试返回409 `idempotency_result_deleted`，不会复活项目。

以上准入覆盖单个后端实例内的执行，不代表多个后端共享同一数据时具有跨进程全程互斥。归档仍只隐藏项目，不终止已有执行。

## 4. 时间线与场景

### 4.1 时间线

`GET /projects/{projectId}/timeline` → `Timeline`

- `durationMs` 是成片总时长，必须等于 `max(startMs + durationMs)`，不允许另算一套。
- `source`：`assembly` = 真实组装；`demo` = 演示数据。演示时间轴不得驱动渲染。
- 片段按 `startMs` 升序返回，同起点按 `track` 升序。

2026-11-23 后端实现：不带 `path` 时读取当前已提交版本与对应视频的指纹绑定清单，返回上述毫秒制 `Timeline`；带 `path` 时保留现有视频轨道清单格式（`schemaVersion:2`、`tracks`、秒制时间），两种路由不混用。没有版本的项目返回空时间线；已出片但清单缺失、视频被替换、来源指纹不一致时报明确错误，不执行隐藏的恢复或重渲染。

轨道片段 ID 由轨道 ID 与片段 ID 组合生成，避免不同轨道同名冲突。视频/图形/图片可关联实际场景条目；音频或未建立场景关系的片段 `sceneId:null`（客户端类型接入时须允许null），不能伪造场景。`durationMs` 保留权威成片总时长，最后没有可采集对象时可能大于片段末尾；不要为凑满时长编造空白片段。

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

当前只读实现从已验证的成片视觉轨道生成场景列表及详情。镜头装配保留声明的镜头ID，旧场景轨道保留可对应的原ID，普通Remotion片段使用稳定组合ID；不声称这是任意DOM元素。实测时间 `timingKnown:true`；审核/Gate未聚合前 `status:idle`，附“已渲染不代表已通过审查”的说明。列表返回数组，详情不存在返回404，均 `no-store`；分镜、override及审核状态不在本次读取实现中。

封面 `/projects/{id}/poster?version=N` 按该版视频SHA-256缓存，原视频替换后不能沿用旧封面；输出 `ETag` 与 `Cache-Control:no-cache`。抽帧采用临时文件，路径/缓存链接拒绝，失败不发布半图，抽帧期间项目不允许物理删除。

### 4.3 场景详情

`GET /projects/{projectId}/scenes/{sceneId}` → `Scene` + 可选 `storyboard`（分镜段对象）。

## 5. 分镜

`GET /projects/{projectId}/storyboard` → `StoryboardEntry[]`

- 分镜是**规划**，不是实现；分镜段数与场景数可以不等。
- `timecode` / `duration` 保留原始文本（如 `00:12–00:19`、`7s`），不在这里解析成毫秒；需要数值时用场景的 `startMs`/`durationMs`。
- 分镜表是只读来源（来自脚本文件）；改分镜 = 改源文件后重新导入，不走 PATCH。

2026-11-23 当前实现支持根目录 `storyboard.json`，优先于 `shot-plan.json`。前者形状为 `{"schemaVersion":"1.0","type":"storyboard","entries":[{"id":"s1","segment":"开场","timecode":"00:12–00:19","duration":"约7s","narration":"原文","visual":"杯子","motion":"推进","transition":"切","act":"第一幕"}]}`，原文本逐字保留；未填写的可选说明返回空串，不推测。

没有storyboard.json时，可读取现有workflow-v0.1.1的 `shot-plan` 1.0：按镜头captionIds提取字幕文本、eventIds提取画面事件说明；无原始时间码文本时明确展示 `起帧–止帧 frames @ fps`，不伪称来自手写时间码。只作读取结构/引用校验，不等于连续性或视觉审片通过。没有两种文件返回空数组；文件损坏/链接/重复ID/无效引用返回422 `storyboard_invalid`，不降级到模板或成片。文件上限1MiB、条目上限500；响应 `no-store`、ETag文件哈希、X-Storyboard-Source标明来源。当前不自动解析自由格式film-plan.md。

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
