# seed-growth · 端到端试验

> 目的：验证一条最小链路——**结构化规格 → 组件 → 编译 → 渲染 → 逐帧验收**。
> 不是最终成片，也不代表 FengMotion 的 Agent 后端已经接通。

## 文件

```
seed-growth/
├── index.ts               Remotion 入口（registerRoot）
├── Root.tsx               唯一 Composition：SeedGrowth / 540f / 60fps / 1920×1080
├── SeedGrowth.tsx         组件树（四个 Sequence 可重叠）
├── scene.spec.json        场景规格（含 eventFrames / motionPlan）
├── validate-scene.mjs     schema / 组件映射 / 帧覆盖 / Root 一致性校验
└── components/
    ├── Stage.tsx          天空 + 土壤（静态）
    ├── SeedShell.tsx      两半外壳 + 裂纹 path + 内芯
    ├── SeedFall.tsx       位移 + 旋转 + 落地压扁
    ├── SeedCrack.tsx      裂纹 pathLength + 开壳 spring
    ├── RootGrowth.tsx     5 条主根 + 侧根 + 根毛，pathLength 错峰
    └── Sprout.tsx         茎 pathLength + 叶片 spring
```

## 命令

```bash
cd ~/remotion/electron

# 1. 规格校验
node workflow-v3/examples/seed-growth/validate-scene.mjs

# 2. 类型检查
npx tsc --noEmit

# 3. 单帧验收
npx remotion still workflow-v3/examples/seed-growth/index.ts SeedGrowth out/v3/f209.png --frame=209

# 4. 低分辨率预览（同一组件树）
npx remotion render workflow-v3/examples/seed-growth/index.ts SeedGrowth out/v3/seed-preview.mp4 --scale=0.5
```

## 场景与事件窗口

| 场景 | from | duration | eventFrames | 组件 |
|---|---|---|---|---|
| seed-fall | 0 | 90 | 0–89 | SeedFall |
| seed-crack | 90 | 450 | 90–209 | SeedCrack（事件结束后保持打开） |
| root-growth | 210 | 330 | 210–389 | RootGrowth（事件结束后保持） |
| sprout | 390 | 150 | 390–539 | Sprout |

> `durationInFrames` 是组件在不在画面上；`eventFrames` 是事件什么时候发生；
> `motionPlan` 写清谁、从什么、到什么、什么时候、依赖谁。
> 开壳在 209 帧完成、种壳留到 539 帧，是合法的。

## 已验证

- `validate-scene.mjs`：4 个场景 / 540 帧 / 60fps，通过；
- 负例：把 `seed-crack` 的验收帧改成 539，校验器报
  `验收帧 539 不在 eventFrames [90,209] 内`，exit 1；
- `npx tsc --noEmit`：0 error；
- 同帧渲染两次：像素完全一致（确定性）；
- `seed-preview.mp4`：960×540 / 60fps / 9.0s / 540 帧；
- 抽帧检查：落下、裂纹延伸、开壳、根系生长、叶片展开都是连续变化，没有“完整直接跳到完成”。

## 取材

本示例是手写参考实现，没有使用卡库/参考视频；按 v3 规则，真实项目自研必须举证看过 2 张卡/组件，写不出 = 没搜。

---

## 已知不足

- 平面矢量风格，是**机制验证**，不是最终美术；
- 光源方向不统一（左侧高光 + 中央背景光晕）；
- 根系透视弱，根颈过渡偏硬；
- 没有声音、没有字幕、没有调色；
- 没有接入 FengMotion 的节点编辑器或 Agent 后端。

## 下一步

- 加一个“相机”层（缓慢推近/横移），让 9 秒不是一张固定构图；
- 把 `SeedCrack` 的裂纹改成不规则路径，增加破壳的物理张力；
- 用同一套 scene spec 跑第二个场景（文字构建 / 数据增长），验证组件复用；
- 把 `validate-scene.mjs` 提升为仓库级门禁，接入 CI。
