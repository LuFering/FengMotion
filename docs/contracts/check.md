# 契约 · 检查（CheckRun / CheckFinding）

状态：**待评审冻结**。类型实体：`src/types/contracts.ts` 的 `CheckRun` / `CheckFinding`。
口径依据：01 期施工规格书 §6.2。同一数据源须同时被 06 期检查页与工作台任务页签消费。

## 1. 边界与铁律

- 本契约只冻结字段、状态、关联、定位链；不含检查器实现、不含 UI。
- **铁律一**：用户标记「已处理」（`resolved`/`ignored`）≠ 检查通过。处理状态（`CheckFinding.status`）与检查结论（`CheckRun.status`）是两个概念，在数据与 UI 上都分离，不得混用同一个字段或同一个文案。
- **铁律二**：**未执行 ≠ 通过**。检查没跑（或跑失败/被取消）只能表达为没跑，不得默认 `completed`，更不得默认通过。
- **铁律三**：叙事/内容类结论必须有渲染预览或关键帧证据（`evidence`），不接受仅凭源码或文字推断。
- 技术检查与内容/叙事检查分类呈现，但共用本契约，靠 `category` 区分。

## 2. CheckRun

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `checkRunId` | string | 是 | 一次检查运行 |
| `taskId` | string | 是 | 关联任务（与 WorkflowRun.taskId 同源） |
| `renderId` | string | 是 | 被检查的产物版本；换产物必须新开 run |
| `status` | CheckRunStatus | 是 | `running` / `completed` / `failed` / `cancelled` |
| `startedAt` | ISO 8601 | 是 | 创建即开始（无 pending 态） |
| `completedAt` | ISO 8601 | 否 | 仅终态存在 |
| `supersedesCheckRunId` | string | 否 | P1 预留：复检时指向被替代的旧 run |

**运行状态语义**

- `completed` = 检查项全部执行完毕；**不等于通过**，通过与否看 `CheckFinding` 的有无与级别。
- `failed` = 检查器本身出错（不是「发现了很多问题」）。
- `cancelled` = 本次没跑完；对应结论为「未检查」，不得显示为通过。

## 3. CheckFinding

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `findingId` | string | 是 | 问题项 ID |
| `checkRunId` | string | 是 | 所属检查运行 |
| `category` | string | 是 | 分类标签（如 `technical` / `narrative`），由检查项定义，契约不枚举 |
| `severity` | `blocker`/`major`/`minor`/`info` | 是 | blocker/major 阻断交付；minor/info 只提示 |
| `title` / `description` | string | 是 | 结论与依据；description 写可复核的事实，不写推测 |
| `targetType` | `scene`/`timeline`/`render`/`asset`/`workflow_node` | 是 | 与 `targetId` 组合定位 |
| `targetId` | string | 是 | 稳定 ID |
| `timecodeMs` | number（毫秒） | 否 | 画面定位；`scene`/`timeline`/`render` 时有意义 |
| `evidence` | CheckEvidence[] | 否 | 关键帧/截图/日志/指标；叙事类必填 |
| `status` | `open`/`doing`/`resolved`/`ignored` | 是 | **人对问题的处理状态**，与检查结论无关 |
| `suggestedFix` | string | 否 | 建议改法（给人看） |
| `fixAction` | string | 否 | 可执行修改入口标识（给 UI 跳转用）；契约只约定标识，不约定交互 |
| `createdAt` / `updatedAt` | ISO 8601 | 是 | 处理状态变更更新 `updatedAt` |
| `resolvedAt` | ISO 8601 | 否 | P1 预留 |
| `supersededByFindingId` | string | 否 | P1 预留：被新问题项取代 |

**CheckEvidence**：`kind`（`frame`/`screenshot`/`log`/`metric`）、`ref`（产物 ID 或存储路径）、`timecodeMs?`、`note?`。证据是原始材料，不是结论摘要；没有证据的叙事类结论视为无效结论。

## 4. 定位链

```
taskId + renderId + checkRunId   → 定位一次检查运行
targetType + targetId + timecodeMs → 定位一个具体问题位置
fixAction                        → 给修改入口
supersedesCheckRunId             → 复检与被替代运行的关系（P1）
```

## 5. 复检与去重

- 修完复检 = **新 run**，旧 run 只读保留并以 `supersedesCheckRunId` 关联；不原地改旧 run 的结论。
- 同一问题项跨复检**不做自动合并**（P1 再用 `supersededByFindingId` 关联）；01 期允许重复出现，由 UI 折叠展示。

## 6. 接口边界

- 检查页与任务页签读同一 `checkRunId` 数据源，不许各存一份结论。
- `status` 变更（人处理动作）只写 `CheckFinding.status`，绝不写 `CheckRun.status`——后者只能由检查器写入。
- 后端不得用「无 finding」表达「未检查」；未检查必须体现为 `CheckRun.status ≠ completed` 或缺少该 run。

## 7. 明确不做

- 不做自动修复（`fixAction` 只是入口标识）。
- 不做「检查通过率」聚合指标——01 期没有可信分母，先不做。
- 不定义检查器内部规则、阈值、模型调用。
