import type { TaskRequest } from './studioApi'

export interface BriefCorrection { id: string; text: string; createdAt: string }
export interface CreativeBriefSnapshot { original: string; corrections: BriefCorrection[]; keepNotes: string }
export interface ReviewOpinion {
  id: string
  createdAt: string
  request: TaskRequest
  status: 'open' | 'resolved'
  resolvedAt?: string
  reviewedVisualId?: string
}
export interface WorkbenchReviewState extends CreativeBriefSnapshot { opinions: ReviewOpinion[] }
const key = (projectId: string) => `fengmotion:review:v1:${projectId}`
const empty = (): WorkbenchReviewState => ({ original: '', corrections: [], keepNotes: '', opinions: [] })
export function readWorkbenchReview(projectId: string): WorkbenchReviewState {
  try {
    const value = JSON.parse(localStorage.getItem(key(projectId)) ?? 'null') as Partial<WorkbenchReviewState> | null
    if (!value || typeof value.original !== 'string' || !Array.isArray(value.corrections) || !Array.isArray(value.opinions)) return empty()
    return {
      original: value.original,
      keepNotes: typeof value.keepNotes === 'string' ? value.keepNotes : '',
      corrections: value.corrections.filter((c) => typeof c?.id === 'string' && typeof c.text === 'string' && typeof c.createdAt === 'string'),
      opinions: value.opinions.filter((o) => typeof o?.id === 'string' && typeof o.createdAt === 'string' && typeof o.request?.prompt === 'string' && o.request.projectId === projectId && (o.status === 'open' || o.status === 'resolved') && o.request.constraints && Array.isArray(o.request.references)),
    }
  } catch { return empty() }
}
export function saveWorkbenchReview(projectId: string, state: WorkbenchReviewState): boolean {
  try { localStorage.setItem(key(projectId), JSON.stringify(state)); return true } catch { return false }
}
export function newReviewId() { return crypto.randomUUID() }

/* ── 「这次改了什么」：把每一轮的真实输入差异算出来 ──────────────
   为什么要单独算：说明文档第 8 节要求双方知道「上一版是什么、这次改了什么、
   哪些决定要保留」。演示执行器**不写文件、不产预览**，所以这里绝不编造文件
   改动清单 —— 只归纳真实存在的东西：这一轮指了哪份画面、时间与区域、
   文字意见、保留条件，以及它们跟上一轮比变了什么。

   放在服务层而不是视图里：视图只渲染，数据一律经 services/ 取
   （docs/dev/前后端协议.md 第 1 条）。 */

export interface RoundTarget {
  /** 引用里的预览名（不含本轮时间/区域的后缀信息） */
  label: string
  timeSeconds?: number
  endTimeSeconds?: number
  bbox?: { x: number; y: number; w: number; h: number }
  /** 这一版是编辑版本还是工作流产物，以及第几版 */
  revision?: number
  origin?: 'editor' | 'workflow'
}

/** 与上一轮相比的一项输入差异 */
export interface RoundDelta {
  key: 'target' | 'time' | 'region' | 'prompt' | 'brief'
  before: string
  after: string
  changed: boolean
}

export interface RoundSummary {
  id: string
  createdAt: string
  /** 第一轮：没有上一轮可比，界面不要写「没变」当成对比结论 */
  isFirstRound: boolean
  /** 这一轮针对的画面版本（上一版是什么）；读不到就是 null，不猜 */
  preview: RoundTarget | null
  /** 本轮意见原文 */
  prompt: string
  /** 与上一轮相比的输入差异 */
  deltas: RoundDelta[]
  /** 本轮开启的保留条件（键名；中文标签由界面映射） */
  constraintsOn: string[]
  constraintsAdded: string[]
  constraintsRemoved: string[]
  /** target 之外的引用条数（上下文：参考、素材） */
  contextCount: number
}

const CONSTRAINT_KEYS = ['preserveCamera', 'preserveCaptions', 'limitToSelection', 'reuseExistingComponents', 'preserveOutsideSelection'] as const

const fmtTime = (seconds?: number) => (typeof seconds === 'number' ? `${seconds.toFixed(3)} 秒` : '未给出')
const fmtRegion = (bbox?: { x: number; y: number; w: number; h: number }) =>
  bbox ? `x ${(bbox.x * 100).toFixed(1)}% · y ${(bbox.y * 100).toFixed(1)}% · 宽 ${(bbox.w * 100).toFixed(1)}% · 高 ${(bbox.h * 100).toFixed(1)}%` : '未框选'

/** 预览引用的来源信息：只读真实字段，读不到就不写 */
function targetOf(request: TaskRequest): RoundTarget | null {
  const ref = request.references?.find((item) => item.role === 'target')
  if (!ref || ref.kind !== 'preview') return null
  return {
    label: ref.label,
    timeSeconds: ref.timeSeconds,
    endTimeSeconds: ref.endTimeSeconds,
    bbox: ref.bbox,
    revision: ref.source?.revision,
    origin: ref.source?.origin,
  }
}

function targetLabel(target: RoundTarget | null): string {
  return target ? target.label : '整个项目'
}

function briefText(request: TaskRequest): string {
  const brief = request.creativeBrief
  if (!brief) return '无需求快照'
  const parts = [`纠正 ${brief.corrections.length} 条`]
  if (brief.original) parts.push(`原文 ${brief.original.length} 字`)
  parts.push(brief.keepNotes ? `有特别保留要求` : `无特别保留要求`)
  return parts.join(' · ')
}

function constraintsOf(request: TaskRequest): string[] {
  const bag = request.constraints as unknown as Record<string, unknown>
  return CONSTRAINT_KEYS.filter((key) => bag[key] === true)
}

/** 按「最近一轮在前」的顺序归纳；opinions 本身就是这个顺序。 */
export function summarizeRounds(opinions: ReviewOpinion[]): RoundSummary[] {
  return opinions.map((opinion, index) => {
    const previous = opinions[index + 1] ?? null
    const now = targetOf(opinion.request)
    const before = previous ? targetOf(previous.request) : null

    const deltas: RoundDelta[] = [
      { key: 'target', before: previous ? targetLabel(before) : '（还没有上一轮）', after: targetLabel(now), changed: !previous || targetLabel(before) !== targetLabel(now) },
      { key: 'time', before: previous ? fmtTime(before?.timeSeconds) : '（还没有上一轮）', after: fmtTime(now?.timeSeconds), changed: !previous || fmtTime(before?.timeSeconds) !== fmtTime(now?.timeSeconds) },
      { key: 'region', before: previous ? fmtRegion(before?.bbox) : '（还没有上一轮）', after: fmtRegion(now?.bbox), changed: !previous || fmtRegion(before?.bbox) !== fmtRegion(now?.bbox) },
      { key: 'prompt', before: previous ? previous.request.prompt : '（还没有上一轮）', after: opinion.request.prompt, changed: !previous || previous.request.prompt !== opinion.request.prompt },
      { key: 'brief', before: previous ? briefText(previous.request) : '（还没有上一轮）', after: briefText(opinion.request), changed: !previous || briefText(previous.request) !== briefText(opinion.request) },
    ]

    const on = constraintsOf(opinion.request)
    const onBefore = previous ? constraintsOf(previous.request) : []

    return {
      id: opinion.id,
      createdAt: opinion.createdAt,
      isFirstRound: !previous,
      preview: now,
      prompt: opinion.request.prompt,
      deltas,
      constraintsOn: on,
      constraintsAdded: previous ? on.filter((key) => !onBefore.includes(key)) : [],
      constraintsRemoved: previous ? onBefore.filter((key) => !on.includes(key)) : [],
      contextCount: (opinion.request.references ?? []).filter((ref) => ref.role === 'context').length,
    }
  })
}
