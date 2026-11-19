# WebSearchTrace · 联网搜索轨迹

对话里「Agent 去网上查了什么」的树形展示。每次查询是一行，查到结果表明会从那一行分出一支。

```
🔍 跑了 3 次搜索
├ 💡 搜索团队在组件库中实际支付的费用        5 个结果
│  └ 来源  ⬤⬤⬤⬤⬤ ⌄
├ ✕ 搜索 X 为 component library OR …        7 帖子
├ 🔴 在 Reddit 上搜索 r/reactjs worth …     12 线程
└ 💡 阅读最强三线程
```

## 文件

| 文件 | 作用 |
|---|---|
| `src/features/chat/components/WebSearchTrace.tsx` | 组件 + 真实事件 → 步骤的转换 |
| `src/features/chat/styles/web-search-trace.css` | 样式、树形导轨、生长动效 |
| `public/replica/web-search-run.html` | 独立演示页，可点「运行」看生长过程 |

演示页直接用组件样式（构建时注入），改 CSS 后重新生成即可，不要手抄。

## 接入

```tsx
import { WebSearchTrace, isSearchTool, type SearchCall, type SearchSource } from '@/components/WebSearchTrace'

// calls 就是现有的工具调用记录，不需要转换
<WebSearchTrace calls={toolCalls} live />
```

参数：

- `calls` — 工具调用记录（`{ callId?, name, arguments?, done?, isError? }[]`），内部按 `isSearchTool` 过滤
- `live` — 是否来自进行中的流。历史记录传 `false`，否则会一直显示「执行中」
- `sources` — 可选，`Record<callId, SearchSource[]>`。**目前通常为空**：后端还没有把搜索结果正文带上来，没有就不显示来源，不编数据
- `revealed` — 可选，已揭示行数。不传则按 320ms / 900ms 的节奏自己揭示

`isSearchTool(name)` 单独导出，用于把搜索从通用工具日志里摘出来 —— 两者回答的不是同一件事，混在一起会都看不清。

## 几何：一棵树，不是一列行

数值都取自 BoardUI 的实现，改之前先看懂这几个：

| 量 | 值 | 说明 |
|---|---|---|
| 子枝缩进 | 7px | 子枝的行相对父行内容右移 |
| 行内缩进 | 14px | 每行自己的 padding，钩子占 0–12，正文从 14 起 |
| 钩子竖段 | 8px | 路径 `M0.5 0 V8 Q0.5 14 6.5 14 H11.5` 的 `V8` |
| 钩子 svg 高度 | 15px | viewBox 高度 |
| 子枝桥接 | `top:-5px, height:6px` | 补「步骤行底部 → 子行顶部」那一小段 |

### 三条不能破坏的规则

**1. 纵向连续性只由 `.wst-trunk` 负责。**
它是 `top:0 / bottom:0` 的一条直线，贯穿整行。钩子只画「弯出去」那一段，不参与纵向。
曾经把纵向拆成「子层连接段 + 钩子竖段 + 竖干」三段拼，亚像素取整就露缝，每加一层嵌套多一处缝。

**2. 末行竖线止于钩子竖段终点（`--wst-hook-v: 8px`），不是钩子高度。**
钩子在 y=8 就开始弯了，竖线画到 14/15 就会在弯钩下方露出小尾巴。

**3. 有子枝的行，即使它是当前最后一行，也要继续画竖干。**
判据是「既是最后一行、又没有子枝」才算末行。否则子枝下面会断一截。
子枝行（来源）的标记挂在 `li` 上，选择器要同时认 `.wst-row[data-last]` 和 `.wst-rail[data-last]`。

## 生长动效

三段错开，线始终领先内容：

| 时间 | 动作 |
|---|---|
| 0ms | 竖线 `scaleY 0→1`，120ms 长完 |
| 90ms | 钩子 `stroke-dashoffset 26→0` 描出来，150ms 画完 |
| 200ms | 内容浮起 4px + 去模糊 + 淡入，280ms 落定 |

行高用 `grid-template-rows: 0fr → 1fr` 长出来（`auto` 不可动画）。
生长时内容被裁，所以 `.wst-body` 带一层 `mask-image` 底边渐隐（`--wst-fade` 22px → 0，需 `@property` 注册才能动画）。

`prefers-reduced-motion` 时全部静止，但保留最终状态。

## 已知边界

- **来源要有真实数据才显示**。搜索结果正文目前没有传到前端，所以实际使用中多半只有查询行。接入前不要为了「效果」编造域名。
- **查询词从工具参数里解析**（`query` / `q` / `search` / `term` / `queries`）。参数被截断时退回原文，可能显示半截 JSON —— 这比假装「搜索了」诚实。
- 来源行展开时是逐条落下，没有做原组件的「标记从堆叠位置飞进列表」那段布局动画（需要布局动画库，没有为此引入依赖）。
