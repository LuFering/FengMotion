# 渲染验收 · v3

> 验收不是“AI 自查一遍”，是**分层的、可执行的检查**。
> 能在脚本里做的，不写在文档里让人看。

---

## 1. 七层验收

| 层 | 检查内容 | 失败处理 |
|---|---|---|
| **1 静态检查** | TypeScript、导入、props 类型、禁止的 API（`Date.now` / 未播种 `Math.random`） | 阻止进入渲染 |
| **2 工程检查** | Composition 注册、fps、分辨率、`durationInFrames`、入口唯一 | 阻止交付 |
| **3 确定性检查** | 同一帧渲染两次，像素/哈希一致 | 标记失败，定位随机源 |
| **4 关键帧检查** | 验收帧的主体状态、遮挡、文字位置、图层关系 | 返工对应组件 |
| **5 运动检查** | 中间帧是否连续、有没有跳变/直接跳到完成、状态转换是否可见 | 返工动画实现 |
| **6 渲染检查** | 实际渲染是否完成、耗时、内存、有没有黑帧/空场 | 重试或降级 |
| **7 成片检查** | 声音同步、节奏、视觉一致性、编码结果 | 人工审片或返工 |

---

## 2. 两个容易混的判断

**同帧同像素 ≠ 动画正确。**
它只证明确定性；一张完全错误的静帧也可以做到同帧同像素。
运动正确性必须看**不同帧之间的状态变化**，并对照 scene spec 的 `acceptanceCriteria`。

**画面变化少 ≠ 失败。**
标题、阅读、情绪停顿都可能是设计。是否失败由 scene spec 的 `intent` 决定，不由全局死帧阈值决定。

---

## 3. 验收帧怎么选

- 每个场景至少 3 帧：`t0`（起始）、`tmid`（过程中）、`t1`（结束）；
- 有状态转换的，加转换前/转换后各一帧；
- 有遮挡/揭示的，加“揭示前/揭示后”；
- 有 spring 回弹的，加“过冲最大”那一帧；
- 验收帧必须落在 `[from, from + durationInFrames - 1]` 内。

---

## 4. 命令

```bash
# 类型 / 构建
npx tsc --noEmit

# 单帧
npx remotion still <entry> <CompositionId> out/f000.png --frame=0
npx remotion still <entry> <CompositionId> out/f270.png --frame=270

# 低分辨率预览（同一组件树）
npx remotion render <entry> <CompositionId> out/preview.mp4 --scale=0.5

# 成片
npx remotion render <entry> <CompositionId> out/final.mp4
```

---

## 5. 门禁（必须脚本化）

| 门禁 | 判据 | 不通过 |
|---|---|---|
| 编译 | `tsc --noEmit` 0 error | 不许渲染 |
| 接口 | scene spec 的 `component` 都存在，props 必填项齐全 | 不许渲染 |
| 注册 | Composition id 存在，fps/尺寸/时长与契约一致 | 不许交付 |
| 确定性 | 同帧两次渲染哈希一致 | 判失败 |
| 关键帧 | 每个 `acceptanceFrames` 都有对应截图和判定 | 未验证，不算通过 |
| 运动 | 中间帧连续，无跳变/直接完成 | 返工组件 |
| 成片 | 1× 看完，声音同步，无黑帧/空场 | 人工审片 |

> 没有脚本的门禁 = 没有门禁。文档只能解释，不能阻止。
