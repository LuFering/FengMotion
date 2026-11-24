# 后端源码工具与恢复契约

更新：2026-11-23。以下接口均以 `/api/projects/{projectId}` 为前缀，成功和业务错误均 `Cache-Control: no-store`。这是后端能力契约，不代表前端已接入控件。

JSON请求严格解析：版本、修订号和帧号等整数字段不接受小数截断；重复字段、多份拼接JSON返回400 `validation_error`，不进入任务或文件写入。

## 指定源码帧

`POST /source/frame`

```json
{"baseVersion":1,"sourceHash":"files=4;sha256=...","frame":15}
```

帧号从0开始，必须小于合成总帧数。后端校验场景版本和工作稿指纹，冻结并复核源码快照，使用与出片相同的依赖和合成渲染单帧。响应包括 `projectId`、`baseVersion`、`sourceHash`、`frame`、`width`、`height`、`fps`、`dataUrl`，图片为PNG。`dataUrl` 可直接作为创作请求 `previewImage`，创作入口同时接受JPEG及PNG并验证签名。

取帧不修改源码、不登记视频版本、不保留临时快照；调用期间的新工作稿改动不影响该冻结帧。并发上限2，超出返回 `429 frame_queue_full`。图片最大3,700,000字节，与Agent输入长度限制匹配。错误包含 `source_changed`、`scene_version_conflict`、`frame_out_of_range`、`frame_invalid`、`render_timeout`；帧超出范围返回400。

返回前真实解码PNG并核对渲染规格，不接受只有PNG签名的坏文件；像素预算33,177,600，超过或规格不一致为 `frame_invalid`。工作稿状态读取期间版本变化返回409，而不是混合旧版与新版元数据。

## 后台工作台操作

`POST /workbench-jobs` 返回202；`GET /workbench-jobs/{requestId}` 查询；`POST /workbench-jobs/{requestId}/cancel` 取消；`GET /workbench-jobs` 返回最近100项。

```json
{"requestId":"unique-id","kind":"timeline_recovery","artifactPath":"renders/film.mp4"}
```

- `timeline_recovery`：需要 `artifactPath`，结果为真实轨道清单。恢复前后验证视频指纹及来源快照，不登记新版本。
- `shot_preview`：需要 `candidate`，字段同镜头候选原同步接口（`requestId`为UUID、`baseVersion`、`sourceHash`、`shotId`、`componentSource`、可选`prompt`）。结果为候选预览信息，不应用工作稿。
- `shot_commit`：需要 `version`、`candidateId`。结果为提交版本、视频及源码指纹，重复候选不会重复登记版本。
- `version_verify`：需要 `version`，不接收artifactPath/candidate；按该版本权威产物进行只读技术完整性核验，不渲染、不写源码、不新增视频版本。

镜头装配带voiceover时，保存的轨道清单除shots外还包含独立voiceover音轨，覆盖合成时长；它表达装配槽位，不等于源音频实际有效发声时长或音画同步检查。

作业响应字段：`projectId`、`requestId`、`kind`、`state`、`result`、`errorCode`、`error`、`createdAt`。状态为 `accepted/running/completed/failed/cancelled/interrupted`。同ID同内容返回原作业；同ID不同内容返回409 `task_idempotency_conflict`。执行器2个并发、20个排队；队列满会持久化失败，不静默丢任务。

排队取消立即移出执行器；执行取消待清理结束后收尾。已经提交的版本不因取消撤销。重启后先读取已经存在的轨道或候选提交凭据，能确认完成则恢复结果；无证据则标记interrupted，不自动重新调用渲染。用户核对后可用新请求ID重试，候选ID保持不变可利用提交幂等。

旧同步接口继续兼容。使用新后台接口需要客户端主动接入，后端不会将原同步响应暗中变成202。

### 版本技术核验结果

提交 `{"requestId":"...","kind":"version_verify","version":2}` 后通过同一作业查询。作业 `completed` 只表示核验执行结束，须读取 `result.conclusion`（passed/failed/not_run）。结果包含projectId、version、artifactPath、videoHash、checkedAt、scope=`technical-integrity-v1`、checks逐项状态/错误码/证据。实际检查视频存在与SHA-256、ffprobe帧数/时长/帧率/画布、轨道绑定和源码快照/入口；探测器不可用或无法给出帧数时不能标通过。核验期间视频变化使结果作废。

`visualReview`固定为 `not_run`：此接口不检查内容事实、构图/遮挡、叙事、授权、音画同步或完整解码，不等于可交付或人工验收。已有同请求结果是当时的证据，视频之后变化需用新请求ID复检；重启丢失报告时标interrupted，不因有视频就猜核验通过。此能力不改变通用checkExecution尚未接入的声明。

### 版本审阅记录

`GET/POST /scene/versions/{version}/reviews`：读取/追加本地审阅决定，均no-store。POST示例：

```json
{"requestId":"review-1","expectedRevision":0,"decision":"approved","note":"已观看该版","videoHash":"64位SHA256","verificationRequestId":"verify-1"}
```

决定为approved/rejected；拒绝必须附原因，通过必须引用同项目、同版本、同视频摘要的已通过version_verify。新增决定只允许当前版本，项目操作锁覆盖提交检查；旧记录只追加、最多500条，使用expectedRevision防覆盖，同requestId同内容返回原决定，不同内容409。

GET返回revision、state（unreviewed/approved/rejected/stale）、videoHash、unavailableCode、latest及history。视频内容变化或缺失使既有决定stale；新版本（包括恢复产生的新版本）没有继承审批。技术核验报告不会因此变成“视觉已检查”。`recordedVia:local-review-api`只标记录通道：当前没有可信用户认证，不能证明调用者一定是人，不能当作有身份签名的正式验收，也未自动接工作流交付。旧的local-documents review是自由反馈记录，不自动迁为批准决定。

## 写入中断恢复

`GET /source/recovery` 返回：

```json
{
  "sourceHash":"files=4;sha256=...",
  "lock":{"pid":1234,"token":"UUID","alive":false},
  "recoveries":[{"id":"UUID","state":"applied","beforeHash":"...","afterHash":"...","ownerAlive":false}]
}
```

没有锁时 `lock:null`，无待处理日志时 `recoveries:[]`。读取接口不修改工作稿。

`POST /source/recovery`：

```json
{"sourceHash":"当前指纹","lockToken":"刚读取的锁token或null","recoveryId":"待恢复日志ID或null"}
```

恢复必须排除所有已登记的项目活动，包括实时预览；不能在预览继续写文件时恢复。存活进程、未知/无效锁身份、token不匹配均拒绝；已确认退出的锁移入隔离目录保留证据。恢复使用原稿副本、整体/条目指纹和目录替换阶段判断现场；发现日志外修改返回 `recovery_manual_required`，保留现场而非覆盖。日志指向的结果已被数据库提交时保留已提交内容并收尾日志；无版本提交且与中断现场吻合时恢复原稿。

新多文件应用/恢复在 `.fengmotion/restore-backups/{id}/recovery.json` 记录阶段；有未收尾日志的编辑、出片和预览启动返回 `source_recovery_required`。早期没有日志的遗留备份不能凭目录名称自动推断。PID仍存活（包括可能复用）时保持拒绝，不按时间抢锁。该通道处理进程中断，不保证磁盘物理损坏或任意外部编辑可自动恢复。

恢复日志上限为 1 MiB，Java 写入、恢复读取和 Node 写入准入使用同一上限；容量超限在替换前拒绝，避免根目录组件较多时成功恢复后却被较小读取上限永久拦住。

## 执行隔离与部署

历史只读预览：`POST/GET/DELETE /scene/versions/{version}/live-preview`。使用该版本的已校验快照建立独立临时工程，与当前稿共用三个就绪预览名额和空闲回收机制。响应结构沿用实时预览接口；预览运行时的 `state` 返回 `readOnly:true`，`edit`、`undo` 拒绝为422 `preview_read_only`。关闭/回收时先退出进程，再清理副本。无源码快照的旧版本返回不可用，不能使用当前源码冒充历史。普通入口与镜头装配均支持；装配使用共享 `shot-assembly.mjs` 在内存生成入口，不写工程。清单无效时保留上次有效预览并报告构建错误。

普通工作稿、旧制作、镜头首次制作和项目聊天源码修改均使用独立候选副本，只有基线和写入校验通过才应用源码。清单覆盖 `src/`、`public/`、`components/`、`scenes/`、`styles/`、`assets/`，以及根目录 `.tsx/.ts/.jsx/.js/.mjs/.cjs/.css/.json` 文件；排除隐藏文件、`project.json`、`creation-state.json`、`recovery.json` 和锁文件。工程指引复制为上下文，不写回原稿。聊天使用显式历史恢复上下文；不继续复用绑定旧临时目录的引擎会话。旧快照若从未保存根目录组件，不会伪装补齐，当前稿需重新出片建立完整快照。

新快照额外记录 `.source-layout` 范围版本。无范围标记的旧快照在项目包含新增范围文件时，恢复返回 `422 source_snapshot_scope_unknown` 并保留当前文件，不静默删除过去可能未备份的根目录源码。没有扩展范围文件的旧快照仍可恢复。版本 `sources` 清单与源码指纹使用同一文件集合；工程入口和精准 JSX 目标必须位于该集合，入口绝对路径、越界、符号链接和未纳入快照的目录提前拒绝。

独立副本不等于操作系统Agent沙箱。运行时使用共享依赖；Node或外部编辑器不应绕过写入协议。新后端对SQLite文件取得操作系统级租约，第二个新实例使用同一数据库会启动失败；旧版本未实现该租约时，升级仍需先关闭旧实例。不同数据库可独立启动。

验收脚本 `backend/src/test/workbench-source/launch-acceptance.py` 支持 `--verify-frame`、`--verify-jobs`、`--verify-shots`、`--verify-data-lease`、`--verify-history`，模型路径可选 `--real-agent --verify-chat` 或 `--real-agent --verify-legacy`。仅在隔离数据库和新建工程运行。

`--root-source` 使用根目录入口、实际导入的 `components/Caption.tsx`、样式与 `theme.json`，验证快照内容、版本清单、恢复删除新文件及原依赖还原；可与真实模型及历史预览检查组合使用。

## 渲染结果边界

工程渲染、镜头确认和声明文字修改的新版本记录实际共享运行时的 `remotion`、`@remotion/renderer`、`@remotion/bundler`、`react` 安装版本，不把 package.json 的依赖范围当成已使用版本。快照保存源码与本地素材，不打包完整node_modules；回放时不保证外部依赖升级后的逐像素一致。

两条渲染器均拒绝非零退出、缺失/非法帧数、画布或帧率、空产物与符号链接产物。工具stdout上限2MiB，超过返回 `process_output_too_large`，stderr仅有界读取尾部；这限制内存消耗，不代表临时日志文件已有磁盘配额。

## 公共文档分页

`GET /api/local-documents/page?namespace=&projectId=&cursor=&limit=50` 返回 `{items,nextCursor}`。limit为1–200；namespace仅限原公共文档类型，内部创作/出片/工作台作业不可查。cursor绑定namespace与projectId，不可跨过滤条件使用；按namespace/id键集向后查询，包含删除墓碑供同步。

分页不是跨请求数据库快照：分页期间新增到当前游标之前的记录需下一轮扫描，不能据此删除本地缓存。成功/失败均不缓存。旧 `GET /api/local-documents` 保持数组响应，后端不擅自截断旧客户端数据。

每页还按 `local-documents.max-bytes`（默认16,000,000）限制数据正文UTF-8总量，因此 `items.length` 可以小于limit而仍有nextCursor；以nextCursor判断是否还有下一页。只为确认下一页存在而读取的记录不反序列化正文，坏的下一页记录不会阻止当前页读取。文档项目归属转移同时占用原项目和目标项目的删除准入，避免旧项目清除时转移记录被重建或误删。
