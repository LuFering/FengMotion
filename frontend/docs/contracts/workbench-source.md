# 工作台工作稿、精准修改与确认出片

更新：2026-11-23。实时预览的进程接口见 [live-preview.md](live-preview.md)。本文约定当前工作稿和成片版本之间的边界；不改变工作台布局。

## 工作稿状态

`GET /api/projects/{projectId}/source/state` 返回：

```json
{
  "projectId": "...",
  "version": 1,
  "sourceHash": "files=4;sha256=...",
  "renderedSourceHash": "files=4;sha256=...",
  "dirty": true,
  "status": "dirty",
  "operationBusy": false,
  "artifactPath": "renders/project-....mp4"
}
```

`sourceHash` 来自工作区实际源码与素材，`renderedSourceHash` 来自当前已提交成片。`version` 为场景版本，无成片时为 `0`。`status` 为 `unrendered`、`clean`、`dirty` 或 `unknown`。旧版本缺少源码指纹时 `dirty` 为 `null`，不能假定已同步；空的新工程未出片时 `dirty` 为 `false`，写入源码后为 `true`。读接口不登记版本，不创建源码快照。

前端在实时预览可见时查询，源码刷新、写回和撤销后重新读取。预览进程的撤销步数只表示本次进程可撤销的历史，不作为未出片判断。源码改回与成片相同的内容后，`dirty` 自动变为 `false`。渲染期间的新修改继续保留为工作稿。

## AI 修改只保存工作稿

现有 `POST /api/projects/{projectId}/creation-jobs` 增加：

```json
{
  "requestId": "unique-request-id",
  "intent": "把标题改短",
  "outputMode": "draft",
  "baseVersion": 1,
  "sourceHash": "files=4;sha256=..."
}
```

其他会话、消息、引擎、资源引用与取消字段沿用原契约。实时工作台发送 `outputMode: draft`；成功修改的终态为 `edited`，回复保存到原会话，`version`、`artifactPath` 为 `null`。没有源码改动仍返回 `awaiting_info`。任务恢复和同 ID 重试识别 `edited`，不会重新执行或补渲染。缺省及 `render` 保留原制作工作流行为；显式镜头首次制作不能混用 `draft`。

实时预览活跃期间，普通项目对话改动源码也延后出片；工作台的显式 `draft` 请求不依赖预览进程是否仍活跃。

显式 `draft` 请求的全工程修改也先在独立源码副本运行，保留工程指引作为上下文。候选只应用 `src/`、`public/`、`film.config.json` 和 `package.json`；写回时取得共享写入锁、复核原始工作稿指纹，普通异常回滚多文件变更，成功后清理临时副本及应用备份。Agent 失败、执行取消、基线变化或写入锁占用均不能将候选覆盖到原工作稿。该机制不等于操作系统沙箱，也不承诺断电时多文件原子提交。

## 解析精准源码目标

`POST /api/projects/{projectId}/source/target`

```json
{ "src": "src/Coffee.tsx:170:5", "fileHash": "预览读取时的文件指纹" }
```

行、列均从 `1` 开始。后端核对文件指纹，并用共享 Babel parser 按真实 JSX 节点定位，返回：

```json
{
  "projectId": "...",
  "baseVersion": 1,
  "sourceHash": "files=4;sha256=...",
  "target": {
    "file": "src/Coffee.tsx",
    "line": 170,
    "column": 5,
    "fileHash": "64位SHA-256",
    "code": "<Chars text={'原标题'} style={{fontSize:106}} />"
  }
}
```

解析入口兼容旧预览的 16 位截断 SHA-1 与 40 位完整 SHA-1，返回统一的完整 SHA-256；新预览服务的文件指纹也使用完整 SHA-256。实际修改请求只接受解析后返回的 64 位指纹。只能定位项目内 `.tsx` / `.jsx` 文件，拒绝绝对路径、路径穿越、符号链接、依赖目录及非 JSX 位置。单文件最多 1 MiB，目标 JSX 最多 32768 个 UTF-16 代码单元。

前端将返回的 `baseVersion`、`sourceHash`、`target` 原样加入 `draft` 制作请求。文字优先绑定实际传入文字的组件调用处，避免默认修改公共组件定义。提交前和开始执行时都复核；文件变化、源码原文不同或基线过期返回冲突，不能自动改用最新行号或全工程模式。

精准任务先复制已校验的源码及只读上下文，在独立副本运行现有 Agent。模型可自由改写选中 JSX 的结构、表达式与属性。写回前必须同时满足：

1. 选中 JSX 前后的源码完全保留，文件内其他内容不能改变；
2. 修改后的文件可解析，其他源码、配置和素材没有改动；
3. 工作稿仍与原基线一致，文件指纹及 JSX 原文仍匹配；
4. 取得与预览服务共享的短期写入锁，然后原子替换目标文件。

越界和无效候选只存在于副本中，失败后清理，不登记版本、不覆盖工作稿。需要新增导入、调整其他组件或全局风格时，应明确扩大修改范围后发起普通工作稿任务。该范围是源码 JSX；循环生成的多个运行时实例可能共用同一源码目标。独立副本是写回边界，不等于 Agent 的操作系统权限沙箱。

## 确认出片作业

`POST /api/projects/{projectId}/render-jobs` 返回 `202`：

```json
{
  "requestId": "unique-render-id",
  "baseVersion": 1,
  "sourceHash": "files=4;sha256=...",
  "prompt": "确认当前工作稿"
}
```

`GET /api/projects/{projectId}/render-jobs/{requestId}` 查询，`POST .../{requestId}/cancel` 取消。状态包括 `accepted`、`running`、`rendered`、`failed`、`cancelled`、`interrupted`。对象含 `projectId`、`requestId`、`state`、`result`、`errorCode`、`error`、`createdAt` 和 `updatedAt`。成功 `result` 保留原 `FilmRenderResult` 字段并增加 `sourceHash`。

版本和工作稿指纹在接单及执行时校验；源码复制前后与快照自身都必须等于请求指纹。开始渲染后只读这份快照，允许用户继续修改工作稿。提交仍使用场景版本条件更新，成功后保存视频、轨道和历史快照；渲染失败、取消或提交冲突不登记新版本，清理未提交产物。

同一项目、同一请求 ID、相同内容返回原作业或原成片；相同 ID 不同内容返回 `task_idempotency_conflict`。浏览器断开不会取消任务。前端保留未确认请求并在重连后查询原作业，不能因为超时另造 ID。服务重启后通过版本中的请求凭据恢复已提交但回执未保存的结果；没有提交证据的运行记录标记 `interrupted`，不自动重新渲染。

已登记请求的精确重放不依赖当前工作区是否仍可读取；新请求仍需通过项目及源码基线校验。取消排队请求立即持久化 `cancelled`，移出执行队列并释放项目名额；取消运行请求可能先返回 `running`，待执行收尾后查询终态。取消标记独立于线程中断位，渲染器吞掉中断也不能据此提交尚未登记的结果；已提交版本仍以真实成片为准。正常关闭将未执行队列记录为 `interrupted`，并中断运行任务收尾。

旧 `POST /workflow/render` 保留给兼容调用方。工作台 `renderFilm()` 已改用上述带基线的后台作业，不再通过旧接口无条件重发。

## 冲突与维护

成功和业务错误响应均不缓存。重点错误码：`source_changed`、`version_conflict` / `scene_version_conflict`、`source_target_invalid`、`source_target_out_of_scope`、`source_busy`、`project_busy`、`task_idempotency_conflict`。收到冲突先读取当前状态并让用户核对，不能自动覆盖或扩大目标。

Java 精准写回和预览服务手动写回/撤销共用 `.fengmotion/source-write.lock/`。锁只在实际写入期间持有，不锁住模型生成或整片渲染。正常成功/失败均释放自己的锁；强杀恰好发生在写入期间时保留锁以避免覆盖。只有确认 `owner.json` 中的进程已退出且没有其他写入后，才可人工清理遗留锁；不要根据时间擅自抢锁。外部编辑器不参与此协议，仍须依靠文件指纹检查和用户核对。

历史源码恢复也持有该共享锁，直到恢复提交或失败回滚结束；预览编辑占锁时恢复返回 `source_busy`。显式draft、旧自动出片制作与项目聊天现均通过候选副本写回；精准JSX和旧文字接口也写恢复日志。只允许应用约定的源码/素材范围，不把工程外文件纳入回写。新增取帧、恢复与后台操作见 [backend-source-tools.md](backend-source-tools.md)。

## 验证入口

后端：`ProjectDraftCreationTest`、`ProjectWorktreeApiTest`、`SourceRenderJobsTest`、`SourceTargetServiceTest`、`LivePreviewRuntimeTest`。前端：`source-render.test.mjs`、`source-write-guard.test.mjs`、`live-edit.test.mjs`。

真实出片验收仅对独立数据库/项目运行，包含一次真实 Agent 修改时使用 `--real-agent`：

```bash
FENGMOTION_ACCEPTANCE_API=http://127.0.0.1:18084/api \
FENGMOTION_ACCEPTANCE_REPORT=/tmp/workbench-source-acceptance.json \
node backend/src/test/workbench-source/acceptance.mjs --real-agent
```

脚本创建新项目，验证 v1 → 手动修改/撤销 → 过期目标拒绝 → 精准工作稿修改 → 热更新 → 确认出片 v2 → 请求重试不重复出片。不会改已有 coffee 项目。
