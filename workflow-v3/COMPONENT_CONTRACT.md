# 组件合同 · v3

> 组件合同决定 AI 写的到底是**可复用动画组件**，还是套了 React 外壳的幻灯片。
> 一个组件一份合同；合同没过，不许写实现。

---

## 1. 合同模板

```markdown
## <ComponentName>

### 接口
- props：<name: type = default>（必填/可选，合法取值）
- 依赖：<无 / primitives/xxx / 其它组件>
- 资产：<无 / 文件路径 + 用途>（资产是输入，不是主体）

### 运动
- 输入帧：<local frame 范围>
- 输出状态：<这个组件让什么从什么变成什么>
- 起止条件：<t0 状态 / t1 状态>
- 曲线与阶段：<easing / spring / 分段>
- 与相邻组件：<谁先谁后、是否重叠>

### 视觉实现
- 机制：<path / mask / procedural / layered / transform / text / 3D>
- 必须由程序化实现的部分：<...>
- 允许的 transform：<只用于...，不得作为唯一运动>

### 工程
- 确定性：<无随机 / random(seed)>
- 帧边界：<是否受 Sequence 裁剪>
- 渲染成本：<元素数量级 / 是否 Canvas>
- 失败条件：<...>

### 验收
- 验收帧：<t0 / tmid / t1>
- 每个帧看到什么：<...>
- 不通过的样子：<...>
```

---

## 2. 示例（种子生长）

### SeedFall

- **接口**：`fromY: number`、`toY: number`、`impactFrame: number`；无资产。
- **运动**：0–58 帧位移 + 旋转；58 帧 spring 压扁；90 帧内回弹。
- **机制**：`transform` + `spring`（这一场景的叙事就是“落下”，transform 是合理主机制）。
- **确定性**：无随机。
- **验收**：0 帧在画外、58 帧接触地面并压扁、89 帧停在 y=700。

### SeedCrack

- **接口**：`crackFrames: number`、`openDelay: number`；无资产。
- **运动**：裂纹 `pathLength` 0→1；两半在 `openDelay` 后旋转/位移打开；打开后保持。
- **机制**：`path` + `spring`；裂纹必须是路径逐步画出，不许用一张裂纹贴图淡入。
- **确定性**：无随机。
- **验收**：90 帧完整、130 帧裂纹半程、170 帧贯穿并开始开壳、209 帧打开到位。

### RootGrowth

- **接口**：`rootCount: number`、`growFrames: number`、`stagger: number`；无资产。
- **运动**：每条根一个 path，`pathLength` 0→1；主根错开 `stagger` 帧；侧根更晚。
- **机制**：`path` + `procedural`（角度/长度用 `random(seed)` 生成，种子固定）。
- **确定性**：必须 `random(seed)`；不许 `Math.random()`。
- **验收**：210 帧无根、270 帧 3 条主根不等长、330 帧 5 条主根 + 侧根、389 帧稳定。

### Sprout

- **接口**：`stemFrames: number`、`leafDelay: number`；无资产。
- **运动**：茎 `pathLength` 0→1；两片叶在 `leafDelay` 后 `scale` + `rotate` 展开；保持。
- **机制**：`path` + `spring`。
- **确定性**：无随机。
- **验收**：390 帧无芽、440 帧茎出土、490 帧叶展开、539 帧稳定。

---

## 3. 硬规则

- **只包一层 `<img style={{transform}}>` 的组件，不算动画组件**；除非 scene spec 明确“这张图就是主体，运动就是内容”，并且合同里写清理由。
- 组件的输出必须是 `props + frame` 的纯函数；不许读全局时间、不许依赖挂载顺序。
- 组件必须能**单独渲染**：给定 props 和 frame，能出一帧；不能单独渲染 = 合同不成立。
- 一个组件只做一件事；多个场景共用一套逻辑时，抽到 `primitives/`，不许复制。
- 资产可以存在，但必须写清“拿掉资产，组件还能表达什么结构”。
- `interpolate()` / `spring()` / SVG 用得再多，也不能自动证明动画好；最终看验收帧。
