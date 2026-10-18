# Remotion 工程契约 · v3

> 这是 v3 的**唯一执行标准**。场景规格、组件合同、验收都引用它，不各自定义。
> 换片不换契约；契约要改，先停跑、记版本、重跑。

---

## 1. 唯一注册入口

- 每部片一个 `Root.tsx`，只做一件事：`<Composition />` 注册。
- 全片只有一个 `Composition` id，例如 `<片名>Film`。
- `durationInFrames` / `fps` / `width` / `height` **只在这里给一次**，其它文档引用，不重算。
- 子组件不许自己算总时长；需要知道范围时，用 `Sequence` 的 `from` / `durationInFrames` 或 props 传入。

```tsx
<Composition
  id="SeedGrowth"
  component={SeedGrowth}
  durationInFrames={540}
  fps={60}
  width={1920}
  height={1080}
/>
```

---

## 2. 帧单位

| 项 | 规则 |
|---|---|
| 内部单位 | **整数帧**；所有 `from` / `durationInFrames` / `acceptanceFrames` 都是整数 |
| 秒 | 只允许出现在创意层和声音层；进入执行层必须换算 |
| 换算 | `frames = Math.round(seconds * fps)`；只换算一次，结果写进 scene spec |
| 时长 | 全片时长 = `durationInFrames`；不由各段秒数相加得出 |
| 边界 | 最后一个可渲染帧是 `durationInFrames - 1`；验收帧不得越界 |

> 禁止在同一份文档里混用秒、帧、毫秒。混用 = 契约违规。

---

## 3. 确定性

同一份代码、同一帧、同一 props，必须产出同一像素。

**禁止**

- `Date.now()` / `performance.now()` / `new Date()` 参与画面；
- 未播种的 `Math.random()`；
- 依赖浏览器窗口尺寸、滚动位置、网络状态；
- 异步加载完成后才决定布局（资源必须先声明、先就位）；
- 组件内部读全局时间轴（`frame` 只从 `useCurrentFrame()` 来）。

**允许**

- `random(seed)`（Remotion 的确定性随机）；
- 预计算的常量表、固定种子、显式 props；
- `staticFile()` 加载已声明的资源。

---

## 4. 资源规则

- 图片、视频、字体、音频、3D 模型都是**可用的画面材料**；它们可以是主体，也可以是纹理/背景。
- 资源必须在组件 `props` 或 scene spec 里声明；不许组件内部硬编码路径。
- 资源必须能离线复现：路径、尺寸、授权来源写进 `assets` 清单。
- **禁止的是无设计的素材轮播**，不是资产本身。
- 判断标准：**拿掉资源，这一镜的叙事是否还成立？**
  - 成立 → 资产是装饰，重新设计运动/构图；
  - 不成立 → 资产是主体，写进 scene spec 的 `layers` 与 `motionPlan`。

---

## 5. 文件所有权

| 路径 | 谁改 | 规则 |
|---|---|---|
| `Root.tsx` | 总控 | 只加 Composition，不改别人的 |
| `scene.spec.json` | 总控 / 动画设计 | 单一事实来源 |
| `components/<Name>.tsx` | 组件负责人 | 一个组件一个文件；props 类型导出 |
| `primitives/` | 总控 | 共享原语（path、mask、粒子、文字） |
| `assets/` | 总控 | 资源清单 + 授权 |

- 子任务按**组件**拆分，不按“段”拆分；接口在合同里，不在口头。
- 禁止两个组件各自实现同一套运动逻辑；先抽 `primitives/`。

---

## 6. 渲染入口

```bash
# 低分辨率预览（同一组件树，不是另做一条时间线）
npx remotion render <entry> <CompositionId> out/preview.mp4 --scale=0.5

# 单帧验收
npx remotion still <entry> <CompositionId> out/f<frame>.png --frame=<frame>

# 成片
npx remotion render <entry> <CompositionId> out/final.mp4
```

- 预览、验收、成片必须用**同一份代码**；两套代码 = 失败。
- 渲染失败、类型错误、Composition 缺失，一律阻止进入下一层。

---

## 7. 契约违规的判定

| 违规 | 判定 |
|---|---|
| 组件内部用 `Date.now()` / 未播种随机 | 确定性失败 |
| 预览与成片两套代码 | 交付失败 |
| 总时长在多个文件里各算一遍 | 契约违规 |
| 资源路径硬编码、未声明 | 契约违规 |
| 只有镜头描述、没有 component/props/frame | 执行层拒收 |
