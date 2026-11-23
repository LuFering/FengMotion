# 契约 · 工作流界面所需的补充接口（导入进度、导入预检、节点执行能力）

状态：**后端已实现**（2026-11-21）。前端保留本文的「退回方式」以兼容旧后端。
范围：只写工作流首页、GitHub 导入面板、编辑器在界面上需要、而现有接口没有提供的三件事。导入与清点见 `skill-package.md`，预设生成、审阅、启用与落地见 `workflow-preset.md`，两份文档的现有端点不变。
路径：后端实际挂在 `/api`。

## 1. 界面术语

界面里每个概念只用一个叫法。契约和代码里的名字不变，下表只约束界面文案。

| 契约 / 代码 | 界面叫法 | 说明 |
|---|---|---|
| `WorkflowDefinition` / `WorkflowDef` | 工作流 | 不改名（2026-11-17 用户要求） |
| `WorkflowRun` | 运行 | 「试运行」「演示运行」都是运行，按能力标「演示」 |
| `SkillPackage` | Skill 包 | 从 GitHub 导入、固定在某个 commit 的仓库 |
| `WorkflowPreset` + `PresetMapping` | 预设 | 状态写「草稿 / 已启用」；来自 skill 的预设带「来自 GitHub」标签。「映射」「视频类型」「工作流预设」不再出现在界面上 |
| `POST /skill-packages/{id}/mappings` | 生成预设草稿 | |
| `instructedCommands` | Skill 要求运行的命令 | 三种处理：用内置检查替代 / 需要你批准 / 忽略 |

## 2. 生成预设草稿：改为可查询进度的后台作业

### 2.1 为什么

现有 `POST /skill-packages/{packageId}/mappings` 是同步调用，最长约 120 秒。界面只能把按钮改成「正在生成…」，看不出进行到哪一步，不能取消，刷新页面后也接不回来。

不复用 `task.md` 的任务：任务属于项目（`POST /projects/{projectId}/tasks`），生成预设草稿不属于任何项目。

### 2.2 MappingJob

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | 作业 ID |
| `skillPackageId` / `skillPath` | string | 生成哪个 SKILL.md |
| `status` | `queued` / `running` / `succeeded` / `failed` / `cancelled` | 单向迁移，终态不再变化 |
| `stage` | `collecting` / `calling_model` / `validating` / `saving` / `null` | 当前阶段；`queued` 和终态时为 `null` |
| `stageStartedAt` | ISO 8601 \| null | 当前阶段开始时间，界面据此显示「已用 N 秒」 |
| `startedAt` / `finishedAt` | ISO 8601 \| null | |
| `context` | object \| null | `collecting` 结束后出现：`{ files, chars, truncatedSources[] }`，即交给模型的文件数、字符数、没有完整交给模型的文件 |
| `presetId` | string \| null | `succeeded` 时为生成的草稿 ID |
| `error` | object \| null | `failed` 时出现：`{ code, message, problems[] }`。`problems` 与 `mapping_invalid` 的格式相同：`{ field, message }` |

阶段的含义与 `workflow-preset.md` §1 的现有步骤一一对应：

| `stage` | 后端在做什么 |
|---|---|
| `collecting` | 读取 SKILL.md，找出它提到的组件和依赖，按上下文预算选出交给模型的文件 |
| `calling_model` | 一次独立模型调用，没有工具 |
| `validating` | 格式校验与职责校验 |
| `saving` | 存为草稿 |

不提供百分比。模型调用耗时不可预估，界面只显示阶段和已用时间。

### 2.3 端点

| 方法 | 路径 | 说明 |
|---|---|---|
| `POST` | `/api/skill-packages/{packageId}/mapping-jobs` | 请求体 `{ skillPath }`，返回 `202` + MappingJob |
| `GET` | `/api/mapping-jobs/{jobId}` | 作业详情 |
| `GET` | `/api/skill-packages/{packageId}/mapping-jobs?active=true` | 这个包未结束的作业；刷新页面后用它接回 |
| `POST` | `/api/mapping-jobs/{jobId}/cancel` | 取消，只对 `queued` / `running` 有效；终态时原样返回当前作业 |

- 前端每秒轮询一次 `GET /api/mapping-jobs/{jobId}`，作业结束后停止。作业很少、持续时间短，不单独开 SSE。
- 同一个 `skillPackageId + skillPath` 已有未结束的作业时，`POST` 返回 `409 mapping_in_progress`，`details.jobId` 给出那个作业，前端直接接回它。
- 取消是请求不是保证：模型调用已经返回时，作业可能仍以 `succeeded` 结束并保存草稿。界面以最终状态为准。
- 校验不通过时作业以 `failed` 结束，`error.code = mapping_invalid`，**不保存草稿**，与同步接口相同。
- 已结束的作业至少保留 24 小时，之后可以清理。作业不写入预设的任何字段。
- 同步接口 `POST /skill-packages/{packageId}/mappings` 保留，行为不变。

### 2.4 退回方式（后端未实现时）

新端点返回 `404` 或 `405` 时，前端改调同步接口，界面只显示「正在生成预设草稿 · 已用 N 秒」，不显示阶段，不提供取消。不用假进度条。

## 3. 导入前预检（可选）

### 3.1 为什么

导入是同步下载，最长 60 秒。用户粘贴地址后，先确认「是不是这个仓库、哪个 commit、已经导入过没有」再下载，可以少走一次错误导入。

### 3.2 端点

`GET /api/skill-packages/resolve?repository=&ref=&path=`，参数与 `POST /skill-packages/import` 的请求体相同，返回：

| 字段 | 类型 | 说明 |
|---|---|---|
| `owner` / `repo` | string | 统一小写 |
| `ref` | string \| null | 解析出的分支 / 标签；`null` 表示默认分支 |
| `commitSha` | string | 将要固定的 40 位 commit |
| `subPath` | string | |
| `existingPackageId` | string \| null | 同一 `owner/repo/commitSha/subPath` 已导入时为包 ID |

- 只请求 `api.github.com` 把 ref 解析成 commit，不下载压缩包，不落盘，不计入导入登记。
- 错误码与 `skill-package.md` §5 相同（`validation_error` / `not_found` / `upstream_unavailable`）。
- 每次预检消耗一次 GitHub 未登录额度（每小时 60 次），前端只在用户停止输入 600ms 后、地址格式合法时调用一次。

### 3.3 退回方式

端点不存在时，前端只在本地校验地址格式（`owner/repo` 或 `https://github.com/owner/repo[...]`），按「导入」后直接调用导入接口。

## 4. 节点执行能力

### 4.1 为什么

同一个节点在不同条件下做的事不同：关联项目时「制作与渲染」会真实调用 Agent 渲染，没关联时只是演示。现在这条判断写死在前端（`useDisplayedGraph.ts`、`demoRun.ts`）。界面要在每个节点、检查器和运行按钮上如实标出来，需要一个统一来源。

### 4.2 端点

`GET /api/workflow/node-capabilities?projectId=&path=`，`projectId` 可为空，`path` 为 `prompt-first` 或 `structured`。返回数组：

| 字段 | 类型 | 说明 |
|---|---|---|
| `nodeType` | string | 与 `workflowTemplates.ts` 的节点类型一致 |
| `execution` | `agent` / `resolve` / `manual` / `deterministic` / `demo` | 见下表 |
| `available` | boolean | `false` 表示这个条件下不能运行该节点 |
| `reason` | string \| null | `available=false` 或 `execution=demo` 时给用户看的一句话 |

| `execution` | 含义 | 界面标签 |
|---|---|---|
| `agent` | 调用 Agent 制作或渲染，会写项目文件 | 真实制作 |
| `resolve` | 读取并解析资料（素材、参考、技法），不写项目内容 | 读取资料 |
| `manual` | 结论来自用户在检查器里的选择 | 需要你确认 |
| `deterministic` | 按规则判定，不调用模型 | 自动判定 |
| `demo` | 只产生界面快照，不读写项目 | 演示 |

### 4.3 退回方式

端点不存在时，前端按当前实现的事实使用下表，并且只在这一处维护（`services/workflowCapabilities.ts`）：

| 节点 | 关联了项目 | 未关联项目 | 分阶段评估 |
|---|---|---|---|
| 创作需求 `prompt` | `resolve`（运行时提交需求到 `prompt.original.md` / `corrections.md`） | `demo` | — |
| 素材与参考 `refs` | `resolve` | `demo` | — |
| 创作能力 `capability` | `resolve` | `demo` | — |
| 制作与渲染 `create` | `agent` | `demo` | — |
| 审片与修改 `review` | `manual` | `demo` | — |
| 交付 `delivery` | `deterministic` | `demo` | — |
| 产物 `artifact` / 检查点 `gate` | — | — | `manual`（只评估，不制作视频） |

## 5. 校验问题的定位

`mapping_invalid` 的 `problems[].field` 已是字段路径（如 `guide[0].sources[0]`、`stepMapping[3].action`）。前端按第一段字段名把问题挂到审阅面板的对应分组旁边，按下标定位到具体条目；认不出的字段放在面板顶部。后端不需要改动，只要求字段路径的写法保持现状。

## 6. 错误

| HTTP | code | 场景 |
|---|---|---|
| 400 | `validation_error` | 缺 `skillPath`；包里没有这个 SKILL.md；`path` 取值不对 |
| 404 | `not_found` | 包或作业不存在 |
| 409 | `mapping_in_progress` | 同一个 SKILL.md 已有未结束的作业，`details.jobId` 指向它 |
| 503 | `model_unavailable` | 模型未接入；作业不创建 |

作业内部的失败（模型调用失败、校验不通过、读文件失败）不以 HTTP 错误返回，作业以 `failed` 结束，原因放在 `error` 里。
