# FengMotion Desktop — 给 AI 的工作约定

> 这个项目的作者**没有前端经验，前端完全靠 AI 生成**。
> 因此这里的约束比一般项目严格：**减少自由度 = 提高生成成功率。**

---

## 动手前必读

1. **内容模型只看工作流，不看那条演示视频。**
   `public/media/token-full-legacy.mp4` 和由它派生的东西 ——
   `src/data/activeFilm.ts` 的 25 个成片片段、`src/data/productionData.ts` 的
   `UNITS` / `STORYBOARD`、`src/data/projectModel.ts` 的 152s 时间轴 ——
   **全部是占位演示数据，不是工作流的内容模型。**
   工作流没有「镜」这个单位，也没有「第几秒到第几秒是什么画面」这种映射；
   那是 HyperFrames 渲染的实现切片（`film/index.html` 的 `.clip`），
   属于「这条片这次怎么渲的」，不属于内容。
   **工作台 / 工作流界面该显示什么，一律以 `workflow-v5/` 目录、
   `src/data/workflowTemplates.ts`（节点与产物定义）、
   `src/services/workflowService.ts`（图与 Gate 求值）为准。**
   拿成片切片当内容搬进界面，是已经犯过的错。
2. **`src/index.css` 是约束文件，不是建议。** 颜色/字体/间距/圆角只能用它定义的。
3. **`src/views/Production.tsx` 是范式层**，其余是通用层。见下方「分层边界」。
4. **一次只做一个视图。** 做完让作者看截图，确认后再继续。不要一次生成多个页面。

---

## 分层边界（最重要）

「镜头」是**当前视频范式**的实现，不是产品地基。

```
通用层（永不变）       shell/ · Overview · Assets · 未来的 script/audio/render/knowledge
                      ↑ 不许出现「镜」「Shot」这类范式概念，用「单元 / Unit」
────────────────────────────────────────────────────────────
范式层（可替换）       views/Production.tsx
                      ↑ 当前是「镜头式」，将来可有时间线式/步骤式/场景式
```

**规则：**

- `shell/views.ts` 只声明"有哪些视图"，不声明"视图里有什么"
- 换范式时**只替换 `Production.tsx`**，导航结构不动
- 不要在通用层 import 范式层的类型

---

## 组件：用现成的，不自造 ⚠️

**上一版最大的错误是手写了 87 个 div 自造通用控件。** 现在全部换成 shadcn。

| 用途 | 用什么 | 不要 |
|---|---|---|
| 按钮 | `Button`（variant: default/outline/ghost/secondary/destructive） | 裸 `<button>` |
| 表格 | `Table` 系列 | 裸 `<table>` |
| 徽标 / 状态 | `Badge`（含自定义的 `warning` 变体） | 手写色块 |
| 卡片 | `Card` | 手写边框 div |
| 输入 | `Input` / `Textarea` | 裸 `<input>` |
| 单选（候选） | `RadioGroup` + `Card` | 手写按钮组 |
| 标签页 | `Tabs` / `ToggleGroup` | 手写按钮组 |
| 浮层 | `Sheet` / `Dialog` / `Popover` | 绝对定位 div |
| 滚动区 | `ScrollArea` | `overflow-y-auto` div |
| 侧栏 | `Sidebar` 系列原语 | 手写 aside |
| 提示 | `Alert` | 手写色块 |
| 进度 | `Progress` | 手写条 |

**加组件**：`npx shadcn@latest add <name>`

**产品专属结构**（候选对比、素材字段、监看器）用上面的原语**组合**，
但不要重造通用控件。

---

## 视觉约束

**表面靠灰阶递进，不靠边线和阴影：**

```
--void #0c0c0c → --bg #101010 → --inset #141414 → --panel #181818
→ --panel-alt #212121 → --hover #2c2c2c
```

**文字层级 —— 三级必须拉开，不要都用同一个字号：**

| class | 尺寸 | 用途 |
|---|---|---|
| `.t-title` | 15px/600 | 视图主标题（镜名等） |
| `.t-head` / `.section-head` | 12px/600 | 面板头、区块标题 |
| `.t-body` | 13px/400 | 正文 |
| `.t-meta` | 11px/400 | 元数据、时长、来源 |
| `.t-dim` | 10.5px/400 | 次要说明 |

> ⚠️ **曾经犯过的错**：面板头写成 11px/#808080，比正文 12.5px 还弱 ——
> 看起来所有东西都在同一层，标题反而不醒目。**标题必须比正文更醒目。**

**语义色 —— `brand` 是独立变量，不要复用 shadcn 的 `--accent`：**

| 变量 | 含义 | Tailwind |
|---|---|---|
| `--brand` 珊瑚橙 `#dc7036` | 主操作 / 选中 / 进行中 | `bg-brand` `text-brand` `bg-brand-soft` |
| `--gold` 琥珀 | **等待用户决定**（不是失败） | `bg-gold-soft text-gold` |
| `--success` 绿 | 完成 | `text-success` |
| `--danger` 红 | 失败 | `text-danger` |

> ⚠️ **曾经犯过的错**：shadcn 的 `--accent` 是「悬停底色」语义（灰），
> 而我一开始把品牌色也叫 `--accent` 并在 `:root` 里覆盖成灰色，
> 结果 `--primary`/`--ring`/`--color-brand` 全变成灰的 —— **整个强调色失效**。
> 现在品牌色是独立的 `--brand`，`--accent` 只做悬停底色。

**其他：**

- 字号：正文 13px，元数据 11px，次要 10.5px。**不要用 14px+**（会失去工具感）
- 数字/时间码/文件路径用 `.num`（等宽，11.5px）
- 面板头用 `.panel-head`（34px 高、12px/600）
- 状态**不能只靠颜色表达** —— 圆点旁必须有文字
- 不做渐变、不做大圆角、不做装饰性阴影、不做统计数字大卡

---

## 状态呈现

**唯一来源是 `src/shell/status.ts`。** 不要在组件里自己写状态色。

```ts
statusOf(s)      // → { label, dot, text, soft }
fmtDuration(sec) // → "3.9s" | "2:32.0"
```

状态语义：`done` 定稿 / `running` 进行中 / `waiting` 等你选 / `failed` 需处理 / `idle` 待做

---

## 响应式断点

用 Tailwind 默认断点。当前策略：

| 断点 | 行为 |
|---|---|
| `< lg` (1024) | 侧栏收成图标条（`w-14`）；制作工作区切换为「单元/监看」标签；资源台账收起详情侧栏；对话区改为覆盖式浮层 |
| `≥ lg` | 完整布局 |
| `≥ xl` (1280) | 侧栏展开为 `w-56` |

**窄窗不要硬挤三栏。**

---

## 交互约定

- **指认式表达**：候选并排时必须**同尺寸、同裁切、同缩放** —— 否则用户会误判成画面差异而非方案差异
- **等待用户决定**：用 `danger-soft` 底色 + 徽标，**只在任务从运行变成等待时提醒**，不要为每次工具调用弹通知
- **对话区**：可收起，不永久占据右侧
- **不做时间轴 / 拖拽 / canvas**（P2 之前）

---

## 技术栈

Vite 8 + React 19 + TS 6 + Tailwind v4 + **shadcn/ui（21 个组件）** + lucide-react

**尚未引入但计划中**：assistant-ui（对话线程）、ai-elements（活动流/卡点）、
TanStack Query（数据）、Remotion Player（监看器）

**注意**：ai-elements 的安装脚本假设 Next.js，Vite 下需手工接入。

---

## 命名与注释

- 注释写**为什么**，不写**是什么**
- 涉及评审结论的地方，注明来源（如 `评审 §7`），便于回溯
- 中文注释，与项目其余部分一致

---

## 验证

```bash
npx tsc -b          # 类型检查（必须过）
npm run build       # 构建（必须过）
npm run dev         # 起服务后**实际截图看**，不要只看代码
```

**改完界面必须看截图。** 作者无前端经验，无法从代码判断布局对不对。
