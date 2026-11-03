# 本地动效库 · Local Motion Library

> 模型必须从这里取动效，不要每次从零写。

## 里面有什么

| 目录 | 数量 | 用法 |
|---|---|---|
| `templates/` | 81 个 `.tsx` | **零依赖、单文件、复制/直接 import 即用** |
| `cards/` | 157 张 `.md` | 镜头语言/配方卡，给模型读，不是代码 |
| `TEMPLATES.md` | 81 个模板的分类表 | 先查效果，再找文件 |
| `CARDS.md` | 跨库总索引 | 按“想要的效果”查 |

`remotion-scenes` 的 201 个组件不在本地：它们需要 `src/common` + `three`，不是零依赖。需要时去
`~/AIremotion-skill/03-动效组件库/06-动效库/remotion-scenes/`，不要直接复制单个文件。

## 怎么用

从 `remotion/<film>/` 里的 scene 导入：

```tsx
import ComparisonChart from '../library/templates/comparison-chart';
```

模板是默认导出，自己用 `useCurrentFrame`，不需要额外依赖。先跑一个 still：

```bash
cd ~/remotion/electron
npx remotion still remotion/<entry>.ts remotion/<CompositionId> \
  out/<film>/probe.png --frame=45
```

## 搜索

```bash
cd ~/remotion/electron/workflow-v4/production
node tools/search-library.mjs "comparison"
node tools/search-library.mjs "camera shake"
node tools/search-library.mjs "window" --limit 5
```

## 使用规则

1. **先搜再写**：carrier/beatboard 之前至少搜一次；把结果记进 `production.json` 的 `library.searched` + `decision`。
2. **用了就真用**：`decision=used` 时，至少有一个 scene 真的 import 并渲染 `library/templates/*`；只写“参考了”不算；`decision=rejected` 要写清为什么不用。
3. **模板不是成片**：模板默认配色/字体/文案必须改成 brief 的色板/字体/内容；直接复制会得到模板感。
4. **卡片管镜头，模板管效果**：镜头语言查 `cards/`，具体动效查 `templates/`；两者不能互相替代。
5. **许可证**：templates 来自 reactvideoeditor/remotion-templates（MIT）；保留文件头 credit。
