<div align="center">

<img src="frontend/public/assets/brand/fengmotion-mark.png" alt="FengMotion 标志" width="96" />

# FengMotion

**把想法说出来，让 AI 和你一起把它做成视频。**

一款正在开发中的 AI 视频创作桌面应用。用自然语言描述画面，借助 Remotion 编写和渲染视频，再通过对话继续修改。

[项目主页](https://lufering.github.io/FengMotion/) · [下载试用](#下载试用) · [开发路线图](ROADMAP.md) · [版本记录](CHANGELOG.md) · [参与贡献](CONTRIBUTING.md)

</div>

---

## 从想法到画面

你可以先写下一句话，也可以带上素材、参考片或想尝试的技法。FengMotion 会将需求交给 AI，生成或修改视频工程，并渲染预览。看到结果后，你可以继续用自然语言提出修改意见，逐步接近想要的画面。

它既可以制作文字、图形和动画，也可以结合素材创作；不要求每个项目都有实拍素材或先写好分镜。

## 能做什么

- **自然语言创作**：描述想法，由 AI 修改 Remotion 工程并渲染视频。
- **在工作台继续修改**：查看预览、描述修改意见，使用版本记录回看已有结果。
- **管理创作资源**：整理素材、参考片与特效技法，在创作时选择和引用。
- **使用创作工作流**：通过 Prompt-first 路径保存需求并启动创作；工作流编辑器还在完善中。
- **保留项目文件**：项目需求、代码和渲染结果保存在本机，便于继续创作。

## 当前进展

项目版本为 **0.1.0**，仍处于早期开发和测试阶段。自然语言创作、资源引用和渲染已有真实实现，但新近整合的功能仍需更多端到端测试。生成质量取决于模型、资源、需求和运行环境。

工作流中的部分节点目前仅展示界面快照；自动分析参考视频、完整的自动审片与返工尚未完成。当前提供 Linux x86_64 试用包，其他平台尚未完成适配。

## 下载试用

从 [GitHub Releases](https://github.com/LuFering/FengMotion/releases) 下载 `FengMotion-0.1.0-x86_64.AppImage`。赋予执行权限后运行：

```bash
chmod +x FengMotion-0.1.0-x86_64.AppImage
./FengMotion-0.1.0-x86_64.AppImage
```

应用包含后端和 Java 运行时；AI 创作仍需要本机安装并配置 DSH、可用模型及 Node.js。不同 Linux 环境的兼容性尚需验证。

## 本地开发

### 准备环境

- Node.js 与 npm；前端构建依赖 Vite 8，请使用 Node.js 20.19+ 或 22.12+。
- Java 21 和 Maven，用于运行后端。
- 已安装并配置可用模型的 [DeepSeek Harness（DSH）](https://github.com/deepseek-ai/DeepSeek-Harness)：AI 对话和创作需要它。模型与路径请按自己的环境配置，不能直接依赖仓库里的本机示例。
- 首次渲染可能需要下载 Remotion 使用的浏览器；部分素材处理功能需要 FFmpeg。

### 启动后端

```bash
git clone https://github.com/LuFering/FengMotion.git
cd FengMotion/backend
mvn spring-boot:run
```

后端默认监听 `http://127.0.0.1:8080`。在另一个终端确认服务：

```bash
curl http://127.0.0.1:8080/api/health
```

### 启动前端

```bash
cd FengMotion/frontend
npm install
npm run dev
```

打开终端显示的本地地址，默认是 `http://localhost:5173`。页面能够打开不代表 AI 已经配置完成；开始创作前，请确认 DSH、模型和渲染环境可用。

Linux 桌面应用的构建方式见 [桌面打包与更新](frontend/docs/dev/桌面打包与更新.md)。打包和安装仍需按目标机器验证。

## 项目结构

```text
FengMotion/
├── backend/                 后端、数据库、DSH 接入与渲染服务
│   ├── src/                 服务端代码与测试
│   ├── remotion/            渲染工程与脚本
│   ├── dsh-plugin/          对话流桥接插件
│   └── docs/                后端设计与实现记录
├── frontend/                前端应用与创作方法
│   ├── src/                 界面、工作台、资源库与服务接口
│   ├── workflow-v0.1.0/     当前创作方法、模板和工具
│   └── docs/                设计、接口和开发文档
├── harness/                 Harness 独立开发预留目录
├── desktop/                 桌面壳与多平台部署配置
│   ├── electron/            Electron 进程与系统集成
│   └── scripts/             桌面构建、打包与安装脚本
└── docs/                    项目展示网站（GitHub Pages）
```

默认情况下，项目文件位于 `~/FengMotion/projects/`，应用数据库和附件位于 `~/.config/FengMotion/data/`。不同环境可通过配置调整。

- [前端开发说明](frontend/README.md) · [桌面打包说明](desktop/README.md)
- [后端开发说明](backend/README.md)
- [实现状态与已知限制](backend/docs/当前实现状态.md)
- [开发路线图](ROADMAP.md) · [版本记录](CHANGELOG.md) · [参与贡献](CONTRIBUTING.md)

## 参与与反馈

欢迎通过 [Issues](https://github.com/LuFering/FengMotion/issues) 分享使用问题、创作想法或改进建议。项目仍在快速变化，提交问题时附上操作步骤、运行环境和错误信息会很有帮助。
