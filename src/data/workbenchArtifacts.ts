/**
 * 工作台最小产物 fixture（P0.1）
 *
 * 这些是演示样例，不是已确认的 QA/批准记录；
 * 目的是先把「产物作为可浏览对象」的交互跑通，接后端时替换为 API 数据。
 */

export type ArtifactType = 'content-contract' | 'lookdev' | 'film-plan' | 'qa'
export type ArtifactStatus = 'confirmed' | 'draft' | 'needs-review'

export interface WorkbenchArtifact {
  id: string
  type: ArtifactType
  title: string
  version: string
  status: ArtifactStatus
  updatedAt: string
  summary: string
  body: string
  relatedShotIds: string[]
  demo: true
}

export const ARTIFACT_TYPE_LABEL: Record<ArtifactType, string> = {
  'content-contract': '内容契约',
  lookdev: '视觉方向',
  'film-plan': '导演处理',
  qa: '质量证据',
}

export const ARTIFACT_STATUS_LABEL: Record<ArtifactStatus, string> = {
  confirmed: '已确认',
  draft: '草稿',
  'needs-review': '待复核',
}

export const WORKBENCH_ARTIFACTS: WorkbenchArtifact[] = [
  {
    id: 'artifact-content-contract',
    type: 'content-contract',
    title: '内容契约 · Token 科普',
    version: 'v0.3',
    status: 'confirmed',
    updatedAt: '2026-10-08 14:20',
    summary: '观众看完能用一句话解释 Token，并知道它和算力成本的关系。',
    relatedShotIds: ['s01', 's03', 's11'],
    demo: true,
    body: `核心观点
Token 不是“AI 的魔法单位”，而是把算力、时间和成本翻译成可计价单位的计量器。

支撑事实
1. 黄仁勋在访谈里反复提到 token。
2. Token 是模型处理文本时的计量单位。
3. 算力、上下文和生成量都会转化为 token 成本。

关系/顺序
提问（为什么大佬都在说）→ 计量（token 是什么）→ 类比（人民币/石油）→ 成本（谁在为算力买单）→ 结论（AI 时代的计量单位）。

结尾
回到“一个 token 到底是什么”，让观众带走一句可复述的解释。

观众应记住的一句话
Token 是 AI 时代的计量单位，背后是算力和成本。`,
  },
  {
    id: 'artifact-lookdev',
    type: 'lookdev',
    title: '视觉方向 · 纸层与像素尘埃',
    version: 'v0.2',
    status: 'confirmed',
    updatedAt: '2026-10-08 15:05',
    summary: '纸层承载解释，像素尘埃承载算力；冷灰底上只有一处薄荷绿作为行动色。',
    relatedShotIds: ['s01', 's05', 's09', 's11'],
    demo: true,
    body: `视觉命题
把 Token 画成从算力里落下的“像素尘埃”，观众先看到尘埃，再看到它被计量、被换算、被装进一张纸。

视觉机制
一条像素尘埃从屏幕边缘进入，穿过标题、数字、人民币和石油类比，最后落成一张可读的账单。

色彩
纸白 / 冷灰 / 墨黑 / 薄荷绿（只给“正在被计量”的对象）

材质
纸、屏幕像素、玻璃、金属刻度；不用写实摄影。

场景
贴近尘埃 → 拉远看计量表 → 俯视看成本堆叠 → 回到纸面结论。`,
  },
  {
    id: 'artifact-film-plan',
    type: 'film-plan',
    title: '导演处理 · 三段式解释',
    version: 'v0.4',
    status: 'draft',
    updatedAt: '2026-10-08 16:10',
    summary: '开场提问 → 中段计量/类比 → 结尾回到问题。',
    relatedShotIds: ['s01', 's02', 's03', 's11', 's20'],
    demo: true,
    body: `内容契约
Token 是 AI 时代的计量单位，背后是算力和成本。

叙事阶段
A 提问（0–20s）：为什么大佬都在说 Token？
B 计量（20–80s）：Token 是什么、怎么计量、为什么和人民币/石油有关。
C 成本（80–130s）：算力、上下文、生成量如何变成成本。
D 结论（130–152s）：回到一个 Token 到底是什么。

场景设计
- 开场：极特写 + 后拉；让“Token”字样从像素中长出来。
- 中段：数据表/刻度/人民币类比，固定机位为主，靠尺度变化建立层级。
- 结尾：回到纸面，画面停止，留一句可复述的话。

当前缺口
计划 vs 成片的段落映射还没有自动校验。`,
  },
  {
    id: 'artifact-qa',
    type: 'qa',
    title: '质量证据',
    version: 'v0.1',
    status: 'needs-review',
    updatedAt: '2026-10-08 17:30',
    summary: '技术规格已检查；观众理解测试尚未执行。',
    relatedShotIds: ['s01', 's08', 's23'],
    demo: true,
    body: `技术 QA
- 成片文件可播放，画面可定位

视觉检查
- 已看：开场、计量、人民币类比、结尾边界帧
- 未做：完整连续播放审片

观众理解
- 未执行真人观众测试

结论
当前版本是“可播放的候选”，不是“已完成验收”。
下一步：先看完整片，再决定是否进入收尾阶段。`,
  },
]
