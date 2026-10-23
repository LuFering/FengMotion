# 契约 · 检查（CheckRun / CheckFinding）

状态：**待评审冻结**。类型：`CheckRun`、`CheckFinding`、`CheckEvidence`、`CheckRunDetail`、`CheckConclusion`。
口径依据：页面职责合同 §1.1/§1.2；同一数据源须同时被 06 期检查页与工作台任务页签消费。

## 1. 边界与铁律

- 只冻结字段、状态、关联、定位链与端点；不含检查器实现、不含 UI。
- **铁律一**：用户标记「已处理」（`resolved`/`ignored`）≠ 检查通过。处理状态（`CheckFinding.status`）与检查结论（`CheckConclusion`）是两个概念，数据与 UI 都分离。
- **铁律二**：**未执行 ≠ 通过**。检查没跑（或跑失败/被取消）只能表达为 `not_run`，不得默认 `completed`，更不得默认通过。
- **铁律三**：叙事/内容类结论必须有渲染预览或关键帧证据（`evidence`），不接受仅凭源码或文字推断。
- 技术检查与内容/叙事检查分类呈现，但共用本契约，靠 `category` 区分。

## 2. CheckRun

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `checkRunId` | string | 是 | 一次检查运行 |
| `projectId` | string | 是 | 所属项目 |
| `taskId` | string | 是 | 关联任务（与 WorkflowRun.taskId 同源） |
| `renderId` | string | 是 | 被检查的产物版本；换产物必须新开 run |
| `status` | `running`/`completed`/`failed`/`cancelled` | 是 | 无 pending：创建即开始 |
| `startedAt` | ISO 8601 | 是 | 开始时间 |
| `completedAt` | ISO 8601 | 否 | 仅终态存在 |
| `supersedesCheckRunId` | string | 否 | 复检时指向被替代的旧 run |
| `counts` | `{blocker,major,minor,info}` | 否 | 仅 completed 存在；running 时不出现 |
| `demo` | `true` | 否 | 演示数据 |

**运行状态语义**

- `completed` = 检查项全部执行完毕；**不等于通过**，通过与否看 `conclusion` 与 finding 级别。
- `failed` = 检查器本身出错（不是「发现了很多问题」）。
- `cancelled` = 本次没跑完；对应结论 `not_run`，不得显示为通过。

## 3. CheckFinding

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `findingId` | string | 是 | 问题项 ID |
| `projectId` | string | 是 | 所属项目 |
| `checkRunId` | string | 是 | 所属检查运行 |
| `category` | string | 是 | 分类标签（`technical`/`narrative` 等），由检查项定义，不枚举 |
| `severity` | `blocker`/`major`/`minor`/`info` | 是 | blocker/major 阻断交付；其余只提示 |
| `title` / `description` | string | 是 | 结论与依据；description 写可复核事实，不写推测 |
| `targetType` | `scene`/`timeline`/`render`/`asset`/`workflow_node` | 是 | 与 `targetId` 组合定位 |
| `targetId` | string | 是 | 稳定 ID |
| `timecodeMs` | number | 否 | 画面定位；scene/timeline/render 时有意义 |
| `evidence` | CheckEvidence[] | 否 | 关键帧/截图/日志/指标；叙事类必填 |
| `status` | `open`/`doing`/`resolved`/`ignored` | 是 | **人对问题的处理状态**，与检查结论无关 |
| `suggestedFix` | string | 否 | 建议改法（给人看） |
| `fixAction` | string | 否 | 可执行修改入口标识（给 UI 跳转） |
| `createdAt` / `updatedAt` | ISO 8601 | 是 | 处理状态变更更新 `updatedAt` |
| `resolvedAt` | ISO 8601 | 否 | P1 预留 |
| `supersededByFindingId` | string | 否 | P1 预留：被新问题项取代 |
| `etag` | string | 是 | 条件更新凭证 |

**CheckEvidence**：`kind`（`frame`/`screenshot`/`log`/`metric`）、`ref`（产物 ID 或存储路径）、`timecodeMs?`、`note?`。证据是原始材料，不是结论摘要；没有证据的叙事类结论视为无效结论。

## 4. 端点

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/projects/{projectId}/checks` | 创建检查运行，`202` + `CheckRun` |
| GET | `/projects/{projectId}/checks?renderId=&status=&cursor=` | 项目检查列表 |
| GET | `/checks/{checkRunId}` | 运行详情 + 结论 + 首批 finding |
| GET | `/checks/{checkRunId}/findings?severity=&status=&category=&cursor=` | 问题项分页 |
| PATCH | `/check-findings/{findingId}` | 只改处理状态，带 `If-Match` |
| GET | `/renders/{renderId}/checks` | 某产物的检查记录 |

`POST .../checks`：

```json
{ "renderId": "r1", "categories": ["technical", "narrative"], "sceneIds": ["s01"], "supersedesCheckRunId": null }
```

- 能力未接入 → `422 capability_unavailable`（`details.capability = "checkExecution"`），不创建 run。
- `renderId` 必须属于该项目且状态 `completed`，否则 `400 validation_error`。
- 复检必须新开 run，`supersedesCheckRunId` 指向旧 run；旧 run 只读保留。

`PATCH /check-findings/{findingId}`：

```json
{ "status": "resolved", "note": "已改字幕断句" }
```

- 只接受 `status`/`note`；任何检查结论字段（severity/title/evidence）不可由客户端写。
- `status=resolved` 只写 finding，不改 `CheckRun.status`、不改 `conclusion`。
- 重复提交同一状态幂等返回当前对象。

## 5. 结论派生

`CheckConclusion` 是**派生值**，不落库：

| 条件 | 结论 |
|---|---|
| 无 run，或 run 为 `running`/`failed`/`cancelled` | `not_run` |
| run `completed` 且无 blocker/major | `passed` |
| run `completed` 且存在 blocker/major | `failed` |

- `minor`/`info` 不阻断，但必须在 UI 展示；「无 finding」与「未检查」必须能区分。
- `passed` 不等于「所有问题已处理」：`open` 的 minor 仍可存在。

## 6. 定位链

```
taskId + renderId + checkRunId        → 定位一次检查运行
targetType + targetId + timecodeMs    → 定位一个具体问题位置
fixAction                             → 给修改入口
supersedesCheckRunId                  → 复检与被替代运行的关系（P1）
```

- 不允许只给文字描述、不给 target；没有 target 的 finding 视为无效，后端拒收。
- `fixAction` 只是入口标识（如 `open-scene:s01`），契约不约定具体交互。

## 7. 与交付的关系

- `DeliveryState.status=deliverable` 要求检查结论不是 `failed`/`not_run`；`not_run` 不得被当作通过。
- 用户标记所有 finding 为 `resolved` **不会**自动把交付改成可交付；必须复检产生新的 `completed` run。
- 检查失败（`failed`）可重试：新 run，旧的保留。

## 8. 明确不做

- 不做自动修复（`fixAction` 只是入口）。
- 不做「检查通过率」聚合指标——当前没有可信分母。
- 不定义检查器内部规则、阈值、模型调用。
- 不允许前端写入 `counts`/`conclusion`/`CheckRun.status`。
