# FengMotion 后端

基于 Java 21、Spring Boot 和 SQLite，为桌面端提供项目、对话、资源管理、AI 创作与视频渲染服务。项目整体介绍见[仓库首页](../README.md)。

## 后端开发入口

| 需要了解什么 | 从这里开始 |
|---|---|
| 完整运行体系、执行链路、接口、数据与已知缺口 | [SYSTEM_MAP.md](SYSTEM_MAP.md) |
| 新功能、优化、修复、文档和测试应该怎么开展 | [DEVELOPMENT.md](DEVELOPMENT.md) |
| 包职责、目录约定和模块依赖 | [ARCHITECTURE.md](ARCHITECTURE.md) |
| 本轮源码盘点和实际测试结果 | [2026-11-20 体系基线](docs/audits/2026-11-20-system-baseline.md) |
| 跨前后端进度、桌面部署和后续优先级 | [PROGRESS.md](../PROGRESS.md) |

## 启动与检查

需要 Java 21、Maven，以及渲染所需的 Node.js。先在 `../frontend/` 执行 `npm install` 安装前端与渲染依赖，然后在本目录运行：

```bash
export FENGMOTION_REMOTION_DIR="$PWD/remotion"
export FENGMOTION_NODE_MODULES="$(cd ../frontend && pwd)/node_modules"
export FENGMOTION_WORKFLOW_DIR="$(cd ../frontend && pwd)/workflow-v0.1.1"
mvn spring-boot:run
```

后端默认监听本机 `127.0.0.1:8080`：

```bash
curl http://127.0.0.1:8080/api/health
mvn test
```

健康检查只说明服务已启动。对话和创作还需要安装并配置 DSH 与可用模型；默认配置中有开发机的示例路径和模型名，使用其他环境时需调整。可选语义检索依赖对应的向量服务配置；没有配置或服务不可用时不能视为已经完成有效检索。

默认项目文件位于 `~/FengMotion/projects/`，数据库与上传文件位于 `~/.config/FengMotion/data/`。相关设置见 `src/main/resources/application.yml`。请勿将密钥或个人配置提交到仓库。

## 目录

| 目录 | 内容 |
| --- | --- |
| `src/main/java/` | 按项目、工作流上下文、创作、渲染、产物、对话等职责组织；详见 [架构地图](ARCHITECTURE.md) |
| `src/main/resources/` | 默认配置与数据库结构 |
| `src/test/` | 服务端测试 |
| `remotion/` | 视频渲染工程和脚本 |
| `dsh-plugin/` | DSH 对话流桥接插件 |
| `docs/` | [专题说明与历史记录索引](docs/README.md) |

持久化接口与 SQLite 实现同放各模块的 `store/`，数据库 Mapper 在 `store/mapper/`。创作执行在 `creation/`，原始需求与工作稿在 `workflow/`；对外 API 路径保持不变。

`target/` 与 `remotion/` 中的 `.cache/`、`.remotion/` 都是已忽略的本机生成数据，不是可复用业务代码。不要将数据库、缓存或 `_wip/` 草稿当成源码迁移。

## 当前边界

当前已有 AI 修改 Remotion 工程并渲染的路径。参考视频自动分析、完整视觉审片及渲染失败后的自动修复仍需完善；工作流图的部分节点只是界面快照。资源进入上下文不代表模型一定使用了资源，需结合项目记录与实际视频验证。

当前代码归属见 [ARCHITECTURE.md](ARCHITECTURE.md)。旧阶段的能力说明与验收记录见 [文档索引](docs/README.md)，不要将历史报告视为本次测试结果。

跨模块里程碑与最新验证范围见 [项目进度](../PROGRESS.md)。下一步重点是可编辑工程的元素绑定、轨道恢复后台化和产物生命周期；继续拆目录不是独立的完成标准。
