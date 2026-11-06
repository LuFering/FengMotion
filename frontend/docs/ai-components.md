# AI 组件三件套

三个「AI 正在工作」的视觉组件，都在同一个演示页里。来源与授权不同，用法也不同。

演示地址：`fengmotion://app/replica/ai-components/ai-components-demo.html`
重新构建：`npm run build:demo`

| 组件 | 文件 | 来源 | 授权 |
|---|---|---|---|
| AgentProgress | `src/components/AgentProgress.tsx` | BoardUI（Pro 组件，无源码） | 照实现复刻 |
| AgentThinking | `src/components/AgentThinking.tsx` | BoardUI 免费组件 | MIT |
| ThinkingOrbs | `src/components/thinking-orbs/` | [Libraries.dev](https://github.com/Jakubantalik/Libraries.dev) | MIT |

## AgentProgress · 任务进度

一条步骤清单：总进度环、逐行推进、可收起成一行。BoardUI 把它归为 Pro 组件，拿不到源码，所以是照它的实现复刻的 —— 几何与时间取自它的 DOM 与行为。

换步时高亮框用 `layoutId` 在行间滑动，这是它最有辨识度的动作，靠 `motion` 的布局动画实现。

```tsx
<AgentProgress steps={["读取项目文件", "运行构建"]} stepDuration={3000} />
```

## AgentThinking · 思考状态

BoardUI 的**免费**组件。它的完整源码内嵌在组件页面的数据里（`file: {name, code}`），不需要购买，直接从页面提取。

四种变体：`wave`（对角波前）、`spin`（绕行光点）、`stars`（闪烁星群）、`infinity`（无限彗星），每个都能配微光标签和计时器。

```tsx
<AgentThinking variant="wave" label="思考" showTimer />
```

### 接入时改了两处

- `@/utils/cx` → 项目已有的 `cn` 包
- 去掉 `useTemplateCopy`（BoardUI 的多语言钩子，本项目不需要）

### 改了一处上游行为

计时器原本从挂载起无限增长（实测能涨到几百秒）。那个数字对「还要等多久」没有帮助，只是噪音。加了 `ELAPSED_CAP_S = 99.9` 的上限。

### 微光的实现与上游不同

上游用 `background-clip: text` 把文字裁成渐变。**在这台机器的 Electron 里对渐变不生效**，而配着写的 `color: transparent` 已经把文字藏了，结果是整行看不见。

改成：文字保持实色、始终可读，高光作为独立一层叠在上面扫过。视觉上同样是「亮带扫过文字」，但不存在文字消失的可能。

## ThinkingOrbs · 粒子状态

**这是真源码**，从 MIT 仓库 `packages/thinking-orbs/src/` 完整搬来的原始 TypeScript，2433 行，零运行时依赖（只 peer 依赖 React ≥18）。

它不是 CSS 动画，是一个粒子物理引擎：

```
engine/core.ts      投影、噪声、颜色
engine/lattice.ts   点阵布局
engine/orbits.ts    轨道
engine/braid.ts     编织
engine/morph.ts     形变
engine/ribbon.ts    飘带
engine/web.ts       星座连线
engine/profiles.ts  尺寸/密度缩放
engine/registry.ts  状态 → 帧函数
gravity.ts          770 行，指针引力
```

九个状态是粒子的不同运动模式，不是换图标：

| 状态 | 表现 |
|---|---|
| `working` | 粒子沿倾斜轨道运行 |
| `searching` | 扫描线掠过点阵球面 |
| `solving` | 色带错位后归位 |
| `listening` | 波形穿过纬线环 |
| `connecting` | 星座自己接线，数据包沿边跑 |
| `weaving` | 三股绕球编织 |
| `composing` | 多带起伏 |
| `breathing` | 正面环缓慢形变 |
| `shaping` | 点阵轮廓 圆 → 三角 → 方 |

```tsx
<ThinkingOrb state="searching" size={64} theme="light" />
```

`size` 只有三个手工调过的值：`64`（头像尺度）、`32`（紧凑，由前两者插值）、`20`（内联文字尺度）。不是任意缩放。

### 改了一处上游代码

`engine/core.ts` 的 `paint()` 有个未使用参数 `rMin`（点半径已由 profiles 缩放）。改成 `_rMin` 并加注释，原因是不改签名位置（调用方可能按位置传参），只让本项目的未使用检查通过。

## 演示页

`src/demo/ai-components-demo.tsx` 是唯一演示入口，包含三个组件的全部状态。

`npm run build:demo` 会：
1. 用 `vite.components.config.ts` 构建（**带 Tailwind**）
2. 用 `scripts/sync-demo.mjs` 同步到 `public/replica/ai-components/` 并把资源路径改相对

**Tailwind 必须带**：AgentThinking 的点阵靠 `bg-current` 上色，`text-body-medium` 这类语义类名也来自主题。第一次做演示时漏了，结果 wave / spin 两个变体整块不显示。

## 依赖

`motion@14.10.1` —— AgentProgress 的边框滑动需要它。这是项目唯一的动画库依赖，另外两个组件都不需要。

## 已知边界

- 三个组件都只在演示页验证过，**没有接进真实任务状态**
- AgentProgress 的进度是内部按时间推进，不反映真实耗时
- ThinkingOrbs 的引力效果需要宿主提供指针 sprite，演示页没开
