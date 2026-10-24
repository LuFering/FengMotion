# 契约 · 设置与能力（Capabilities / Settings / Health）

状态：**待评审冻结**。类型：`Capabilities`、`Capability`、`AppSettings`、`SettingsUpdateRequest`、`HealthStatus`。

## 1. 能力声明

`GET /capabilities` 是前端判断「按钮能不能点」的**唯一依据**；不允许按页面写死，也不允许靠试探请求猜。

```json
{
  "agent":            { "status": "unavailable", "note": "Agent 未连接" },
  "remotionEditor":   { "status": "unavailable", "note": "Remotion 编辑器未接入" },
  "previewVideo":     { "status": "available" },
  "cloudRender":      { "status": "unavailable", "note": "云渲染未接入" },
  "referenceAnalysis":{ "status": "unavailable", "note": "参考片解析未接入" },
  "asr":              { "status": "unavailable", "note": "ASR 未接入" },
  "checkExecution":   { "status": "unavailable", "note": "检查执行未接入" }
}
```

| 状态 | UI 表达 | 动作 |
|---|---|---|
| `available` | 正常 | 可用 |
| `demo` | 显示「演示」标识 | 可用，但结果不承诺真实 |
| `unavailable` | 置灰 + 一句人话原因 | 不可用；点击只解释，不发请求 |

**规则**：

- `note` 必须指名道姓（「云渲染未接入」），不用笼统的「后端未接入」。
- 能力状态变化必须由服务端推送或前端重新拉取；不缓存超过 60 秒。
- 能力为 `unavailable` 时，对应端点返回 `422 capability_unavailable`，不能返回空数组冒充成功。

## 2. 应用设置

`GET /settings` → `AppSettings`

| 字段 | 类型 | 说明 |
|---|---|---|
| `theme` | `dark`/`light`/`tactile` | 主题；只换值不换 token 名 |
| `workspaceRoot` | string | 项目根目录；浏览器演示态只读展示 |
| `locale` | `zh-CN` | 界面语言（当前固定） |
| `lastProjectId` | string? | 下次打开恢复的项目 |

`PATCH /settings`：

- 只接受 `theme`、`workspaceRoot`、`lastProjectId`。
- 改 `workspaceRoot` 必须校验目录可写；不可写返回 `400 validation_error`，不静默回退。
- 主题切换只改设置，不触发重新渲染项目内容。
- 设置是工作区级，不分项目。

## 3. 健康检查

`GET /health` → `HealthStatus`：

```json
{ "status": "ok", "version": "0.0.0", "uptimeMs": 123456 }
```

- `degraded` 表示服务在跑但部分能力不可用（如 Agent 进程掉线）；仍返回 200，细节看 `/capabilities`。
- 进程未起：连接失败，前端显示「本地服务未启动」，不重试风暴（指数退避，最多 3 次）。

## 4. 页面与能力对照

| 页面 | 依赖能力 | 未接入时的表达 |
|---|---|---|
| 首页 | `agent` | 提交只入队/置灰，明确「不会真的建任务」 |
| 我的创作 | 无（读项目） | — |
| 制作工作台 | `agent`、`previewVideo`、`remotionEditor` | 任务入口可用但提交即失败；编辑器置灰 |
| 工作流 | `agent` | 运行置灰，标注「Agent 未连接」 |
| 特效库 | 无（只读目录） | — |
| 参考片库 | `referenceAnalysis`、`asr` | 解析/识别置灰，标注未接入 |
| 我的素材 | `referenceAnalysis`（可选） | 导入可用，解析入口置灰 |
| 发布与验收 | `cloudRender`、`checkExecution` | 渲染/检查置灰，只展示真实已成片 |

## 5. 版本与兼容

- `/api/v1` 内只做兼容变更；能力枚举只增不改义。
- 新增能力必须同时更新本文件、`README.md` 的端点总表与 `src/types/contracts.ts`。
- 删除能力属于破坏性变更：至少保留一个版本的弃用期，并在 `note` 里写明替代项。
