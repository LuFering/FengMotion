# 验收 · <片名>

## 1. 自动

| 项 | 命令 | 结果 |
|---|---|---|
| TypeScript | `npx tsc --noEmit` | |
| 场景规格 | `node workflow-v3/tools/validate-scene.mjs --film <片目录>` | |
| 确定性 | 同帧渲两次，像素/哈希一致 | |
| Composition | `npx remotion compositions <entry>` | |
| 成片 | `ffprobe` 分辨率 / 帧率 / 时长 | |

## 2. 逐场

| 场 | 验收帧 | 看到什么 | 结论 |
|---|---|---|---|
| | | | |

## 3. 已知限制

- 风格：
- 运动：
- 资产：
- 声音：
