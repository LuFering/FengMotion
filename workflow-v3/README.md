# 段级流程 v3 · 程序化动画工作流

> **v2 保留，v3 隔离验证。**
> v2 的单位是「镜头 / 素材 / 时间轴」；v3 的单位是「组件 / 帧 / 验收帧」。
> 第一版只证明一件事：**创意能映射到组件合同与场景规格，执行层不接受只有镜头描述的交付物。**

---

## 为什么要有 v3

v2 不是没有创意层，而是它的**描述单位**是剪辑：段、镜、素材、时长、转场。
AI 按这套单位执行，最省力的实现必然是「一张图 + 位移 + 透明度 + 转场」。
于是每一步都合规，整片却是幻灯片。

v3 不删除创意，也不要求所有画面都用代码画。
它只改变一件事：**从创意到成片，必须经过一个可编译、可渲染、可逐帧验收的组件系统。**

---

## 四层，各有产物

| 层 | 回答的问题 | 产物 | 不通过的样子 |
|---|---|---|---|
| **01 创意意图** | 观众看到什么、感受到什么 | 主题 / 叙事 / 声音 / 风格 / 节奏曲线 | 只有“高级感”形容词 |
| **02 动画设计** | 每个变化由什么组件、什么机制实现 | `scene.spec.json` + 组件合同 | 只有镜头表，没有 component/props/frame |
| **03 Remotion 执行** | 代码是否按帧执行 | 组件、Composition、帧函数 | 组件内部只有图片平移 |
| **04 渲染验收** | 实际输出对不对 | 采样帧、渲染、自动检查 | 只看静帧或只看“有没有动” |

**层与层之间靠结构化产物交接，不靠自然语言“你懂的”。**

> 01 与 02 之间先做**参考分析 + 关键画面确认**；04 内部有 **Studio 迭代 + 视觉审片**。
> 工程正确不等于视觉成立，两者都要过。

---

## 执行顺序（不要跳）

1. **复制模板 + 门 0**：`cp -r films/_template films/<id>`；填完参考/规格/合同/关键画面后跑
   `node workflow-v3/tools/check-precode.mjs --film workflow-v3/films/<id>`。
   **门 0 不过，`components/` 里不许有 `.tsx`。**
2. **参考分析**：`REFERENCE_ANALYSIS.md`——把参考拆成构图/材质/运动/节奏；出 2–3 个方向。
3. **关键画面**：先出 2–3 张，用户选一张；没确认不许写组件。
4. **定契约**：`REMOTION_CONTRACT.md`（帧单位、注册入口、确定性、资源规则）。
5. **场景规格 + 资产策略**：`SCENE_SPEC.md` + `ASSET_WORKFLOW.md`；复杂动作写 `motionPlan`。
6. **组件实现**：先搜 282 组件 / 157 卡 / 参考视频，再自研；`COMPONENT_CONTRACT.md`；一个组件一个文件。
7. **Studio 迭代**：`ITERATION_WORKFLOW.md`——真实预览、暴露参数、快照、局部返工。
8. **自动验收 + 视觉审片**：`RENDER_QA.md` 七层自动检查 + 第八层人工审片。
9. **沉淀组件**：通过验证的进 `motion-library/`；没验证的只能算 experiment。
10. **最后改编辑器**：节点语义按「场景 / 组件 / 资源 / 预览 / 渲染」设计，不照搬剪辑轨。

---

## 目录

```
workflow-v3/
  README.md              本文件：四层、顺序、硬规则
  REMOTION_CONTRACT.md   工程契约：入口、帧、确定性、资源
  MOTION_RULES.md        运动机制与反例
  SCENE_SPEC.md          场景规格：字段、schema、校验
  COMPONENT_CONTRACT.md  组件合同：接口、帧行为、验收
  VISUAL_DESIGN.md       风格系统：色板、字体、构图、层级
  RENDER_QA.md           七层自动验收 + 第八层视觉审片
  REFERENCE_ANALYSIS.md  参考片分析 / 视觉探索 / 关键画面确认
  ASSET_WORKFLOW.md      资产策略 / 记录 / 边界（资产可以是主体）
  ITERATION_WORKFLOW.md  Studio 预览 / 参数 / 快照 / 局部返工
  motion-library/
    README.md            入库门槛 / 从现有库导入
    registry.json        候选与已验证组件索引
  tools/
    check-precode.mjs    门 0：写代码前的顺序/产物检查
    validate-scene.mjs   唯一场景规格校验器（不要每片复制）
  films/
    _template/           新片模板（开工/参考/规格/合同/验收/审片）
  templates/
    scene.spec.json      场景规格样例
    component.contract.md 组件合同空模板
  examples/
    seed-growth/         端到端试验：规格 → 组件 → 编译 → 渲染 → 逐帧验收
```

---

## 现有资产（直接可用，不要从零造）

| 资产 | 位置 / 命令 |
|---|---|
| 157 张镜头卡 | `python3 ~/AIremotion-skill/03-工具/search-craft.py --index` |
| 卡源码 | `~/AIremotion-skill/02-镜头卡库/video-shotcraft/gallery/source/<卡名>.md` |
| 282 个组件 | `~/AIremotion-skill/03-动效组件库/06-动效库/00-跨库总索引.md` |
| 3 个参考视频 | `~/Videos/下载.mp4` / `下载 2.mp4` / `下载1.mp4` |
| 参考视频检索 | `python3 ~/AIremotion-skill/03-工具/search-craft.py <关键词> --only ref` |
| 候选组件索引 | `motion-library/registry.json` |

> 先搜库、再自研；自研必须举证看过哪 2 张卡/组件，写不出 = 没搜。

---

## 新片开工

```bash
cd ~/remotion/electron
cp -r workflow-v3/films/_template workflow-v3/films/<片名>
# 填 00-开工 / 01-reference / reference-log / 02-scene.spec / 03-contracts / keyframes / approved
node workflow-v3/tools/check-precode.mjs --film workflow-v3/films/<片名>
```

- 门 0 不过，不许写组件；
- 校验器只用 `tools/validate-scene.mjs`，**不要每片复制一份**（复制品会被改松）；
- 关键画面没用户原话（`approved.md`），不算确认；
- 首次视觉方向用强模型；弱模型只做模板复刻。记录模型，别把模型差异算成流程效果。

## 硬规则

- **先跑门 0，再写代码**；`components/` 先有 `.tsx` = 顺序违规。
- **没有 component / props / frame 映射的交付物，执行层不接收。**
- **能编译、能渲染、能逐帧验收**，才算完成；只交分镜图和时间段不算。
- **资产可以是主体**，但必须有设计目的、参与构图/运动/合成/叙事；禁止的是无设计的素材轮播。
- **静止可以是设计**，但必须在 scene spec 里写明意图；不用全局死帧阈值逼所有画面动。
- **同帧同像素只证明确定性**，不证明动画正确；运动必须看中间帧。
- **测试期间冻结流程**：开跑后不改契约、不改 schema，改完重跑。

---

## 技术知识层

- 官方 Remotion skill：https://github.com/remotion-dev/skills
- 它解决 API、Composition、资源、渲染等工程问题；**不替代视觉设计**。
- 固定依赖版本，记录实际运行环境。
- **“读过 skill”不等于“达到生产质量”**；最终仍以渲染结果和审片为准。
