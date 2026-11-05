# 参与贡献

欢迎帮助完善 FengMotion：反馈问题、分享创作案例、改进界面、补充测试或修正文档。开始前可以先查看[开发路线图](ROADMAP.md)与已有 [Issues](https://github.com/LuFering/FengMotion/issues)。

## 提交问题与建议

- 使用问题请写清版本、系统、操作步骤、期望与实际结果；有帮助的截图、日志或视频片段可以一并附上。
- 创作效果问题尽量说明输入、模型、使用的参考与资源，以及具体画面或时间位置；分享前请移除密钥和私人素材。
- 功能建议先说明遇到的问题和使用场景。较大的功能或接口调整，建议先开 Issue 讨论范围。

## 准备开发环境

环境要求和启动方法见[项目 README](README.md#本地开发)。桌面端使用 Node.js 和 npm，后端使用 Java 21、Maven；真实 AI 创作还需配置 DSH 与模型。

建议从最新 `main` 创建独立分支，一个分支处理一个明确主题：

```bash
git switch main
git pull --ff-only
git switch -c fix/your-topic
```

常用检查：

```bash
# 桌面端
cd desktop
npm install
npm run build
npm run lint
node --test tests/*.test.mjs

# 后端：在另一个终端，或先返回仓库根目录
cd backend
mvn test
```

桌面端命令在 `desktop/` 执行，后端命令在 `backend/` 执行。自动化检查不替代真实模型、渲染、安装和界面使用测试。

## 提交 Pull Request

- 说明问题、改动、影响范围和验证结果；未执行的检查请写明原因。
- 界面改动请附实际截图或录屏，并说明检查过的窗口尺寸和状态。
- 接口、配置、项目文件或用户可见行为变化，要同步更新相应文档。
- 保持真实能力与演示状态的区别；不要把引用送达、构建通过或计划中的能力当作完整验收。
- 请勿提交 API 密钥、个人模型配置、用户项目、未经授权的素材或生成缓存。

提交可使用简明的 Conventional Commits，例如 `fix(workbench): 修复预览状态`。更详细的桌面端设计约定和协作说明见[桌面端贡献指南](desktop/CONTRIBUTING.md)与[设计原则](desktop/docs/design/前端设计原则与已确认界面.md)。
