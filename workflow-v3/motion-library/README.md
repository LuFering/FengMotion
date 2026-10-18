# 动效库 · v3

> 这里只放**经过真实渲染、逐帧验收、视觉审片**的组件。
> 没验证过的代码放在 `experiments/`，不许标“可复用”。

---

## 1. 一个可复用组件包含什么

| 项 | 内容 |
|---|---|
| 名称 / 版本 | `PathReveal@1.2` |
| 预览 | 5–10 秒 MP4 + 3 张代表帧 |
| 组件合同 | props、帧函数、机制、确定性、失败条件 |
| 参数说明 | 哪些可调、范围、默认值、影响什么 |
| 适用场景 | 线稿、图标、结构清晰的路径；不适合复杂插画 |
| 性能 | 渲染耗时、元素数量级、是否 Canvas |
| 测试状态 | 编译 / 渲染 / 确定性 / 视觉审片，四项都过才叫“已验证” |
| 已知限制 | 不支持什么、在哪些情况下会崩 |
| 来源 | 自研 / 参考卡 / 官方 skill / 第三方；授权 |

---

## 2. 候选组件（逐步积累，不代表已实现）

| 名称 | 用途 | 关键参数 | 状态 |
|---|---|---|---|
| `PathReveal` | 线稿/路径逐步画出 | 路径、描边、揭示速度 | 待建 |
| `LayeredParallax` | 分层纵深、横移 | 图层、速度梯度、模糊 | 待建 |
| `MapTransition` | 地图缩放/倾斜/转场 | 地理数据、缩放、倾角 | 待建 |
| `KineticTypography` | 文字逐字构建/重排 | 字体、字距、入场节奏 | 待建 |
| `ParticleField` | 粒子/尘埃/生长 | 种子、密度、生命周期 | 待建 |

> 名称是方向，不是承诺；只有跑过验收的才进“已验证”。

---

## 3. 注册表

`registry.json` 每项至少：

```json
{
  "name": "PathReveal",
  "version": "1.0.0",
  "preview": "previews/path-reveal.mp4",
  "frames": ["previews/path-reveal-0.png", "previews/path-reveal-mid.png"],
  "contract": "contracts/path-reveal.md",
  "props": ["path", "strokeWidth", "progress"],
  "useCases": ["线稿", "图标", "结构清晰的路径"],
  "notFor": ["复杂插画", "路径顺序混乱的画面"],
  "performance": "60fps / 1920x1080 / <8ms per frame",
  "status": "verified",
  "verifiedAt": "2026-10-18",
  "limitations": ["不支持填充路径", "不处理交叉路径"],
  "source": "自研"
}
```

`status` 只能是：`experiment` / `candidate` / `verified` / `deprecated`。

---

## 4. 进入“已验证”的门槛

- [ ] `tsc --noEmit` 0 error；
- [ ] 至少一部真实片子里用过，不是玩具 demo；
- [ ] 同帧两次渲染像素一致；
- [ ] 验收帧通过；
- [ ] 视觉审片通过（不是“能跑”就算）；
- [ ] 有预览、参数说明、已知限制；
- [ ] 有授权/来源记录。

> 四项缺一，最多是 `candidate`。

---

## 5. 复用规则

- 先搜库，再自研；自研要举证看过哪几个组件、为什么不适用；
- 复用时改 props/theme，不改组件内部；
- 组件升级要升版本，旧片锁旧版本；
- 同一效果出现三次以上，才值得抽成通用组件；
- 不许把某一部片的题材、配色、文案写进通用组件。
