# 契约 · 设置界面与现有后端

2026-11-23。配合 [settings.md](settings.md) 与 [打磨方案](../design/设置界面打磨方案-2026-11-23.md)。**本轮不新增后端接口。**

## 1. 数据来源（实测）

| 数据 | 来源 | 说明 |
|---|---|---|
| 全部偏好 | 本机 `localStorage`：`fengmotion:settings` | `GET/PATCH /settings` 后端未实现（返回 404）；设置不跨设备、不上传 |
| 能力状态 | `GET /capabilities` | 按钮可用性唯一依据 |
| 引擎清单 | `GET /harnesses`（`?refresh=true` 强制重测） | 本地 id `deepseek` 对应后端 `dsh-sdk`（`matchHarness`） |
| 模型清单 | `GET /harnesses/{id}/models` | 默认模型字段实测为 `isDefault` |
| 素材统计 | 素材接口 `stats` | 只读 |

## 2. 显示规则

- **模型**：已保存模型在清单里→显示 `label`；不在清单里→显示「`<id>` · 不在列表中」并提示重新选择；**不得静默改写**已保存的 `model`。清单为空（读取失败）时显示「选择模型」。
- **未接入分区**：导航中归到「尚未接入」小标签下；页面写明原因，不放开关。
- **破坏性操作**（清空旧素材索引、恢复默认设置）一律页内二次确认，写明影响；不使用浏览器原生 `confirm`。
- **焦点**：打开时落在当前分区导航项；Esc 关闭。

## 3. 需要后端补的（本轮不做）

| 需求 | 现状 | 建议 |
|---|---|---|
| 设置服务端持久化 | 404 | 实现 `GET/PATCH /settings`（theme、workspaceRoot、lastProjectId），前端保留本机为缓存 |
| 模型失效通知 | 前端比对 | 引擎模型下线时在 `/harnesses/{id}/models` 标 `deprecated`，前端据此提示 |
