# FengMotion Desktop

AI 视频创作工作台。**桌面优先**。

> 状态：**可运行的前端 + 明确的演示适配器**。
> Agent 后端尚未接入 —— 所有任务状态都标注为演示，不会伪装成真实的 AI 执行。

---

## 开发

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # 产物在 dist/，base: './' 便于 Electron 以 file:// 加载
npx tsc -b         # 类型检查
```

---

## 两级结构

```
首页（home）  ← 强调色：薰衣草紫
│  左栏 216px：品牌 / 开始制作 / 导航 / 底部「上次打开」
│  主区：欢迎 → 创作输入 → 常用工具磁贴 → 最近项目 → 当前镜头
│
└─→ 工作台（studio）  ← 强调色：薄荷绿
   顶栏带「← 返回首页」
   ├─ 项目管理 250px（按幕分组的镜头列表）
   ├─ 中央：镜头标题 → Remotion Player → 播放条 → 时间线
   └─ 右侧 390px：AI 对话 / 修改设置
```

**点首页的任一项目卡片或镜头 → 进工作台。** 工作台左上角返回首页。

---

## 设计系统

**直接取自 paba.tv 的真实样式表**（已抓到源码，非猜测）。

### 两套 token

**① 基础层** —— 工作台这类「工具面板」界面

| 变量 | 用途 |
|---|---|
| `--bg` | 页面底 |
| `--surf` | 面板 / 卡片 |
| `--hole` | **凹陷**：图标底板、封面占位、输入槽 |
| `--soft` | 悬停 / 选中底 |
| `--line` | 边线 |

**② 纸层 `--ht-*`** —— 首页。它不是「面板 + 边框」，而是**纸 + 墨 + 凸起/压下**：

| 变量 | 值 | 用途 |
|---|---|---|
| `--ht-paper` | `#32333a` | 纸面 |
| `--ht-paper-back` | `#2b2c32` | 纸背（更深） |
| `--ht-edge` | `#494a53` | 纸边（比普通 line 亮） |
| `--ht-ink` | `#8c7799` | **墨色 = 紫**（首页的「笔」） |
| `--ht-raised` | `0 2px 8px #0000001c, inset 0 1px 0 #ffffff0b` | 纸浮起（双层阴影） |
| `--ht-pressed` | `inset 0 2px 4px #00000033, 0 1px 0 #ffffff09` | 按下去 |

> ⚠️ **这是第一版抄漏的核心。** 卡片必须有 `box-shadow` 层次，
> 只有边框的卡片是平的。按钮是**胶囊**（`--r-pill: 999px`），
> 主按钮的字是**深色**（`--on-accent: #102e21`），不是白字。

### 强调色跟上下文走

| 上下文 | 颜色 |
|---|---|
| 首页 `data-context="home"` | `#dcbceb` 薰衣草紫 |
| 工作台 `data-context="studio"` | `#68d5a9` 薄荷绿 |

> ⚠️ **不要写自引用**：`[data-context="studio"] { --acc: var(--acc) }` 会让 CSS
> 判定为循环、变量直接失效。工作台只声明与 `:root` 的差异。

### 关键组件类

| class | 用途 | 要点 |
|---|---|---|
| `.paper` | 首页卡片 | `--ht-edge` 边 + `--ht-raised` 阴影 |
| `.paper-sheet` | 创作输入纸片 | 24px 圆角 + 大阴影，`:focus-within` 变墨色边 |
| `.pill` / `.pill-primary` | 胶囊按钮 | 999px 圆角；主按钮 hover `translateY(-1px)` |
| `.icon-plate` | 工具图标底板 | 36px 凹陷 |
| `.cover` | 项目封面占位 | 16:9 + `--hole` 底 |
| `.section-heading` | 区块标题 | 17px/600，`margin: 30px 0 16px` |
| `.chip` | 分类筛选 | 32px 高，选中用 `--hole` 底 |
| `.nav-item` | 侧栏导航 | 38px 高，选中用 `--soft` 底 + 强调色字 |

### 字号（paba 刻度）

`28/27px` 品牌与英雄 → `20px` 标题 → `17px` 区块 → `13px` 控件 → **`12px` 正文** → `11px` 标签 → `10px` 极小

### 圆角

`6px` 控件 / `8px` 卡片 / `999px` 胶囊 / `24px` 纸片

### 语义色

| 变量 | 含义 |
|---|---|
| `--acc` | 主操作 / 选中 / 进行中（跟随上下文） |
| `--warn` 琥珀 | **等待用户决定**（不是失败） |
| `--good` 绿 | 完成 |
| `--bad` 红 | 失败 |

状态不能只靠颜色表达 —— 必须有文字。

---

## 数据来源（全部来自真实项目）

| 文件 | 内容 |
|---|---|
| `src/data/activeFilm.ts` | 从 `film/index.html` 解析的 **25 个启用镜头**（起止/track/标题） |
| `src/data/productionData.ts` | PROGRESS.md 的 30 个合成 + V3 分镜表 73 段 |
| `src/data/timeline.ts` | 合并视图 + 帧数换算 |
| `public/frames/film/sNN.jpg` | 从 `token-full.mp4` 按各镜中点抽的真实帧 |
| `public/media/token-full-legacy.mp4` | 项目里实际存在的 152 秒成片 |

### ⚠️ 两套时间结构，界面必须区分

| | 时长 | 状态 |
|---|---|---|
| **当前可播成片** | 152 秒 | `film/index.html` 混合装配，含 V3 素材段 16–19 |
| **V3 目标分镜** | 273.6 秒 | `完整分镜表-V3.md`，**尚未重剪为成片** |

**不把 V3 的 72 段叠加到 152 秒的播放时间线上** —— 那会造成假的对应关系。

---

## 架构

```
src/
├── services/
│   ├── studioApi.ts       ⭐ 唯一接口层 + MockStudioApi（演示适配器）
│   └── studioAdapter.ts   能力声明 + 只读版本来源
├── hooks/useAgentTasks.ts 任务状态机
├── remotion/
│   ├── FilmPlayer.tsx     Remotion Player 包装（真实 MP4 播放 + 帧定位）
│   └── FilmPlayback.tsx   Player 内部的合成组件
├── views/
│   ├── Home.tsx           ⭐ 首页（项目入口）
│   ├── Workbench.tsx      ⭐ 工作台（主界面）
│   ├── StoryTimeline.tsx  时间线（可缩放、可拖动播放头）
│   ├── Overview.tsx       总览
│   ├── Assets.tsx         资源台账
│   └── Placeholder.tsx    未实现视图
└── shell/
    ├── ContextPanel.tsx   非工作台视图的左栏
    ├── views.ts           视图注册表
    ├── status.ts          状态呈现唯一来源
    └── useChat.ts         对话状态
```

### 接入真实 Agent

**只改 `studioApi.ts` 一个文件。**

```ts
startTask(request, onEvent): TaskRun
cancelTask(taskId): void
listVersions(): ProjectVersion[]
listChanges(taskId): ChangeSet | null
render(onEvent): TaskRun
restoreVersion(versionId): Promise<{restored, message}>
```

换成 HTTP/SSE 实现即可，UI 一行不用改。

---

## 「演示模式」的诚实约定

`MockStudioApi` 推进可见 UI 状态，但：

- ❌ 不调用 AI
- ❌ 不修改任何项目文件
- ❌ 不生成新预览
- ❌ 不创建导出

界面上三处标注：首页徽标、工作台顶栏徽标、底部任务面板。任务事件只描述**可观察的操作**，**不伪造 AI 思维过程**。

版本记录两条都是**只读项目来源**，按钮禁用。

---

## ⚠️ Remotion 的真实关系

**当前可播成片是 HyperFrames（HTML + GSAP）渲染的 MP4，不是 Remotion 合成。**

- `film/compositions/s01-s30.html` —— 真正的可编辑源
- `rm/` 里的 Remotion 工程只有两个无关 demo，**不是这部片子**

Remotion Player 在这里的作用是：**给 MP4 提供确定性播放和帧级定位**。
将来若要用 Remotion 承载真实合成，需要先把 HTML/GSAP 镜头移植成 Remotion 组件 —— 那是独立工作，界面里不假装已经做到。

---

## 硬约束

1. **组件用现成的** —— 通用交互一律 shadcn（`@/components/ui/*`）。
   加组件：`npx shadcn@latest add <name>`
2. **表面用三个词**（bg / surf / hole），不要堆灰阶。
3. **强调色跟上下文走**，改 `data-context` 即可。
4. **Remotion Player 不要套 `aspect-ratio`** —— Player 自己会按比例缩放，
   外层再套会在高度受限时压坏画面比例。
5. **不要在 Player 外面调 `useCurrentFrame`** —— 时间线在 Player 外部，
   播放头位置通过 prop 传入。

---

## 文档

- [ARCHITECTURE.md](ARCHITECTURE.md) — 代码地图：目录职责、边界与核心链路
- [CONTRIBUTING.md](CONTRIBUTING.md) — 参与开发：分工、命令、提交与 PR 要点
- [开发文档（docs/dev/）](docs/dev/README.md) — 开发规范、开发进度、更新日志、前后端协议、决策记录
- [设计规格（docs/design/）](docs/design/README.md) — 设计系统与各模块规格

---

## 待接

- [ ] `studioApi` 换成真实 HTTP/SSE 实现
- [ ] 素材上传（按钮已禁用并标注）
- [ ] 新建 / 导入项目（按钮已禁用并标注）
- [ ] Electron 打包
- [ ] 其余视图：脚本与口播 / 音频与时间 / 渲染与交付 / 知识与方法
