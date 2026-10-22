# 参与开发

欢迎参与 FengMotion。完整的流程、分支、提交与审核规范见 [开发规范](docs/dev/开发规范.md)，本页只放必读要点。

## 开始前

- 先读 [ARCHITECTURE.md](ARCHITECTURE.md) 了解目录职责与边界，再动代码。
- 一个 PR 只解决一个明确问题，不混入无关重构与格式化。
- 较大的功能、接口或架构变化，先在 Issue 或与维护者对齐范围，并按 [决策记录](docs/dev/决策记录/README.md) 留痕。

## 分工（当前）

- 维护者（LuFering）：后端与 Agent 集成、方向裁决、验收与合并。
- 协作者（muse-lufering）：前端设计、开发文档、测试与前端代码审核。
- 本地 AI：按规格执行实现（含前端实现），提交走 PR 并接受审核。

详见决策记录《2026-10-22 协作分工与文档体系》。

## 常用命令

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # tsc -b && vite build
npm run lint       # oxlint
npx tsc -b         # 类型检查
```

## 提交与 PR

- 分支：`feat/<范围>-<主题>`、`fix/...`、`docs/...`，从 main 切出，不直推 main。
- 提交信息：中文 Conventional Commits，如 `feat(workbench): 增加 Gate 确认卡`。
- PR 按仓库模板填写：改动说明、自测结果、**未验证范围**。未执行的检查如实写「未执行」，不要写成通过——验证状态词的定义见开发规范。
