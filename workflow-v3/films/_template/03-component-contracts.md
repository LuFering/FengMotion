# 组件合同 · <片名>

> 一个组件一行；写不出 `来源` 的，不许写代码。

| 组件 | props（可序列化） | 机制 | 来源 | 事件 | 验收帧 |
|---|---|---|---|---|---|
| `Scene01` | | | self / card / ref / component | | 0 / 300 / 599 |

## 硬约束

- 所有组件只吃 `props + useCurrentFrame()`；
- 无 `Math.random()`；随机用固定种子；
- 资产路径不在组件内硬编码；
- 每个组件能单独渲染：`npx remotion still <entry> <Comp> out/f.png --frame=N`。
