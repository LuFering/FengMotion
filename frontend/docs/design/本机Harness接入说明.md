# 本机 Harness 接入与验证

更新：2026-11-17。范围为引擎探测、模型目录、普通对话与创作入口路由，不涉及工作流页面重构。

## 使用方式

设置 → AI 与模型 → 自动载入检测到的引擎 → 选择模型。安装或修改本机模型配置后，点击「重新检测本机引擎与模型」。模型列表最多显示四项，内部可滚动。

已适配 DeepSeek Harness、Codex 和 Claude Code。后端从 PATH、常用用户安装目录，以及可配置的 `fengmotion.harness.codex-bin` / `claude-bin` 寻找程序。Codex 兼容应用内置 CLI 和常见 ACP 包装安装。这里只发现已适配的协议，不承诺任意同名第三方 CLI 都可执行。

- Codex 通过 app-server 的 initialize、model/list 读取目录，支持分页。
- Claude Code 通过 stream-json 初始化握手读取 models，保留本机模型别名与真实显示名。
- 模型和推理档位由目录提供；不把产品展示里的旧模型名当可用目录。
- 探测有缓存、超时和子进程清理；重新检测可主动失效缓存。
- 「本机引擎已载入」表示程序能启动且模型目录已读取，不代表登录、代理、模型服务连接已经验证成功。使用本机引擎已有认证配置，不向前端返回凭据。

## 执行

首页、对话和工作台共用选中的引擎与模型。普通对话 stream query 和创作 create body 均携带 harness/model/reasoningEffort。创作重试身份包含引擎选择，不能用换引擎后的请求复用旧任务。

Codex 和 Claude 每轮启动独立进程；普通对话通过服务端完整分页历史重建上下文，未声明原生 session/resume 能力。切回 DeepSeek 时重新导入服务端历史，避免继续使用切换之前的旧上下文。普通对话停止会终止本轮进程及子进程。权限批准尚未接入独立 UI，保留工作区沙箱/引擎已有权限，遇到需要交互批准的操作按拒绝处理。创作任务沿用既有工程任务取消边界。

## 本轮证据

- 后端定向测试 15/15 通过：本地目录读取、Codex 分页、未知模型拒绝、模型和图片传递、Claude 别名与档位映射、原有 DSH 选择与版本保护。
- 前端类型检查与生产构建通过。
- 隔离后端、独立数据库：Codex 用本机模型真实返回「接通」，SSE completed 返回真实消息，历史查询有对应助手回复。
- 隔离创作请求：指定 Codex 后真实返回 awaiting_info，源码未变，没有伪造渲染结果。
- Claude 初始化返回本机五项模型。实际模型请求出现 Connection error，原因是本机配置的 `http://127.0.0.1:8788/v1` 不可达。未修改用户配置，未宣称 Claude 已生成成功回复。
- Claude 真实运行中停止：后端 stopped=true，SSE 顺序包含 status / diagnostic / stopped / end。
- 浏览器设置中看到三种引擎，实际选择 Claude 模型后卡片切为默认并显示本机模型名，测试后恢复 DeepSeek 默认；Codex 模型菜单 clientHeight=123，scrollHeight=340，鼠标滚动后 scrollTop 大于 0。

- 最终服务已在 8080 启动，返回三种引擎；Codex 目录读取 11 项（含本机自定义项），Claude 读取 5 项。测试数据库、临时项目与测试进程已清理。

后端扩大回归：特效模块以外 428 项，失败 0，错误 0，跳过 1。完整套件另有特效库既有测试与当前目录/表结构不符的问题（空目录、缺少 fx_semantic_suggestions），本轮未修改该模块。

## 仍需验证

- Claude 模型服务恢复后的真实成功回复和真实视频生成。
- Codex 实际改源码并完整渲染出片；本轮创作测试只覆盖 awaiting_info。
- 引擎切换的多轮上下文、图片与大型历史的端到端效果。
- macOS / Windows 安装路径与权限策略；当前仅在 Linux 验证。
- 完整 UI 权限审批、原生会话续接和通用第三方 Harness 插件注册。

协议参考：[Codex App Server](https://developers.openai.com/codex/app-server/)、[Claude Code programmatic usage](https://code.claude.com/docs/en/headless)。以本机安装版本实际握手为准。
