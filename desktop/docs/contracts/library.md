# 契约 · 知识库（特效 / 参考片 / 片型）

状态：**待评审冻结**。类型：`FxTechnique`、`FxFacets`、`Genome`、`Method`、`ReferenceVideo`、`ReferenceShot`、`ReferenceCollection`、`ReferencePreference`。
三套不同的数据模型，共用的只有搜索框、标签、卡片样式与详情抽屉，**不共用页面模板**。

## 1. 三库边界

| | 特效库 | 参考片库 | 片型画像 |
|---|---|---|---|
| 回答 | 用什么方法实现 | 有什么值得借鉴 | 这类片子长什么样 |
| 数据 | 技法定义、参数、限制 | 真实视频、镜头段、十维分析 | 抽象特征、方法步骤 |
| 状态 | 只读目录（内置/导入/示例） | 解析状态（analyzed/partial/pending） | 只读 |
| 不得混用 | 不与参考片混标 | 不与片型画像混标 | 不冒充「已解析视频」 |

## 2. 特效（FxTechnique）

### 2.1 字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` / `name` / `nameEn` | string | 稳定 ID、中文名、英文名 |
| `aliases` / `keywords` | string[] | 别名与检索词 |
| `intent` | string | 解决什么表达问题 |
| `category` | `camera`/`transition`/`lighting`/`particles`/`compositing`/`stylize`/`typography` | **按效果用途**分类，不按实现技术 |
| `categoryLabel` | string | 展示名 |
| `scenes` / `antiScenes` | string[] | 适用/不适用场景 |
| `execType` | `runnable`/`composable`/`reference` | **源库声明的能力标签**，不代表本机可执行（见 §2.3） |
| `executionStatus` | `declared`/`not-implemented`/`available` | **本机真实可执行状态**，默认 `not-implemented` |
| `impl` | `realtime`/`offline`/`ai`/`composite` | 实现方式 |
| `complexity` | number | 1–5 |
| `inputKinds` | `image`/`video`/`audio`/`text`[] | 需要的输入 |
| `inputRequirement` / `output` | string | 输入要求、输出形态 |
| `dependencies` / `compatibility` / `limitations` / `failures` | string[] | 依赖、兼容、限制、常见失败 |
| `steps` | string[] | 操作步骤 |
| `params` | FxParam[] | 参数与默认值 |
| `previewImageUrl` / `previewVideoUrl` | string / string \| null | 预览素材 |
| `related` / `alternatives` | string[] | 相关/替代技法 ID |
| `featured` | boolean | 是否精选 |
| `version` / `updatedAt` | string / ISO 8601 | 版本与更新时间 |
| `userState` | `{favorited, lastViewedAt?}`? | 用户收藏与最近浏览，独立于参考片偏好 |
| `demo` | `true`? | 演示数据 |

### 2.2 端点

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/fx-techniques?category=&execType=&impl=&inputKind=&maxComplexity=&q=&sort=cat&cursor=` | 列表 |
| GET | `/fx-techniques/facets` | 筛选面与计数（不受当前筛选影响的全量计数） |
| GET | `/fx-techniques/{techniqueId}` | 详情 |
| PATCH | `/fx-techniques/{techniqueId}/state` | 更新用户状态（收藏/最近浏览），带 `If-Match` |

- `sort`：`cat`（默认，分类+名称）/`complexity`/`updated`。
- 列表返回 `Page<FxTechnique>`；详情返回完整对象。
- **技法目录只读**：不提供新增/修改/删除技法本身。复制配方是前端剪贴板动作，不产生 API 写入。
- 用户状态（收藏/最近）独立管理，**不放进 `reference-preferences`**（那是参考片的偏好，三库不混用）。
- 「用于工作流」在真实调用链可用前不提供端点；UI 置灰并注明「工作流调用未接入」。

### 2.3 来源声明 ≠ 本机可执行

`execType` 是**来源库**声明的能力标签，`executionStatus` 才回答「这台机器现在能不能跑」。

- 默认全部 `not-implemented`；只有适配器与依赖真实存在才可标 `available`。
- 界面**不得**因 `execType=runnable` 就显示「可执行」。
- 选中技法后，agent 可将其作为**知识参考**；只有 `executionStatus=available` 才可作为可执行实现。

## 3. 片型画像（Genome）

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` / `name` | string | 稳定 ID、名称 |
| `from` | `实测`/`规格` | 数据来源，不得省略 |
| `persona` | string | 一句话画像 |
| `fingerprint` | `{key,value}[]` | 可量指标，不是形容词 |
| `traits` | string[] | 特征 |
| `note` | string | 说明 |
| `imageUrl` | string? | 判据图 |
| `method` | Method | 这套片型怎么做：`name`/`lead`/`steps[{k,name,judge,star?}]` |

端点：`GET /genomes`、`GET /genomes/{genomeId}`。只读；不作为「参考片解析结果」。

## 4. 参考片与镜头段

### 4.1 ReferenceVideo

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` / `title` | string | ID、标题 |
| `durationMs` | number | 时长 |
| `source` | string | 来源（URL/文件名/出处） |
| `description` / `tags` | string / string[] | 描述与标签 |
| `thumbnailUrl` | string? | 封面 |
| `assetId` | string? | 关联的真实素材（同一文件不必存两份）；有值时 `fileUrl` 可播放 |
| `status` | `analyzed`/`partial`/`pending` | 视频级解析状态 |
| `createdAt` | ISO 8601 | 导入时间 |
| `demo` | `true`? | 演示数据 |

### 4.2 ReferenceShot

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` / `videoId` / `index` | string / string / number | 定位 |
| `startMs` / `endMs` | number | 区间 |
| `status` | `analyzed`/`partial`/`pending` | 该段解析状态 |
| `tags` | string[] | 标签 |
| `observation` | string | **观察事实**，只写看得到的 |
| `inference` | string | **模型推断**，必须与观察分开 |
| `suggestion` | string | **对当前这条创作的具体用法建议**（与 `analysis.reusable` 不同，见 §4.2.2） |
| `analysis` | `Record<AnalysisKey, AnalysisValue>` | 界面默认展示的**六维** |
| `extraAnalysis` | `Partial<Record<AnalysisExtraKey, AnalysisValue>>`? | 后端可额外保存的技术维度，界面默认不展示 |

#### 4.2.1 分析维度

**界面默认六维**（`AnalysisKey`）：`cameraMove`（运镜）、`rhythm`（节奏）、`lighting`（光线）、`composition`（构图）、`transition`（转场）、`reusable`（可借鉴点）。

**后端可额外保存**（`AnalysisExtraKey`）：`scale`、`subjectMove`、`color`、`narrative`、`shotType`。

约束：

- 后端**允许保存有依据的其他分析信息**，但**不强制模型填满**、**不强制界面全部展示**、**不把这些技术维度作为工作流门槛**。
- 额外维度仅在确有依据时存在；没有依据就不出现，不填默认值。

#### 4.2.2 `reusable` 与 `suggestion` 分工

| 字段 | 回答的问题 |
|---|---|
| `analysis.reusable` | **可以借鉴什么，以及它的限制条件** |
| `suggestion` | **对当前这条创作的具体用法建议** |

- 二者语义不同，**暂不合并**。
- **缺少依据就留空或 `pending`**，不允许两处生成同义内容。

#### 4.2.3 AnalysisValue

`value`、`source`、`confidence`（0–1，无法置信为 null）、`evidence`（可追溯依据）、`pending`（该维度是否未解析）。

`source` **三分**：

| 值 | 含义 |
|---|---|
| `measured` | 实测 —— 切点、时长、亮度等可计算量 |
| `model` | 模型判断 |
| `user` | 用户填写 |

**不编造置信度和证据，不等于不要证据**：有真实可追溯的帧、时间段或人工标注就保存并展示；没有就标为未知或 `pending`。

**铁律**：

- 观察与推断必须分字段、分区块呈现；不得把推断包装成事实。
- `pending=true` 的维度不得用默认值填充；UI 显示「未解析」，不显示 0/空串。
- 模型判断与实测必须可区分，不得把模型推断显示成实测事实。
- 叙事类结论必须有证据（关键帧/时间码），否则视为无效。

### 4.3 端点

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/reference-videos?q=&tag=&status=&cursor=` | 参考片列表 |
| GET | `/reference-videos/{videoId}` | 详情 + 镜头段计数 |
| POST | `/reference-videos/{videoId}/analyze` | 发起解析，`202` + `TaskAcceptedResponse` |
| GET | `/reference-shots?videoId=&status=&q=&tags=&sort=source&cursor=` | 镜头段列表 |
| GET | `/reference-shots/{shotId}` | 镜头段详情 |

- 解析能力未接入 → `422 capability_unavailable`（`details.capability="referenceAnalysis"`）；视频保持 `pending`，不伪造 `partial`。
- 解析是异步任务（`kind=analyze`），完成后由任务事件通知；前端轮询视频/镜头段状态即可。
- 解析结果写入新版本；重复解析不覆盖旧分析，保留历史（P1）。

## 5. 集合与个人偏好

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/reference-collections` | 集合列表（含成员数） |
| POST | `/reference-collections` | `{ name, note, shotIds }` |
| PATCH | `/reference-collections/{collectionId}` | 改名/备注/成员 |
| DELETE | `/reference-collections/{collectionId}` | 删除集合（不删镜头段） |
| GET | `/reference-preferences` | 收藏/最近/成员关系 |
| PATCH | `/reference-preferences` | 更新偏好，带 `If-Match` |

`ReferencePreference`：`favorites: string[]`、`recent: string[]`（最多 50，按最近倒序）、`memberships: Record<collectionId, shotIds[]>`。

- 偏好是**工作区级**，跨项目共享；不是项目数据。
- 不允许把「收藏」当「已审核/已采用」；收藏只是个人标记。
- `recent` 由后端在打开详情时自动更新，客户端也可显式提交（合并去重，保留最近 50）。

## 6. 三库共同规则

- 列表空态返回空数组；筛选无结果不返回 404。
- 所有预览图/视频走 URL，不内联 base64（当前 `workflow-gallery.html` 15.7MB 内联是过渡页问题，不进契约）。
- 搜索只匹配名称/别名/标签/描述，不做语义检索；语义检索属后续能力，未接入。
- 任何「用于创作/用于工作流」的写动作都必须走任务或显式关联端点，不在目录接口里偷偷写。
