# AgentProgress · Agent 任务进度

Agent 正在做的事，一条步骤清单：总进度环、逐行推进、可收起成一行。

```
◐ 还剩 2 步                        ▭
✓ 读取项目文件
✓ 更新并安装浅色模式 token
✓ 实现深色模式 token
◐ 添加可复用的主题切换控件          ← 高亮框包住这一行
○ 运行 registry、lint 与生产构建
```

## 文件

| 文件 | 作用 |
|---|---|
| `src/components/AgentProgress.tsx` | 组件 |
| `src/styles/agent-progress.css` | 样式 |
| `src/demo/agent-progress-demo.tsx` | 演示页源码（三种状态并排） |
| `vite.demo.config.ts` | 演示页的独立构建配置 |
| `scripts/sync-demo.mjs` | 把产物同步到 `public/replica/` 并改相对路径 |
| `public/replica/agent-progress/` | 构建产物，应用内可直接打开 |

改完源码后跑 `npm run build:demo`，会重建并同步。

演示地址：`fengmotion://app/replica/agent-progress/agent-progress-demo.html`

## 接入

```tsx
import { AgentProgress } from '@/components/AgentProgress'

<AgentProgress
  steps={["读取项目文件", "实现深色模式 token", "运行构建"]}
  stepDuration={3000}       // 每步毫秒数
  paused={busy === false}   // 挂起时停止推进
  onFinished={() => setDone(true)}
/>
```

参数：

- `steps` — 步骤文案；不传用默认演示步骤
- `stepDuration` — 每步耗时，默认 3000ms
- `completionDelay` — 全部完成后再过多久回调 `onFinished`，默认 1000ms
- `onFinished` — 全部完成时调用
- `paused` — 停止推进（任务挂起、等待用户输入时用）
- `defaultMinimized` — 初始是否收起

**注意**：这是「按时间推进」的展示组件，内部自己计时。真实任务接进来时，进度应当来自任务状态，而不是让它自己数秒。两种接法：

1. 简单：把已知步骤交给它，让它走完（适合步骤确定、时长可估的场景）
2. 精确：由外部驱动 —— 需要时给组件加受控的 `completed` prop，内部计时让位

目前只做了第 1 种。

## 复刻来源

照 BoardUI 的 Agent Progress 复刻，几何与时间取自它的实现：

| 量 | 值 |
|---|---|
| 卡片宽 | 341px |
| 收起高 | 44px |
| 展开高 | `max(44, 45 + 38 × 步数)` |
| 行高 | 32px |
| 行间距 | 6px |
| 列表上边距 | 9px |
| 卡片内边距 | 10 / 8 / 10 |
| 圆角 | 16px |
| 每步时长 | 3000ms |
| 首现延迟 | 1100ms |
| 每行入场 | `delay: 0.65 + 0.16 × i` |
| 进行中行内边距 | 9 / 13（其余 4 / 4） |
| 微光周期 | 3.4s |

### 依赖 motion

原组件用 framer-motion，本项目改用它的后继包 `motion`（14.10.1）。

**这是项目第一次引入动画库**。之所以不能省：换步时高亮框要**从上一行滑到下一行**，靠的是 Motion 的 `layoutId` —— 一个元素在两处之间做布局插值。CSS 做不到，除非手写 FLIP 测量，那等于自己实现半个布局动画库。

用到的 Motion 能力：`layoutId`（边框滑动）、`layout="position"`（文案宽度形变）、`AnimatePresence`（图标与文案交叉切换）。

## 三条踩过的坑

**1. 图标尺寸必须写在 CSS 里，不能只靠 Tailwind 类名。**
最初照抄了 `size-3.5` / `size-[15px]` 这些工具类。演示页没有 Tailwind，类名不生效，右箭头被撑成一大块黑色。现在尺寸都在 `agent-progress.css` 里，组件在哪种宿主里渲染都一致。

**2. `SwapLabel` 用 `popLayout` 时，容器必须是 `position: relative`。**
否则退场的新旧两段文字会并排留在流里，标题糊成一片。改成 `relative` + 退场元素绝对定位后才正常。

**3. 删除线要 `inline-block`，不能 `block`。**
`block` 会撑满父容器，删除线横贯整行；`inline-block` 宽度收成文字本身，才是「划过这行字」。

## 已知边界

- 只验证了演示页，**没有接进工作台/对话的真实任务状态**
- 进度是组件内部按时间推进，不反映真实任务耗时
- 收起态在悬停时右侧渐隐、露出展开按钮，键盘 `focus-visible` 同样生效
- `prefers-reduced-motion` 下高度动画关闭、微光关闭，其余布局动画由 Motion 自己降级
