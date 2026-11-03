# FengMotion

AI 驱动的视频创作工具。前后端同仓：

```
FengMotion/
├── desktop/   桌面端（React 19 + Vite + Electron）
└── backend/   Spring Boot 后端（Java 21 + SQLite）
```

## 两个子项目

| 目录 | 说明 | 入口 |
|---|---|---|
| `desktop/` | 界面、场景编辑器、Electron 壳 | `desktop/README.md` |
| `backend/` | 项目/会话/任务、DSH 接入、Remotion 渲染 | `backend/README.md` |

## 各自怎么跑

**后端**

```bash
cd backend
mvn spring-boot:run          # 默认 127.0.0.1:8080
```

**桌面端**

```bash
cd desktop
npm install
npm run dev                  # 开发服务 http://localhost:5173
```

两边数据默认共用 `~/.config/FengMotion/data/`，单独跑后端也用同一份，
不会出现「开发态能看到项目、应用里报不存在」。

## 打包桌面应用

```bash
cd desktop
npm run desktop:dist         # 产出 AppImage，自带 JRE 与后端 jar
```

详见 `desktop/docs/dev/桌面打包与更新.md`。

## 关于历史

`desktop/` 由原仓库根目录整体迁移而来，`backend/` 用 subtree merge 合入，
两边的提交历史都保留在仓库里。

**前端的历史路径不追溯改名** —— `git log -- desktop/src/...` 只能追到迁移之后。
这是为了避免重写两百多个提交的高风险，代价是路径追溯断档。
要查迁移前的历史，用迁移提交之前的提交查询。

## 不入库的东西

`backend/remotion/` 下的 `.remotion/`（chrome-headless-shell，约 210MB）
与 `.cache/`（webpack 构建缓存）是渲染时的下载与构建产物，
已列入 `.gitignore`，首次渲染会自动重新生成。
