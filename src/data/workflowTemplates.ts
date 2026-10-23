/**
 * 工作流模板与节点定义（v5 重构）
 *
 * 定案（《工作流v5重构定案-对话结论》）：内容模型对齐 workflow-v5 v0.5.14.2——
 * · 路径决定结构：Prompt-first（默认）/ Structured（按需）；题材只是预设，
 *   只给提示词结构与默认参数，不再每个题材复制一套节点图。
 * · 产物是节点，阶段是泳道，Gate 是阶段边界上的独立检查点。
 * · Prompt-first 不画 Gate；Structured 的确认绑 artifactId + version，
 *   推荐与确认分开表达。
 */
import { STORYBOARD } from './productionData'
import { BUILTIN_ASSETS } from './myAssets'

export type WfPath = 'prompt-first' | 'structured'

export type WfPortType =
  | 'PromptDoc'
  | 'RefSet'
  | 'LookDoc'
  | 'PlanDoc'
  | 'CapSet'
  | 'RenderRef'
  | 'ReviewDoc'
  | 'ArtifactRef'

export interface WfPort {
  id: string
  type: WfPortType
  label: string
  required?: boolean
}

export interface WfNodeDef {
  type: string
  label: string
  group: string
  description: string
  inputs: WfPort[]
  outputs: WfPort[]
  /** structured 产物节点的产物种类（type==='artifact' 时用） */
  artifactKind?: string
  stage?: number
}

export const WF_PORT_COLORS: Record<WfPortType, string> = {
  PromptDoc: '#8ab4ff',
  RefSet: '#5ec8a7',
  LookDoc: '#e8b13c',
  PlanDoc: '#c792ea',
  CapSet: '#f0718c',
  RenderRef: '#3b8cf8',
  ReviewDoc: '#7fd08c',
  ArtifactRef: '#9aa3b2',
}

/* ── Prompt-first 节点 ─────────────────────────────────────────── */

export const PF_NODE_DEFS: WfNodeDef[] = [
  {
    type: 'prompt',
    label: '提示词输入',
    group: '输入',
    description: '原始创作需求，直接进入创作，不要求先转成结构化文档',
    inputs: [],
    outputs: [{ id: 'doc', type: 'PromptDoc', label: '提示词' }],
  },
  {
    type: 'refs',
    label: '参考与素材',
    group: '输入',
    description: '参考片段、素材库素材、既有项目引用（可选，可为空）',
    inputs: [],
    outputs: [{ id: 'refs', type: 'RefSet', label: '引用集' }],
  },
  {
    type: 'lookdev',
    label: 'Lookdev · 视觉转译',
    group: '工作稿',
    description: '视觉基调/材质/光线/动势的工作稿，可迭代，不是审批门',
    inputs: [
      { id: 'prompt', type: 'PromptDoc', label: '提示词', required: true },
      { id: 'refs', type: 'RefSet', label: '引用集' },
    ],
    outputs: [{ id: 'doc', type: 'LookDoc', label: 'Lookdev' }],
  },
  {
    type: 'filmplan',
    label: 'Film-plan · 导演处理',
    group: '工作稿',
    description: '一页导演处理：叙事推进、镜头节奏、视听策略',
    inputs: [
      { id: 'prompt', type: 'PromptDoc', label: '提示词', required: true },
      { id: 'look', type: 'LookDoc', label: 'Lookdev' },
    ],
    outputs: [{ id: 'doc', type: 'PlanDoc', label: 'Film-plan' }],
  },
  {
    type: 'capability',
    label: '能力检索',
    group: '按需',
    description: '按需检索 capability registry 的能力候选（原「技法引用」）',
    inputs: [
      { id: 'look', type: 'LookDoc', label: 'Lookdev' },
      { id: 'plan', type: 'PlanDoc', label: 'Film-plan' },
    ],
    outputs: [{ id: 'caps', type: 'CapSet', label: '能力集' }],
  },
  {
    type: 'create',
    label: '创作与渲染',
    group: '核心',
    description: 'Remotion 创作与渲染；中间规格未完成不阻断（v5 硬规则）',
    inputs: [
      { id: 'prompt', type: 'PromptDoc', label: '提示词', required: true },
      { id: 'refs', type: 'RefSet', label: '引用集' },
      { id: 'look', type: 'LookDoc', label: 'Lookdev' },
      { id: 'plan', type: 'PlanDoc', label: 'Film-plan' },
      { id: 'caps', type: 'CapSet', label: '能力集' },
    ],
    outputs: [{ id: 'render', type: 'RenderRef', label: '渲染记录' }],
  },
  {
    type: 'review',
    label: '看片与修改',
    group: '核心',
    description: '对着真实预览记问题与修改意图；quality-bar 问题清单挂在此节点',
    inputs: [{ id: 'render', type: 'RenderRef', label: '渲染记录', required: true }],
    outputs: [{ id: 'notes', type: 'ReviewDoc', label: '看片记录' }],
  },
  {
    type: 'finishing',
    label: 'Finishing · 完成度打磨',
    group: '按需',
    description: '观众优先的收束：节奏、音画关系、细节与 QC',
    inputs: [
      { id: 'render', type: 'RenderRef', label: '渲染记录', required: true },
      { id: 'notes', type: 'ReviewDoc', label: '看片记录' },
    ],
    outputs: [{ id: 'render', type: 'RenderRef', label: '渲染记录' }],
  },
]

/* ── Structured 阶段与产物 ─────────────────────────────────────── */

export const STRUCTURED_STAGES: Array<{ index: number; label: string; question: string }> = [
  { index: 0, label: '意图编译', question: '用户想表达什么？' },
  { index: 1, label: '导演诊断 / 方向', question: '这条片应该如何表达？' },
  { index: 2, label: '参考分析', question: '哪些手法值得借鉴、不能复现？' },
  { index: 3, label: '方向样稿', question: '采用哪种视觉语言？' },
  { index: 4, label: '视觉系统 + 场景', question: '规则是什么？每个场景表达什么？' },
  { index: 5, label: '动画设计 + 证明', question: '对象何时发生什么变化？运动成立吗？' },
  { index: 6, label: '声音先行 + 制作循环', question: '声音与节奏支撑整片吗？' },
  { index: 7, label: '交付', question: '成片真的成立吗？' },
]

interface ArtifactKindDef {
  kind: string
  label: string
  filename: string
  stage: number
}

export const ARTIFACT_KINDS: ArtifactKindDef[] = [
  { kind: 'intent-brief', label: '意图简报', filename: 'intent-brief.json', stage: 0 },
  { kind: 'creative-diagnosis', label: '导演诊断', filename: 'creative-diagnosis.json', stage: 1 },
  { kind: 'creative-directions', label: '创作方向', filename: 'creative-directions.json', stage: 1 },
  { kind: 'reference-log', label: '参考记录', filename: 'reference-log.json', stage: 2 },
  { kind: 'reference-analysis', label: '参考分析', filename: 'reference-analysis.json', stage: 2 },
  { kind: 'reference-decision', label: '参考决策', filename: 'reference-decision.json', stage: 2 },
  { kind: 'direction-samples', label: '方向样稿', filename: 'direction-samples/', stage: 3 },
  { kind: 'visual-direction', label: '视觉系统', filename: 'visual-direction.json', stage: 4 },
  { kind: 'scene-intents', label: '场景意图', filename: 'scene-intents.json', stage: 4 },
  { kind: 'scene-layouts', label: '场景布局', filename: 'scene-layouts/', stage: 4 },
  { kind: 'scene-spec', label: '动画规格（按需）', filename: 'scene.spec.json', stage: 5 },
  { kind: 'component-contract', label: '组件合同（按需）', filename: 'component-contract', stage: 5 },
  { kind: 'proof-10s', label: '10s 证明', filename: 'proof-10s.mp4', stage: 5 },
  { kind: 'animatic', label: 'Animatic', filename: 'animatic.mp4', stage: 6 },
  { kind: 'passes', label: '制作轮次', filename: 'passes/', stage: 6 },
  { kind: 'delivery', label: '成片交付', filename: 'delivery', stage: 7 },
  { kind: 'qc', label: 'QC / 版权 / 盲评', filename: 'qc', stage: 7 },
]

export const ARTIFACT_KIND_MAP: Record<string, ArtifactKindDef> = Object.fromEntries(
  ARTIFACT_KINDS.map((k) => [k.kind, k]),
)

function artifactDef(k: ArtifactKindDef): WfNodeDef {
  return {
    type: 'artifact',
    artifactKind: k.kind,
    stage: k.stage,
    label: k.label,
    group: `阶段 ${k.stage}`,
    description: `${STRUCTURED_STAGES[k.stage].label} · ${k.filename}`,
    inputs: [{ id: 'in', type: 'ArtifactRef', label: '上游产物' }],
    outputs: [{ id: 'out', type: 'ArtifactRef', label: k.filename }],
  }
}

export const GATE_DEFS: Record<string, { label: string; question: string; afterStage: number }> = {
  ref: { label: '参考门', question: '参考的使用边界成立吗？', afterStage: 2 },
  A: { label: 'Gate A · 方向验证', question: '视觉语言成立吗？', afterStage: 3 },
  B: { label: 'Gate B · 场景布局', question: '场景布局成立吗？', afterStage: 4 },
  C: { label: 'Gate C · 运动验收', question: '运动成立吗？（仅 production）', afterStage: 5 },
  D: { label: 'Gate D · 终审', question: '成片真的成立吗？', afterStage: 7 },
}

const gateDef = (gate: string): WfNodeDef => ({
  type: 'gate',
  label: GATE_DEFS[gate].label,
  group: '检查点',
  description: GATE_DEFS[gate].question,
  inputs: [{ id: 'in', type: 'ArtifactRef', label: '待检产物', required: true }],
  outputs: [{ id: 'out', type: 'ArtifactRef', label: '检查点通过后' }],
})

export const WF_NODE_DEFS: WfNodeDef[] = [
  ...PF_NODE_DEFS,
  ...ARTIFACT_KINDS.map(artifactDef),
  ...Object.keys(GATE_DEFS).map(gateDef),
]

export function defForNode(node: { type: string; params: Record<string, unknown> }): WfNodeDef | undefined {
  if (node.type === 'artifact') {
    const k = ARTIFACT_KIND_MAP[String(node.params.kind ?? '')]
    return k ? artifactDef(k) : undefined
  }
  if (node.type === 'gate') {
    const g = String(node.params.gate ?? 'A')
    return GATE_DEFS[g] ? gateDef(g) : undefined
  }
  if (node.type === 'lane') {
    return { type: 'lane', label: '阶段泳道', group: '泳道', description: '', inputs: [], outputs: [] }
  }
  return WF_NODE_DEFS.find((d) => d.type === node.type && !d.artifactKind)
}

export const WF_NODE_DEF_MAP: Record<string, WfNodeDef> = Object.fromEntries(
  PF_NODE_DEFS.map((d) => [d.type, d]),
)

/* ── 图结构 ─────────────────────────────────────────────────────── */

export interface WfNodeInstance {
  id: string
  type: string
  position: { x: number; y: number }
  params: Record<string, unknown>
  parentId?: string
  width?: number
  height?: number
  hidden?: boolean
}

export interface WfEdgeInstance {
  id: string
  source: string
  sourcePort: string
  target: string
  targetPort: string
}

export interface WfGraph {
  nodes: WfNodeInstance[]
  edges: WfEdgeInstance[]
}

/** Token 项目被真实引用的素材 id（素材库数据层事实） */
export const TOKEN_ASSET_IDS: string[] = BUILTIN_ASSETS.filter((a) =>
  a.refs.some((r) => r.kind === 'project' && r.id === 'token'),
).map((a) => a.id)

/** Token 项目的真实原始需求（据项目既有口播稿与分镜整理，非虚构新写） */
export const TOKEN_PROMPT_TEXT =
  '做一条面向初学者的科普短片，讲清「Token 是什么」：从观众熟悉的日常感受切入，用比喻和画面讲清 Token 的定义、计费与上下文的含义；口播稿与分镜已有真实工程基线（73 段），画面以文字动效和图解为主。'

export function pfDefaultParams(type: string): Record<string, unknown> {
  switch (type) {
    case 'prompt':
      return { text: '', audience: '', duration: '', ratio: '16:9' }
    case 'refs':
      return { projectId: 'token', assetIds: [] as string[], refSegmentIds: [] as string[] }
    case 'lookdev':
      return { summary: '', status: 'draft' }
    case 'filmplan':
      return { summary: '', status: 'draft' }
    case 'capability':
      return { techniqueIds: [] as string[] }
    case 'create':
      return { mode: 'sketch', resolution: '1080p' }
    case 'review':
      return { issues: '', checks: {} as Record<string, boolean> }
    case 'finishing':
      return { notes: '' }
    default:
      return {}
  }
}

/** Prompt-first 主干图：提示词 → 创作与渲染 → 看片与修改 */
export function promptFirstGraph(presetId: string): WfGraph {
  const nodes: WfNodeInstance[] = [
    { id: 'n-prompt', type: 'prompt', position: { x: 60, y: 150 }, params: pfDefaultParams('prompt') },
    { id: 'n-create', type: 'create', position: { x: 430, y: 150 }, params: pfDefaultParams('create') },
    { id: 'n-review', type: 'review', position: { x: 800, y: 150 }, params: pfDefaultParams('review') },
  ]
  const edges: WfEdgeInstance[] = [
    { id: 'e1', source: 'n-prompt', sourcePort: 'doc', target: 'n-create', targetPort: 'prompt' },
    { id: 'e2', source: 'n-create', sourcePort: 'render', target: 'n-review', targetPort: 'render' },
  ]
  if (presetId === 'talking') {
    nodes[0].params = { ...nodes[0].params, text: TOKEN_PROMPT_TEXT, audience: 'AI 初学者', duration: '约 3 分钟' }
    nodes.push({
      id: 'n-refs',
      type: 'refs',
      position: { x: 60, y: 360 },
      params: { projectId: 'token', assetIds: [...TOKEN_ASSET_IDS], refSegmentIds: [] },
    })
    edges.push({ id: 'e3', source: 'n-refs', sourcePort: 'refs', target: 'n-create', targetPort: 'refs' })
  }
  return { nodes, edges }
}

/** Structured 骨架：第 0–7 阶段泳道 + 每阶段产物节点（状态 missing）+ 5 个 Gate 检查点 */
export function structuredGraph(): WfGraph {
  const nodes: WfNodeInstance[] = []
  const edges: WfEdgeInstance[] = []
  const laneW = 1020
  const laneH = 148
  const gap = 18
  const kindsByStage = new Map<number, ArtifactKindDef[]>()
  for (const k of ARTIFACT_KINDS) {
    const arr = kindsByStage.get(k.stage) ?? []
    arr.push(k)
    kindsByStage.set(k.stage, arr)
  }
  let prevOut: { id: string; port: string } | null = null
  const gateAfter = new Map<number, string>([
    [2, 'ref'],
    [3, 'A'],
    [4, 'B'],
    [5, 'C'],
    [7, 'D'],
  ])
  for (const stage of STRUCTURED_STAGES) {
    const y = 30 + stage.index * (laneH + gap)
    nodes.push({
      id: `lane-${stage.index}`,
      type: 'lane',
      position: { x: 30, y },
      params: { stage: stage.index, label: stage.label, question: stage.question, collapsed: false },
      width: laneW,
      height: laneH,
    })
    const kinds = kindsByStage.get(stage.index) ?? []
    kinds.forEach((k, i) => {
      const id = `a-${k.kind}`
      nodes.push({
        id,
        type: 'artifact',
        parentId: `lane-${stage.index}`,
        position: { x: 24 + i * 252, y: 44 },
        params: { kind: k.kind, status: 'missing', version: '', summary: '', fixture: false },
      })
      if (prevOut) {
        edges.push({ id: `e-${id}`, source: prevOut.id, sourcePort: prevOut.port, target: id, targetPort: 'in' })
      }
      prevOut = { id, port: 'out' }
    })
    const gate = gateAfter.get(stage.index)
    if (gate && prevOut) {
      const gid = `gate-${gate}`
      const gy = y + laneH + gap / 2 - 26
      nodes.push({
        id: gid,
        type: 'gate',
        position: { x: 816, y: gy },
        params: {
          gate,
          decision: 'not-started',
          recommendation: '',
          blocked: [] as string[],
          validFor: [] as string[],
          notApproved: [] as string[],
          source: 'live',
        },
      })
      edges.push({ id: `e-${gid}-in`, source: prevOut.id, sourcePort: prevOut.port, target: gid, targetPort: 'in' })
      prevOut = { id: gid, port: 'out' }
    }
  }
  return { nodes, edges }
}

/* ── 预设（题材）与目录 ────────────────────────────────────────── */

export interface WfPreset {
  id: string
  name: string
  description: string
  cover: string | null
  status: 'ready' | 'planned'
}

export const WF_PRESETS: WfPreset[] = [
  { id: 'general', name: '通用创作', description: '不预设题材，从你的提示词开始。', cover: null, status: 'ready' },
  { id: 'talking', name: '口播科普', description: '知识讲解类口播：已有 Token 科普视频真实工程作基线。', cover: './replica/gallery/explainer.webp', status: 'ready' },
  { id: 'interview', name: '对话访谈', description: '双人对话与字幕向预设（规划中）。', cover: './replica/gallery/chat.webp', status: 'planned' },
  { id: 'book', name: '讲书解读', description: '书籍内容拆解与讲述预设（规划中）。', cover: null, status: 'planned' },
  { id: 'product', name: '产品宣传', description: '产品卖点与画面编排预设（规划中）。', cover: './replica/gallery/promo.webp', status: 'planned' },
  { id: 'short', name: '短视频', description: '竖屏短视频预设（规划中）。', cover: './replica/gallery/short.webp', status: 'planned' },
  { id: 'long', name: '长视频', description: '长篇章节化预设（规划中）。', cover: './replica/gallery/long.webp', status: 'planned' },
]

export const TOKEN_BASELINE = {
  storyboardCount: STORYBOARD.length,
  assetCount: TOKEN_ASSET_IDS.length,
}
