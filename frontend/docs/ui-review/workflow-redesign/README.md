# 工作流编辑器 UI 改造 · 2026-10-28

范围：原生 WorkflowEditor 的 Prompt-first 与 Structured 两条入口。工作流定义、演示执行器继续复用现有服务；未修改工作台。

## 实际画面的问题与处理

- 原先节点库和空检查器常驻，挤压画布。现在侧栏可收起，检查器选中后出现，并把选中节点移到可见区。
- 原先全图缩放使节点内容不可读。现在自由流程随可用画布适配，结构化流程默认按阶段显示；全流程概览仍可访问。阶段筛选不修改定义与连线。
- 原先节点只有摘要和技术端口。现在按实际类型显示需求、已有素材缩略图、制作规格、审片检查或阶段记录，不伪造视频结果。
- 检查器拆为设置、输入、输出；参数编辑不再要求先滚过空输入区。上游节点可以从输入页跳转。
- 编辑器专用样式集中到 `src/styles/workflow-editor.css`，使用应用主题变量；清除了此前追加的多轮编辑器覆盖。首页维持原有布局。

## 参考资料

只借鉴结构和交互，保留 FengMotion 的主题与业务语义：

- [Dify Workflow Studio](https://www.dify.ai/workflows)：节点单独调试、执行追踪。
- [n8n 工作流组件](https://github.com/n8n-io/n8n-docs/blob/main/docs/build/understand-workflows/workflow-components/README.md)：节点、连接和分组。
- [React Flow 示例](https://reactflow.dev/examples)：自定义节点、侧栏、连线校验、缩放和画布交互。

## 实测

- 1440×900 深色：两个入口、阶段切换、选中节点、检查器设置/输入/输出。
- 浅色与触感：结构化多节点阶段；发现并修正了 React Flow 背景层在浅色主题仍保持深色的问题。
- 900×720：画布随尺寸适配，保留局部面板滚动。
- 搜索无结果/中文节点名搜索；添加节点 → 撤销 → 重做。
- 独立开发预览中的默认演示流程运行，获得 4 项真实演示快照；没有生成视频。
- 编辑器改造的完整构建已通过；最终复查时并行开发中的 `Assets.tsx` 新增两个未使用变量，令 `npm run build` 的严格类型检查失败。随后 Vite 产物构建通过，关闭未使用变量检查的应用类型检查通过。仍有已有资源路径和 bundle 大小提示。
- `npm run lint` 退出码 0；全仓有既有告警。对 `WorkflowEditor.tsx` 单独运行 oxlint 无输出。
- 最终截图的深色两入口来自 `http://localhost:4173/` 的最新构建。主题截图来自同源代码的独立开发预览；未覆盖每个节点类型的三主题全排列。

## 截图

- `before-prompt.jpg` / `before-structured.jpg`：同视口改造前。
- `prompt-dark.jpg`：自由流程默认态。
- `prompt-inspector.jpg`：选中创作需求，显示设置面板。
- `structured-dark.jpg`：结构化流程第三阶段。
- `structured-light.jpg` / `structured-tactile.jpg`：同阶段的其他主题。
- `prompt-900.jpg`：窄窗口。

本轮为待用户审阅版本，不代表视觉设计已获确认。运行仍为本地演示适配器，真实 Agent 和渲染没有接入。
