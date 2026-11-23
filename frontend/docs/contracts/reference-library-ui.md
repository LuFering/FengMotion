# 契约 · 参考片库界面与现有后端

2026-11-23。本轮界面实施契约，配合 [library.md §4–§5](library.md) 与 [打磨方案](../design/参考片库打磨方案-2026-11-23.md)。**本轮不新增后端接口或字段**；末尾列出需要后端补的数据。后端前缀 `/api`。

## 1. 读取

| 端点 | 界面用途 | 约束 |
|---|---|---|
| `GET /reference-videos` | 片单、片名区、时间轴总长（`durationMs`） | 读取中与失败是两个状态；失败不显示成空库 |
| `GET /reference-shots?videoId=` | 片段、时间轴、分析面板、片库卡片 | 缺失维度由前端补 `pending`，不补值 |
| `GET /reference-preferences` | 收藏、最近浏览 | 与特效库用户状态不混用 |
| `GET /reference-collections` | 「参考集合」页签的**唯一**名单来源 | 为 0 时页签不出现；不读演示常量 `REFERENCE_COLLECTIONS` |
| `GET /capabilities` → `referenceAnalysis` | 「开始分析」按钮闸门与旁注 | `unavailable` 时按钮置灰，旁注用服务端 `note`（当前「参考片解析未接入」）；缺项按不可用处理 |

## 2. 写入（均为现有端点）

| 动作 | 端点 | 界面要求 |
|---|---|---|
| 导入视频 | 上传 → `POST /reference-videos` | 进度只报文件序号，不编造百分比 |
| 标记片段 | `POST /reference-shots` | 从当前播放位置切出；成功后选中新片段 |
| 改观察 / 用法建议 / 起止 | `PATCH /reference-shots/{id}` | 失焦保存；失败保留草稿并提示 |
| 删除片段 | `DELETE /reference-shots/{id}` | 不删视频；放在面板底部 |
| 收藏 / 最近 | `reference-preferences` | 失败回滚并提示 |
| 开始分析 | `POST /reference-videos/{id}/analyze` | 能力不可用时**不发请求**；若仍收到 `422 capability_unavailable`，提示服务端 message，视频保持 `pending` |

「加入待发送」走前端待发送清单（`fm-pending-assets-v1`，`kind=ref`）；「用于工作流」写 `fm-reference-outbox-v1`，由工作流编辑器读取。两者独立，不互相替代。

## 3. 显示规则

- **时间**：界面一律 `分:秒`（`0:04`、`12:05`），非整秒保留一位小数（`0:04.5`）；时长写「4 秒」「1 分 5 秒」。不再显示「分:秒:帧」。
- **时间轴**：轨道代表整条视频（`durationMs`）；片段按 `start/end` 定位，宽度与时长成比例，最小可见 6px；播放头位置 = 当前播放时间。
- **状态**：视频状态在片名区只出现一次；片段状态在分析面板头部与片库卡片（仅 `partial/pending`）出现。
- **分析维度**：`pending=true` 显示「待分析」，不显示来源签；`source` 映射 `measured→实测`、`model→模型`、`user→人工`；`confidence` 为 null 时不显示置信度。
- **观察 / 推断**：观察与用法建议可编辑；推断只读并标「模型」；三者分区块。
- **集合**：只显示服务端返回的集合；没有集合时不出现页签，不显示演示集合。
- **筛选**：运镜、转场下拉只列已分析片段里实际出现的值；没有可选值时该下拉不出现。
- **说明文字**：不常驻快捷键说明；快捷键写进按钮 `title`。

## 4. 前端依赖的类名（保持不变）

`.rfc` `.rfc-stage` `.rfc-head` `.rfc-actions` `.rfc-panel` `.rfc-dock` `.rfc-segbar` `.rfc-seg` `.rfc-films` `.rfc-film` `.rfc-browse` `.rfc-card`。拖入待发送沿用 `setAssetDragData`。

## 5. 需要后端补的数据（本轮不做）

| 需求 | 现状 | 建议 |
|---|---|---|
| 片段关键帧 | 片段没有自己的图，片库卡片只能用整片封面 | `ReferenceShot.thumbnailUrl`：按 `startMs` 或中点抽帧 |
| 分析维度证据可视化 | `evidence` 是文本 | 增加 `evidenceFrames: {atMs, url}[]`，界面可点回时间点 |
| 集合管理界面 | 接口已有，界面没有入口 | 下一轮界面工作，不需要新接口 |
| 相似片段 / 语义检索 | 未接入 | 见对账-三库 §4.1 后续阶段 |

## 6. 影院精修补充（2026-11-23 下午）

仍不新增后端接口或字段。

- **时间轴拖动调整起止**：松手（或把手键盘调整后松键）时调用前端现有的 `PATCH /reference-segments/{id}`（读取为 `GET /reference-videos/{id}/segments`），body `{ startMs, endMs }`；与面板里输入起止走同一个 `saveSegmentEdits`。失败时提示服务端消息并回读原值。
- **约束（前端）**：片段最短 0.3 秒，起点 ≥ 0，终点 ≤ `durationMs`；步进 0.1 秒（Shift 1 秒）。
- **拖动定位**只改本地播放位置，不写服务端。面板开关存本机 `fm-ref-panel-open`，不上传。
