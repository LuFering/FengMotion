# workflow-v4

> AI 视频工作流 v1：**转译层 + 制作层 + 本地动效库**，一个文件夹集成。
> 旧 `workflow-v2` / `workflow-v3` 已归档，不是入口。

## 结构

```
workflow-v4/
├── README.md                 # 本文件（总入口）
├── translation/              # 转译层：输入 → brief.ready.json
│   ├── README.md
│   ├── schema/brief.schema.json
│   ├── tools/{validate-brief,estimate-duration,apply-decision}.mjs
│   └── prompts/{translator,extract-*,builder-acceptance}.md
├── production/               # 制作层：brief → carrier/beats/timing → 成片
│   ├── README.md
│   ├── schema/production.schema.json
│   ├── tools/{check-production,search-library}.mjs
│   └── prompts/{production,director,carrier,beatboard,animatic,builder,qa}.md
├── library/                  # 81 个零依赖模板 + 157 张镜头卡
│   ├── templates/
│   ├── cards/
│   ├── TEMPLATES.md
│   └── CARDS.md
└── films/                    # 新片放这里：workflow-v4/films/<片名>/
```

`~/remotion/electron/remotion/library` 是指向 `workflow-v4/library` 的软链，
所以 Remotion scene 仍可 `import '../library/templates/...'`。

## 唯一入口

1. `translation/README.md`：把输入转成 `brief.ready.json`
2. `production/README.md`：把 brief 做成 carrier/beats/timing、probes、animatic、成片
3. `production/prompts/director.md` + `builder.md`：两个 phase 的提示词
4. `library/README.md`：先搜库，再写代码

Builder 只读 `brief.ready.json` + 代码库；不回看原始输入和旧片。

## v1 硬门（只有 5 条）

1. `brief.ready.json` 通过 `translation/tools/validate-brief.mjs`；
2. `production.json` 有 carrier / beats / timing，hard anchors 对得上；
3. 至少 1 个 visual probe（still 或 2s clip），路径进 `probes[]`；
4. `timing.animatic` 是真实文件，ffprobe 时长 ≈ `totalSeconds`，scenes 覆盖全时间轴；
5. 至少 1 个 playable scene + `qa.frames` / `qa.motionClips` / `qa.finalVideo`。

其余是建议，不卡门：2 个 carrier、每 beat 2 解、`director` 块、必须用模板。
不要把建议做成硬门，模型会为了过门凑字段。

## 这次修复的门禁

- `brief.status=ready` 且 `mechanismSource != user` 时，必须有 `options >= 2` + 合法 `selectedOption`；不能自己定一个 mechanism 就 ready。
- `timing.hardAnchors[].source=user` 不能和同一时间点的 `script[].atSource=estimate` 共存；估算时间不能伪装成用户硬约束。
- 非 user 机制时，`acceptance` 不许规定“一镜到底/不切/升角/俯拍/机位”，`builderMandate` 不许锁死载体。
- `mode=open` 的 `carrier.chosen` 不能直接用 brief `candidateDirections` 里的载体；必须自己提一个。
- `pushback.status=applied` 必须有 `resolution` + `approvedBy`，否则 `--build` 拒绝；不能自己批准自己。
- QA 的 acceptance 只有成立/不成立；字幕提到的东西画面里没有 = 不成立。

## 命令

```bash
cd ~/remotion/electron/workflow-v4/translation
node tools/validate-brief.mjs path/to/brief.ready.json

cd ../production
node tools/search-library.mjs "comparison"
node tools/check-production.mjs ../films/<片名>/production.json --director
node tools/check-production.mjs ../films/<片名>/production.json --build
node tools/check-production.mjs ../films/<片名>/production.json --final

# 新片在 remotion/Root.tsx 注册一个 Composition，id 另起，不要改 HelloWorld
cd ~/remotion/electron
npx remotion render remotion/index.ts <compositionId> out/<片名>.mp4 --concurrency=$(nproc)
```

建议把每片合同放 `workflow-v4/films/<片名>/production.json`；`library.used` 里的路径相对该文件写，
例如 `../../library/templates/comparison-chart.tsx`。

## 当前状态

- `films/` 是空的，没有旧片样例；
- `translation/`、`production/` 里没有历史 examples（已归档）；
- 测试请用新输入，不要复用城市夜晚/DeepSeek，否则会复读旧方向；
- 旧片/旧流程在 `~/remotion/_archive/2026-10-18-v1-clean/`，不要读。

## 边界

- 转译层只给事实、硬锚点、问题和创作空间，不排镜头秒数；
- 制作层自己找载体、自己量时间；brief 不是分镜；
- 门只能挡住假交付，挡不住平庸；最终仍要看渲染帧和盲评。
