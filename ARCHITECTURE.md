# 后端架构与开发路线

本文描述当前骨架和后续代码应放在哪里；除了明确标为已实现的内容，其他均为待开发设计，不代表已有接口或存储。

## 运行边界

这是一个 Spring Boot 模块化单体，入口为 `FengMotionServerApplication`，API 基址暂用 `/api`，按迁移草案逐域评审契约。默认只监听 `127.0.0.1:8080`，面向本机开发；远程或多用户部署需要另行设计认证、授权和网络配置。

系统接口 `GET /api/health` 和 `GET /api/capabilities` 已实现。健康只表示进程能响应；能力声明反映真实探测结果 —— `agent` 一项读 DSH 探测（可用时 `available`），其余在对应模块接入前保持 `unavailable`。任务、版本和渲染接口尚未实现。

前端现在仍使用本地 Mock；HTTP 客户端存在不表示页面已经切换。真实任务的 DTO 与事件应以评审后的契约为准。

## 分层

每个领域按需建立子包：

- `api`：Controller、HTTP 输入输出映射，不直接读写数据库或调用外部进程。
- `domain`：领域对象、状态和约束；请求 DTO 和领域对象可按复杂度分开。
- `service`：用例、事务边界、状态转换；不把业务规则放进 Controller。
- `store`：持久化接口及实现；实现使用 MyBatis / MyBatis-Plus Mapper（`store/mapper` 子包）访问数据库。只有选定存储后再新增，不用空实现冒充持久化。
- `client`：外部 Agent、渲染器或文件服务的适配。

依赖方向：`api → service → domain / store / client`。领域之间通过服务或公开的接口协作，避免直接修改其他领域的内部表。

## 领域划分

| 包 | 职责 | 当前状态 |
|---|---|---|
| `system` | 健康、能力与后续设置 | 健康和能力声明已实现 |
| `common` / `config` | 错误处理、HTTP 与通用配置 | 部分错误信封、开发 CORS 已实现 |
| `project` | 项目身份、信息和版本归属 | 创建、列表、详情、条件更新、归档已实现；物理删除待任务状态接入 |
| `task` | 任务、状态机、事件、取消和重试 | 包占位 |
| `catalog` | 产物、变更、版本及来源 | 包占位 |
| `harness` | Agent 执行器适配和状态 | 已接入 DSH SDK（对话、流式、工具、用量、标题、模型目录） |
| `workspace` | 项目工作目录和文件边界 | 包占位 |
| `upload` | 上传及文件管理 | 附件上传已实现（`POST /api/uploads`） |
| `chat` | 对话会话、消息历史、发送幂等、回复流 | 会话 CRUD、消息历史与发送已实现；SSE 回复流待 Agent 接入（当前返回 503） |
| `asset` / `render` / `workflow` / `check` | 素材、渲染、工作流、检查 | 待业务开发时创建 |

## 建议实现顺序

1. **契约**：评审 `/api` 前缀、项目字段、分页和错误信封，解决 `docs/contracts/`、迁移草案与客户端之间的差异。先明确真实请求的完整目标；不支持的字段要拒绝，不能静默丢失。
2. **项目与存储**：根据部署形态选择数据库，添加驱动、迁移工具与测试；实现项目创建、列表和详情。完成标准：重启后数据仍可查询，前端页面实际调用新客户端。
3. **任务账本**：保存完整请求、项目归属、任务状态与事件；定义幂等、重启恢复、取消和 SSE 断线续传。
4. **文件与产物**：确定工作区边界、上传、下载、版本和产物来源，再做第一个受控真实执行闭环。
5. **扩展能力**：接入 Agent、渲染、工作流和检查后更新能力状态，并以真实依赖状态为依据。

SQLite 存储及旧库的兼容升级已接入；数据访问使用 MyBatis / MyBatis-Plus，事务边界由 `TransactionTemplate` 与 `@Transactional` 控制。启动期结构迁移（`config.DatabaseMigration`）仍使用 `JdbcTemplate` 执行 DDL / PRAGMA，不参与业务读写。对话消息采用只追加 + 会话内单调序号的设计，详见 `docs/会话消息持久化.md`。SSE 回复流已接入（`GET /api/chat-sessions/{id}/stream`），推送 token 级 `delta`、`usage`、`title` 与终态 `completed`。认证、队列与 worker 尚未接入。业务异常与数据库异常使用嵌套错误格式；MyBatis-Spring 会把 MyBatis 异常转换为 Spring `DataAccessException`，由同一个异常处理器返回 `internal_error`，不向调用方暴露 SQL 细节。其他错误类型仍需逐步对齐契约。

## 每实现一个业务接口

先核对 `../FengMotion-desktop/src/services/api/` 对应客户端和 `../FengMotion-desktop/docs/contracts/`，把仍有分歧的内容写入协议并对齐类型；再实现 API、用例和存储；最后验证成功、参数错误、资源不存在以及与前端的真实请求。更新能力声明时只暴露实际已可用的能力。完整的阶段退出条件见 `../FengMotion-前后端迁移与视频生成方案/03-Spring后端开发指南.md`。
