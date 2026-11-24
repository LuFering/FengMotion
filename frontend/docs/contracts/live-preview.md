# 契约 · 工程源码实时预览

状态：第一、二期后端接口已实现（2026-11-20）；第三期写回源码由前端预览服务实现（见文末）。前端预览壳位于 `frontend/live-preview/`，Java 按本文协议管理进程；工作台交互验收与后端进程验收分别记录。

## 目的

工作台不再只播放渲染好的 MP4，而是在隔离的预览窗口里实时运行项目的 Remotion 源码：画面里的文字、图形是真实页面元素，可以点选、读属性；AI 改了源码，画面热更新，不必等整片渲染。出片仍走现有工程渲染，生成新版本。

默认实时预览用于**当前工作稿**；另提供版本快照的只读实时预览，接口见 [backend-source-tools.md](backend-source-tools.md)。版本对比、时间线缩略图与导出仍使用登记的MP4。普通源码和 `shot-timeline-v1` 均支持，后者的装配入口在内存生成。

## 分工

| 部分 | 负责 | 位置 |
|---|---|---|
| 预览服务脚本（打包、热更新、静态文件、源码位置标注） | 前端 | `frontend/live-preview/server.mjs` |
| 预览窗口里的运行壳与探针（播放、命中、属性、轨道） | 前端 | `frontend/live-preview/harness/` |
| 工作台实时画面、点选与属性小窗 | 前端 | `frontend/src/features/workbench/` |
| 预览进程的启动、复用、回收与接口 | 后端 | 本文「后端接口」 |
| 打包进桌面安装包 | 后端 / 桌面 | `resources/live-preview/` |

## 预览服务脚本

后端用与渲染相同的 Node 可执行文件启动（`fengmotion.remotion.node`）：

```bash
node <live-preview-dir>/server.mjs \
  --project <项目根目录> \
  --entry <film.config.json 的 entry，相对项目根目录> \
  --composition <film.config.json 的 compositionId> \
  --node-modules <渲染用的共享 node_modules，即 fengmotion.remotion.node-modules> \
  --host 127.0.0.1 --port 0
```

- `--port 0` 由系统分配空闲端口。只监听 `127.0.0.1`。
- 依赖（`esbuild`、`@babel/core`、`@babel/parser`、`remotion`、`@remotion/player`、`react`、`react-dom`）全部从 `--node-modules` 解析，与出片使用同一份 Remotion 与 React。打包态的 `resources/remotion/node_modules` 需包含上述依赖。
- 脚本不写项目目录，打包结果只在内存里；监听项目 `src/` 与 `public/` 的变化自动重建。
- 镜头装配使用后端指定的共享 `shot-assembly.mjs`，`film.config.json` 变化会重建；不会把生成入口保存进工程。
- 历史预览传入 `--read-only true`，写回和撤销接口返回 `preview_read_only`。常规预览编辑和撤销必须经过共享源码锁及恢复日志检查。
- **就绪信号**：标准输出的第一行是一条 JSON：

  ```json
  {"event":"ready","url":"http://127.0.0.1:43127/","pid":12345}
  ```

  启动失败时输出 `{"event":"failed","code":"...","message":"..."}` 并以非零码退出。`code` 取值：`entry_missing`（入口不存在）、`dependency_missing`（`--node-modules` 里缺依赖）、`listen_failed`。之后的输出都是日志，后端写进日志文件即可，不要解析。
- 源码有编译错误时进程**不退出**，继续提供上一次成功的结果，错误通过预览窗口告诉前端。
- 收到 `SIGTERM` 立即退出。
- `pid` 为脚本报告的 Node PID，用于诊断，不要求等于 Java 创建的进程句柄（可经过 Node 版本管理器转发）。地址仍须为有效的 `http://127.0.0.1:<port>/`，且就绪时 HTTP 能响应。
- 脚本每 5 秒检查父进程，父进程消失后自行清理并退出，覆盖后端被强杀、不能执行关闭钩子的情况。

## 后端接口

### 启动或复用

`POST /api/projects/{projectId}/live-preview`，无请求体。

- 项目已有在运行的预览进程：直接返回，并刷新它的空闲计时。
- 否则读取项目根目录的 `film.config.json`（`entry`、`compositionId`），启动脚本，等待就绪信号（建议最长 60 秒）。

成功 `200`：

```json
{
  "projectId": "...",
  "status": "ready",
  "url": "http://127.0.0.1:43127/",
  "compositionId": "CoffeeCaffeine",
  "startedAt": "2026-11-20T10:00:00Z"
}
```

| HTTP | `error.code` | 含义 |
|---|---|---|
| 404 | `not_found` | 项目不存在 |
| 422 | `live_preview_unavailable` | 项目没有源码工程（缺 `film.config.json` 或入口），或脚本报 `entry_missing` / `dependency_missing`；`message` 说明原因 |
| 503 | `live_preview_start_timeout` | 等不到就绪信号；进程已被清理 |
| 503 | `live_preview_stopping` | 后端正在关闭，不再接受新启动；稍后重试 |
| 409 | `source_recovery_required` | 工作稿有未收尾写入，须先核对恢复；历史快照预览不修改工作稿 |

Agent 正在改这个项目时也允许预览：用户正需要看着画面跟着改动更新。

### 查询

`GET /api/projects/{projectId}/live-preview` → `200`，`status` 为 `ready` 或 `stopped`（`stopped` 时 `url` 为 `null`）。不启动进程。

三个接口的成功及业务错误响应均返回 `Cache-Control: no-store`。查询不延长空闲计时；就绪进程还会检查其 HTTP 页面是否能响应。HTTP 暂时无响应不会停掉仍存活的进程，沿用上次就绪状态；进程退出、显式停止或闲置回收才变为 `stopped`。启动尚未完成时查询返回 `stopped`，以启动请求最终结果为准。停止状态的 `compositionId`、`startedAt` 也为 `null`。缺少项目时三个接口均返回 `404 not_found`。

### 停止

`DELETE /api/projects/{projectId}/live-preview` → `204`。没有在运行的进程也返回 `204`。

### 生命周期

- 每个项目复用同一启动请求；稳定状态最多 3 个就绪预览。全局一次只启动一个新进程，切换时允许临时第四个：新进程就绪后才淘汰最近 POST 时间最早的旧预览，启动失败保留旧预览。其他新项目启动排队等待，共用 60 秒启动期限；同项目请求合并等待。
- 前端在工作台可见期间每 2 分钟重新 `POST` 一次作为心跳；距上次 `POST` 超过 10 分钟的进程由后端停止。
- 后端退出时停止全部预览进程。进程意外退出时记日志，下次 `POST` 重新启动。
- 同项目并发启动共用一次握手；启动等待期间允许查询和停止。停止、启动失败、超时与回收均清理 Node 及其子进程。项目物理删除后，下一次回收也会停止对应预览。
- 启动中的进程由启动请求解析最终信号或超时，不因回收扫描发现进程退出而丢失 `dependency_missing` 等失败原因。进程停止等待在共享状态锁外执行，其他项目的查询/心跳不等待它结束。
- 回收任务每 30 秒检查一次。此进程表只在当前后端实例内有效；重启后首次 `POST` 重新启动预览。

### 配置与运行记录

| 配置 | 默认值 / 用途 |
|---|---|
| `fengmotion.live-preview.project-dir` / `FENGMOTION_LIVE_PREVIEW_DIR` | 含 `server.mjs` 的目录；留空时定位开发目录或 Remotion 同级 `live-preview/` |
| `fengmotion.live-preview.start-timeout-seconds` | 60 秒 |
| `fengmotion.live-preview.idle-timeout-seconds` | 600 秒 |
| `fengmotion.remotion.node` | 与出片相同的 Node 可执行文件 |
| `fengmotion.remotion.node-modules` | 与出片相同的共享依赖目录；显式配置无效时直接报错，不换用另一套依赖 |

默认依赖配置为空，开发态从预览脚本所在的 `frontend/` 定位 `node_modules/`，可直接在 `backend/` 启动。显式环境变量/命令行配置仍优先并校验；桌面端继续传绝对路径。

每次启动的 stdout/stderr 保存在 `${fengmotion.data-dir}/logs/live-preview/<启动UUID>.*.log`，只将 stdout 首行解释为协议，后续日志不解析。各路异步读取，单文件默认保留前8MiB（`fengmotion.live-preview.max-log-bytes`，有效范围16KiB–64MiB），达到上限继续读取并丢弃，避免堵住子进程；尾部可能不在日志中。启动和结束时清理非活动历史日志：最多40个文件、合计128MiB、最长7天；活动文件与非预览日志不清理。此为容量管理，不是敏感内容脱敏保证。

当前支持 `film.config.json` 中有真实相对 `entry` 和 `compositionId` 的源码工程。入口越出项目（包括外指符号链接）会拒绝；`shot-timeline-v1` 只有后端生成入口，当前预览壳尚不接收此装配格式，返回 `422 live_preview_unavailable`。实时预览不创建版本、快照、渲染产物或源码声明，也不获取创作互斥锁。

桌面启动器传入资源目录和共享依赖绝对路径；资源准备脚本将预览壳复制到 `resources/live-preview/`，并显式包含 `@remotion/player`、`esbuild`、`@babel/core`、React 与 ReactDOM。该脚本实际使用 esbuild，无需为此安装 Vite。

Java 的职责是本机进程管理和入口校验。预览页面的来源隔离、消息来源验证及 Electron 权限仍由前端/桌面壳负责；不同端口本身不能保证项目代码无法请求其他本机 HTTP 服务。

## 第三期 · 写回源码（前端预览服务实现，后端无需改动）

自己改属性写回源码由预览服务自己完成，不经过 Java 后端：预览服务本来就持有项目目录、负责打包与热更新，
写回后它立刻重建，预览窗口刷新并停回原帧、选回原元素。后端只需按上文管理进程，不需要新接口。

接口只给预览页自己用（`/api/*`，同源 + 令牌）：

- 令牌：进程启动时随机生成，只嵌在预览页 HTML 里（`window.__fmToken`）；请求头 `x-fm-token` 必须一致，`Origin` 必须是预览服务自己。预览服务不发任何跨域许可，其他网页即使嵌入预览页也读不到令牌。
- `POST /api/inspect` `{ srcs: ["src/Coffee.tsx:170:5", …] }` → 每个位置的元素在源码里写死了什么：字面量（字符串 / 数字 / 布尔）、style 对象各项、元素里的纯文字；变量与表达式只返回代码。附带该文件指纹。
- `POST /api/edit` `{ src, path, value, expect, expectCode?, fileHash? }` → 只替换一个值：`path` 为 `['text']`（属性）、`['style','fontSize']`（style 对象一项）或 `['#children']`（元素里的文字）；`expect` 是读到的原值，style 新增一项时传 `null`；把表达式换成固定值时传 `expectCode`（原表达式代码，必须一字不差）。文件指纹或原值对不上返回 `409 source_changed`；计算出来的值返回 `422 not_static`。改动用文本替换完成，缩进、引号、注释保持原样；写入为原子替换。
- `POST /api/undo` → 撤销上一处写回；文件在这之后被别处改过则拒绝（`409`）并清空撤销栈。
- `POST /api/state` → `{ edits }`，本次预览进程里可撤销的修改数。

写回、撤销排队执行。只改项目自己的源码（不进 `node_modules`、不出项目目录）。写回只改工作稿，不创建版本；用户在工作台点「出片」时走现有工程渲染生成新版本。实现见 `frontend/live-preview/source-edit.mjs` 与 `server.mjs`，测试见 `frontend/tests/live-edit.test.mjs`。

2026-11-21：工作稿状态、AI 精准目标与确认出片新增 [workbench-source.md](workbench-source.md)。手动写回/撤销与 Java 精准写回共用短期源码锁；工作台出片改走带基线的后台作业。预览进程的撤销步数不再代表工作稿与成片是否一致。
