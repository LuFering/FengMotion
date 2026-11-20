# 2026-11-20 后端体系核对基线

## 范围

依据当前本地工作区（源码版本 0.1.2），包含尚未提交的目录整理、轨道修复和按产物查询版本的优化。本次只做体系调查、文档整理及现有测试运行，没有改业务行为、安装新 JAR、重启桌面或调用真实模型。

入口：[体系地图](../../SYSTEM_MAP.md) · [开发指南](../../DEVELOPMENT.md) · [项目进度](../../../PROGRESS.md)

## 清点结果

| 对象 | 数量 | 口径 |
|---|---:|---|
| 一级包 | 18 | server 下目录，含 common/config |
| 生产 Java 文件 | 282 | 含 package-info，不含 target |
| REST Controller | 36 | 不含异常 advice |
| 方法级路由声明 | 113 | 静态去除注释后读取 Mapping 注解，不含 WebConfig 静态资源；不是运行时路由快照 |
| 表 | 25 | schema.sql、DatabaseMigration、LocalStateStore 建表语句去重 |
| Java 测试类 | 107 | src/test/java 下 *Test.java |

## 本轮实际运行

Java 21、Maven 3.9.11、离线依赖模式；从 backend 目录执行：

```bash
mvn -o -B -Dstyle.color=never \
  -Dfengmotion.data-dir=./target/backend-system-audit/data \
  -Dfengmotion.workspace-root=./target/backend-system-audit/projects \
  -Dfengmotion.retrieval.enabled=false \
  -Dfengmotion.retrieval.embedding.api-key= test
node --test src/test/*.test.mjs
```

结果：**Java 625 项，0 失败、0 错误、1 跳过；Node 7 项全部通过。**

跳过项为 `DshDirectTextModelTest.realProviderWhenExplicitlyEnabled`，需要显式 `FENGMOTION_LIVE_TEST=1` 才运行。本次没有触发真实 provider。Java 测试使用测试 profile 的 SQLite、素材与包目录，额外隔离默认 data/workspace 并关闭 embedding key。

| Java 模块 | 测试项数 | 跳过 |
|---|---:|---:|
| architecture | 2 | 0 |
| artifact | 11 | 0 |
| asset | 49 | 0 |
| chat | 106 | 0 |
| config | 8 | 0 |
| creation | 48 | 0 |
| fx | 51 | 0 |
| harness | 41 | 1 |
| preset | 22 | 0 |
| project | 114 | 0 |
| reference | 27 | 0 |
| render | 10 | 0 |
| retrieval | 13 | 0 |
| skill | 25 | 0 |
| system | 3 | 0 |
| task | 52 | 0 |
| upload | 10 | 0 |
| workflow | 33 | 0 |

原始结果在本机 `backend/target/surefire-reports/`，不会提交生成文件。前端 121 项测试、真实 Remotion 和 coffee 桌面操作属于前一轮记录，本次未重复执行，见项目进度对应日期与范围。

## 校正的体系理解

1. 存在三套不同执行机制：对话轮次、源码创作作业、场景任务；轨道恢复另外是同步请求。
2. `workflow` 管原文/纠正/工作稿，节点图主要在前端执行；后端持久化图/版本/运行文档并执行制作入口。
3. 并非全部存储走 MyBatis；项目场景版本、清除、创作任务、本地文档、语义相关功能仍有直接 JDBC。
4. 新库结构不只来自 schema.sql：project_idempotency 由迁移创建，local_documents 在 Store 初始化时创建。
5. 源码快照、视频、轨道和 SQLite 版本具有独立提交点，不存在统一跨资源事务。
6. 对话与任务 SSE 回放来源不同；创建请求持久化不代表引擎执行线程可以在重启后继续。
7. 部分旧注释、能力声明和配置名已与调用行为分离，详见体系地图的配置及缺口章节。

## 尚待专项验证

全量测试通过不表示以下边界已全面覆盖：源码执行期间项目清除、跨进程写同一工程、符号链接文件边界的一致性、恢复中强杀、长会话内存/并发上限、超大文档列表、任意源码元素编辑、干净机器和多平台部署。

本次文档保留这些差异作为后续任务入口，没有把它们写成已修复，也不凭静态源码直接声称用户数据已受影响。
