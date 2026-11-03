# FengMotion 后端

Spring Boot 3 / Java 21 后端基础工程。模块边界和后续开发顺序见 [ARCHITECTURE.md](ARCHITECTURE.md)。前端 HTTP 客户端使用 `/api`，目标契约仍待评审，参见 `../FengMotion-前后端迁移与视频生成方案/02-前后端API契约.md`。

持久化采用 MyBatis / MyBatis-Plus（`mybatis-plus-spring-boot3-starter`），SQLite 作为数据库。`JdbcTemplate` 仅保留给启动期的 `DatabaseMigration`（DDL / PRAGMA / 旧数据回填），不参与业务数据访问；事务边界由 `TransactionTemplate`（创建协调器）与 `@Transactional`（更新、发消息）管理。

## 启动与验证

```bash
# 在 FengMotion-backend 目录下执行；本机 Maven 位于 ~/.local/opt/apache-maven-3.9.9/bin/mvn
mvn test
mvn spring-boot:run
curl http://127.0.0.1:8080/api/health
curl http://127.0.0.1:8080/api/capabilities
```

默认只监听本机 8080，开发 CORS 配置在 `src/main/resources/application.yml`。健康检查只说明服务可以响应；能力声明反映服务端能力。当前 `agent` 一项按真实探测结果返回（本机 dsh 0.2.1-rc.2 可用时为 `available`），其余能力在对应模块接入前保持 `unavailable`。

## 目前的代码

- `system`：健康检查与能力声明。
- `common`、`config`：基础异常、分页游标工具和 HTTP 配置。业务异常和数据库错误使用嵌套错误格式并携带请求标识。`config.DatabaseMigration` 只负责启动期的表结构兼容升级（含旧库补列），使用 `JdbcTemplate` 执行 DDL。
- `project`：创建（含幂等）、列表、详情、条件更新和归档已接入 SQLite。`DELETE` 默认归档；`?purge=true` 的物理删除因任务状态未接入返回 `capability_unavailable`。项目目录默认位于 `~/FengMotion/projects`，可通过 `fengmotion.workspace-root` 配置。
- `chat`：会话创建、列表、详情、软删除，以及消息历史（按序号键集分页）和发送（含幂等）已接入 SQLite。回复流 `GET /chat-sessions/{id}/stream` 走真实 DSH：SSE 依次发 `status` / `delta`（token 级）/ `usage` / `title` / `completed` / `end`。助手消息落库后才发 `completed`，失败只发 `error` 不假装完成。设计说明见 [docs/会话消息持久化.md](docs/会话消息持久化.md)。
- `harness`：DSH 接入。通过 `dsh --profile sdk` 的 JSON-RPC 驱动对话，模型目录从 `--dump-config` 解析；随包 `dsh-plugin/` 订阅 DSH 内部 `agent/assistant-stream` 并经 stderr 转出 token 级帧。进程模型为**每轮一个子进程 + `session/resume` 冷续接**（不做常驻进程池）。详见 [docs/harness集成与接口清单.md](docs/harness集成与接口清单.md)。
- `upload`：附件上传 `POST /api/uploads`。MIME 白名单、64 MiB 上限、落盘名为随机 UUID（原始文件名只做展示，防目录穿越），响应只给 `fileId` 不给路径。图片附件会随消息转成 base64 内联块发给模型（实测可识图）。
- `task`、`catalog`、`workspace`：领域包占位，具体业务待实现。

持久化统一由 MyBatis / MyBatis-Plus Mapper 承担，无业务代码直接使用 `JdbcTemplate`。已知限制：没有消息编辑/撤回、幂等记录不自动清理、SQLite 写锁未做并发压测；这些与 `chat` 的当前能力边界一起记录在 `docs/会话消息持久化.md`。

前端页面已接入项目、会话、消息与附件上传接口。**Agent 回复已接入**：真实模型回复会流式到达并落库，历史可回读；界面仍以 `completed` 携带的完整消息为准，不得把拼接中的 `delta` 当作最终回答。

已验证（本机实测）：多轮上下文续接、token 级流式、工具调用结构化与持久化、token 用量、会话标题自动生成、图片附件识图。
未接入：`task` / `catalog` / `workspace` 三个领域；协议级取消（DSH 不提供 cancel 方法，只能杀进程）。

## 新增接口

先核对前端 `src/services/api/` 客户端和 `docs/contracts/`，评审并同步接口、类型和错误语义；再按领域创建 `api`、`service`、`domain`，需要持久化或外部依赖时再增加 `store`（含 `store/mapper` 下的 MyBatis Mapper）和 `client`。数据访问统一使用 MyBatis / MyBatis-Plus，不在业务代码中新增 `JdbcTemplate` 调用。实现后验证正常响应和关键错误路径，并按真实能力更新能力声明。
