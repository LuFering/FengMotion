/**
 * 工作流模板与节点定义（第一期）
 *
 * 定案（见 goals 文档《工作流定案-两轮对话结论》）：
 * · 六个模板只有「口播科普」真实可实例化——它的节点图对着仓库里真实的
 *   Token 科普视频工程（STORYBOARD 旁白/分镜、素材库真实引用）写；
 *   其余五个如实标 planned，不给假创建入口。
 * · 节点集严格 6 个；端口类型是前端领域类型，运行时映射冻结契约
 *   （TaskRequest / TaskRun / ChangeSet），不新增同名后端实体。
 */
import { STORYBOARD } from './productionData'
import { BUILTIN_ASSETS } from './myAssets'

export type WfPortType =
  | 'ScriptDoc'
  | 'MediaRefSet'
  | 'VoiceoverPlan'
  | 'ShotPlan'
  | 'TechniqueRefSet'
  | 'RemotionProjectSpec'

export interface WfPort {
  id: string
  type: WfPortType
  label: string
  required?: boolean
}

export interface WfNodeDef {
  type: string
  label: string
  group: '输入' | '处理' | '输出'
  description: string
  inputs: WfPort[]
  outputs: WfPort[]
}

export const WF_NODE_DEFS: WfNodeDef[] = [
  {
    type: 'script',
    label: '脚本输入',
    group: '输入',
    description: '口播脚本原文，整理为结构化脚本快照',
    inputs: [],
    outputs: [{ id: 'doc', type: 'ScriptDoc', label: '脚本文档' }],
  },
  {
    type: 'media',
    label: '素材引用',
    group: '输入',
    description: '引用素材库中的真实素材（只引用，不复制文件）',
    inputs: [],
    outputs: [{ id: 'media', type: 'MediaRefSet', label: '素材引用集' }],
  },
  {
    type: 'voiceover',
    label: '配音计划',
    group: '处理',
    description: '按脚本分段生成配音计划（不合成语音）',
    inputs: [
      { id: 'script', type: 'ScriptDoc', label: '脚本文档', required: true },
      { id: 'media', type: 'MediaRefSet', label: '已有音频（可选）' },
    ],
    outputs: [{ id: 'plan', type: 'VoiceoverPlan', label: '配音计划' }],
  },
  {
    type: 'shotplan',
    label: '分镜设计',
    group: '处理',
    description: '脚本与素材组织为分镜计划',
    inputs: [
      { id: 'script', type: 'ScriptDoc', label: '脚本文档', required: true },
      { id: 'media', type: 'MediaRefSet', label: '素材引用集', required: true },
    ],
    outputs: [{ id: 'plan', type: 'ShotPlan', label: '分镜计划' }],
  },
  {
    type: 'technique',
    label: '技法引用',
    group: '处理',
    description: '引用特效技法（只记录引用，不执行技法）',
    inputs: [{ id: 'shots', type: 'ShotPlan', label: '分镜计划（可选）' }],
    outputs: [{ id: 'tech', type: 'TechniqueRefSet', label: '技法引用集' }],
  },
  {
    type: 'compose',
    label: 'Remotion 合成',
    group: '输出',
    description: '汇总为合成清单 / 工程描述（demo 不渲染视频）',
    inputs: [
      { id: 'shots', type: 'ShotPlan', label: '分镜计划', required: true },
      { id: 'voice', type: 'VoiceoverPlan', label: '配音计划', required: true },
      { id: 'media', type: 'MediaRefSet', label: '素材引用集', required: true },
      { id: 'tech', type: 'TechniqueRefSet', label: '技法引用集（可选）' },
    ],
    outputs: [{ id: 'spec', type: 'RemotionProjectSpec', label: '工程描述' }],
  },
]

export const WF_NODE_DEF_MAP: Record<string, WfNodeDef> = Object.fromEntries(
  WF_NODE_DEFS.map((d) => [d.type, d]),
)

/** 端口类型色（节点与连线共用，三主题下靠色相+标签双通道区分） */
export const WF_PORT_COLORS: Record<WfPortType, string> = {
  ScriptDoc: '#8ab4ff',
  MediaRefSet: '#5ec8a7',
  VoiceoverPlan: '#e8b13c',
  ShotPlan: '#c792ea',
  TechniqueRefSet: '#f0718c',
  RemotionProjectSpec: '#3b8cf8',
}

export interface WfNodeInstance {
  id: string
  type: string
  position: { x: number; y: number }
  params: Record<string, unknown>
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

/** 口播脚本默认正文 = 真实工程 STORYBOARD 的旁白逐段拼接 */
export const TOKEN_SCRIPT_TEXT: string = STORYBOARD.map((s) => s.旁白).join('\n')

export function defaultParams(type: string): Record<string, unknown> {
  switch (type) {
    case 'script':
      return { title: 'Token 是什么 · 口播脚本', text: TOKEN_SCRIPT_TEXT }
    case 'media':
      return { projectId: 'token', assetIds: [...TOKEN_ASSET_IDS] }
    case 'voiceover':
      return { voiceLabel: '讲述声线（计划）', rate: '正常' }
    case 'shotplan':
      return { note: '基于 Token 科普视频真实工程分镜基线', refSegmentIds: [] as string[] }
    case 'technique':
      return { techniqueIds: [] as string[] }
    case 'compose':
      return { projectId: 'token', resolution: '1080p' }
    default:
      return {}
  }
}

function talkingExplainerGraph(): WfGraph {
  const nodes: WfNodeInstance[] = [
    { id: 'n-script', type: 'script', position: { x: 60, y: 90 }, params: defaultParams('script') },
    { id: 'n-media', type: 'media', position: { x: 60, y: 320 }, params: defaultParams('media') },
    { id: 'n-voice', type: 'voiceover', position: { x: 400, y: 60 }, params: defaultParams('voiceover') },
    { id: 'n-shots', type: 'shotplan', position: { x: 400, y: 280 }, params: defaultParams('shotplan') },
    { id: 'n-tech', type: 'technique', position: { x: 740, y: 300 }, params: defaultParams('technique') },
    { id: 'n-compose', type: 'compose', position: { x: 760, y: 90 }, params: defaultParams('compose') },
  ]
  const edges: WfEdgeInstance[] = [
    { id: 'e1', source: 'n-script', sourcePort: 'doc', target: 'n-voice', targetPort: 'script' },
    { id: 'e2', source: 'n-script', sourcePort: 'doc', target: 'n-shots', targetPort: 'script' },
    { id: 'e3', source: 'n-media', sourcePort: 'media', target: 'n-shots', targetPort: 'media' },
    { id: 'e4', source: 'n-media', sourcePort: 'media', target: 'n-compose', targetPort: 'media' },
    { id: 'e5', source: 'n-shots', sourcePort: 'plan', target: 'n-tech', targetPort: 'shots' },
    { id: 'e6', source: 'n-shots', sourcePort: 'plan', target: 'n-compose', targetPort: 'shots' },
    { id: 'e7', source: 'n-voice', sourcePort: 'plan', target: 'n-compose', targetPort: 'voice' },
    { id: 'e8', source: 'n-tech', sourcePort: 'tech', target: 'n-compose', targetPort: 'tech' },
  ]
  return { nodes, edges }
}

export interface WorkflowTemplate {
  id: string
  name: string
  category: string
  description: string
  status: 'ready' | 'planned'
  /** 可创建模板的真实来源说明；planned 为 null */
  sourceNote: string | null
  graph: WfGraph | null
  version: string
}

export const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  {
    id: 'tpl-talking-explainer',
    name: '口播科普',
    category: '口播',
    description: '一段口播脚本出发：配音计划 → 分镜设计 → 合成清单，适合知识讲解类短视频。',
    status: 'ready',
    sourceNote: `真实工程打底：Token 科普视频（${STORYBOARD.length} 段分镜 · ${TOKEN_ASSET_IDS.length} 项素材引用）`,
    graph: talkingExplainerGraph(),
    version: 'v1',
  },
  {
    id: 'tpl-interview',
    name: '对话访谈',
    category: '访谈',
    description: '双人对话剪辑与字幕流程。模板流程定义尚未建立。',
    status: 'planned',
    sourceNote: null,
    graph: null,
    version: '—',
  },
  {
    id: 'tpl-book-talk',
    name: '讲书解读',
    category: '讲书',
    description: '书籍内容拆解与讲述流程。模板流程定义尚未建立。',
    status: 'planned',
    sourceNote: null,
    graph: null,
    version: '—',
  },
  {
    id: 'tpl-product',
    name: '产品宣传',
    category: '宣传',
    description: '产品卖点与画面编排流程。模板流程定义尚未建立。',
    status: 'planned',
    sourceNote: null,
    graph: null,
    version: '—',
  },
  {
    id: 'tpl-short-video',
    name: '短视频',
    category: '短视频',
    description: '竖屏短视频快速生产流程。模板流程定义尚未建立。',
    status: 'planned',
    sourceNote: null,
    graph: null,
    version: '—',
  },
  {
    id: 'tpl-long-video',
    name: '长视频',
    category: '长视频',
    description: '长篇内容的章节化生产流程。模板流程定义尚未建立。',
    status: 'planned',
    sourceNote: null,
    graph: null,
    version: '—',
  },
]
