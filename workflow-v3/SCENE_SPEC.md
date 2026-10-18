# 场景规格 · v3

> 场景图不是“把镜头表改成帧表”，它是**整部片的可执行蓝图**。
> 每一行都必须能映射到一个真实组件；映射不了的，不许进执行层。

---

## 1. 字段

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `sceneId` | string | 是 | 唯一；与组件文件名对应 |
| `intent` | string | 是 | 叙事/视觉目标；一句话说清“这一下让观众多知道了什么” |
| `from` | int | 是 | 起始帧（含） |
| `durationInFrames` | int | 是 | 组件在画面上的持续帧数；结束帧 = `from + duration - 1` |
| `eventFrames` | [int, int] | 是 | **事件窗口**（起, 止，含）；事件必须在这段内完成；可以短于 `durationInFrames`，剩余时间是“保持结果” |
| `component` | string | 是 | 实际组件名；必须在组件合同里存在 |
| `props` | object | 是 | 组件输入；必须可 JSON 序列化 |
| `motion` | string[] | 是 | 运动机制（path / mask / procedural / layered / transform…） |
| `layers` | string[] | 否 | 前景 / 主体 / 背景 / 叠加关系 |
| `transitions` | object | 否 | 与相邻场景的衔接机制（不是“转场特效”） |
| `acceptanceFrames` | int[] | 是 | 必须检查的采样帧；必须落在本场景区间内 |
| `acceptanceCriteria` | string[] | 是 | 每个采样帧/状态要满足什么 |

---

## 2. 规则

- 所有帧字段是**整数**；不允许秒、毫秒混用。
- 场景**可以重叠**（根系还在长，嫩芽已经开始），不是一条顺序播放的剪辑轨。
- `durationInFrames` 是“组件在不在画面上”，`eventFrames` 是“事件什么时候发生”。
  开壳在 209 帧完成、种壳留到 539 帧，是合法的：`eventFrames` 到 209，`durationInFrames` 到 539。
- 场景必须覆盖 `0 … durationInFrames-1`，不许有空洞。
- `component` 必须能在 `components/` 找到；找不到 = 规格无效。
- `props` 里不许塞函数、JSX、文件句柄；只放数据。
- `acceptanceFrames` 至少 3 个：起点、中点、终点；复杂运动加中间帧；**必须落在 `eventFrames` 内**。
- 一个场景一个 `sceneId`；重名 = 规格无效。

---

## 3. 样例（种子生长，仅规格，不含代码）

```json
{
  "filmId": "seed-growth",
  "fps": 60,
  "width": 1920,
  "height": 1080,
  "durationInFrames": 540,
  "scenes": [
    {
      "sceneId": "seed-fall",
      "intent": "种子从画外落下，落地压扁，建立‘它要在这里发生’的期待",
      "from": 0,
      "durationInFrames": 90,
      "eventFrames": [0, 89],
      "component": "SeedFall",
      "props": { "fromY": -140, "toY": 700, "impactFrame": 58 },
      "motion": ["transform", "spring"],
      "layers": ["background", "seed", "shadow"],
      "acceptanceFrames": [0, 30, 58, 89],
      "acceptanceCriteria": [
        "0 帧：种子在画面上方，未入土",
        "58 帧：种子接触地面，出现压扁",
        "89 帧：种子停在 y=700，形变回弹结束"
      ]
    },
    {
      "sceneId": "seed-crack",
      "intent": "外壳沿裂纹打开，观众第一次看到‘里面活着’",
      "from": 90,
      "durationInFrames": 450,
      "eventFrames": [90, 209],
      "component": "SeedCrack",
      "props": { "crackFrames": 55, "openDelay": 50 },
      "motion": ["path", "spring"],
      "layers": ["seed-shell-left", "seed-shell-right", "crack-glow"],
      "acceptanceFrames": [90, 130, 170, 209],
      "acceptanceCriteria": [
        "90 帧：外壳完整，裂纹长度 0",
        "130 帧：裂纹约一半，外壳未开",
        "170 帧：裂纹贯穿，两半开始分离",
        "209 帧：两半打开到最终角度，不再回弹"
      ]
    },
    {
      "sceneId": "root-growth",
      "intent": "根系向下生长，建立‘它在往下扎根’的空间感",
      "from": 210,
      "durationInFrames": 330,
      "eventFrames": [210, 389],
      "component": "RootGrowth",
      "props": { "rootCount": 5, "growFrames": 110, "stagger": 12 },
      "motion": ["path", "procedural"],
      "layers": ["soil", "main-roots", "branches"],
      "acceptanceFrames": [210, 270, 330, 389],
      "acceptanceCriteria": [
        "210 帧：只有种壳，没有根",
        "270 帧：主根已长出 3 条，长度不等",
        "330 帧：5 条主根全部出现，侧根开始分叉",
        "389 帧：根系停止生长，保持在土里"
      ]
    },
    {
      "sceneId": "sprout",
      "intent": "嫩芽破土、叶片展开，完成‘从种子到生命’的闭环",
      "from": 390,
      "durationInFrames": 150,
      "eventFrames": [390, 539],
      "component": "Sprout",
      "props": { "stemFrames": 80, "leafDelay": 60 },
      "motion": ["path", "spring"],
      "layers": ["soil", "stem", "leaves"],
      "acceptanceFrames": [390, 440, 490, 539],
      "acceptanceCriteria": [
        "390 帧：土面完整，没有芽",
        "440 帧：茎已出土，叶子未展开",
        "490 帧：两片叶展开到最终角度",
        "539 帧：整株稳定，不再生长"
      ]
    }
  ]
}
```

---

## 4. 校验清单（进执行层前逐条打勾）

- [ ] `sceneId` 唯一，`component` 在组件合同里存在；
- [ ] 所有帧字段是整数，`from + duration` 不越界；
- [ ] 场景覆盖全片，无空洞；
- [ ] 每个场景至少 3 个验收帧，且都落在区间内；
- [ ] 每个场景的 `motion` 至少一种机制，且不是全片只有 `transform`；
- [ ] 每个 `acceptanceCriteria` 都能用“看哪一帧、看到什么”判定；
- [ ] `props` 可序列化，不含函数/JSX；
- [ ] 场景重叠是有意的（写进 `layers` 或 `intent`），不是时间算错。
