import type { WfArtifact, WorkflowDef, WorkflowRun } from '@/services/workflowService'

/**
 * 工作区中间那块「画面」此刻该是什么形态。
 *
 * 依据《产品体验与工作流说明》§5：
 *   工作台里可能出现一张测试帧、几秒局部试片、粗略整片预览，也可能暂时没有画面。
 *   这些是制作中可能出现的真实结果，不是每个项目都必须按顺序通过的审批页。
 *
 * 规矩：
 *   · 形态只从**本次制作**的产物里推，产物没指到文件就没有画面 —— 不拿别的片子顶。
 *   · 不做「阶段进度条」：材料明确说这不是必须依次通过的审批页，
 *     所以这里只报「有没有画面、是哪一档」，不报「你走到第几关了」。
 *   · 优先显示最近一次产出画面的运行；同一次运行内按整片 > 试片 > 测试帧排序，
 *     更早的结果仍留在预览记录中回看。
 *
 * ⚠️ 那条占位成片（token-full-legacy.mp4）不是来源：它属于「上一次制作留下的文件」，
 * 在素材库里能查到，但这次制作没有产出画面时，中间区域必须说「还没画面」。
 */

/** 画面档位；同一次运行内按「离成片有多近」排序。 */
export type StageTier = 'final' | 'animatic' | 'proof' | 'frame'

export const TIER_LABEL: Record<StageTier, string> = {
  final: '整片预览',
  animatic: '粗略整片',
  proof: '局部试片',
  frame: '测试帧',
}

/** 档位 → 产物 kind。只认 workflow-v5 真有的产物类型，不发明新的。 */
const TIER_OF_KIND: Record<string, StageTier> = {
  delivery: 'final',
  animatic: 'animatic',
  passes: 'animatic',
  'proof-10s': 'proof',
  'direction-samples': 'frame',
  'scene-layouts': 'frame',
}

const TIER_RANK: Record<StageTier, number> = { final: 4, animatic: 3, proof: 2, frame: 1 }

/** 能从产物里读出来的一张画面 / 一段片 */
export interface StageVisual {
  assetId?: string
  origin?: 'editor' | 'workflow'
  id: string
  tier: StageTier
  /** 这是哪一档（测试帧 / 局部试片 / 粗略整片 / 整片预览） */
  tierLabel: string
  /** 画面自己的名字。产物里没写名字就用产物标题 —— 不编「第 N 场」 */
  name: string
  media: 'video' | 'image'
  /** 相对路径（产物里写的就是相对路径） */
  file: string
  /** 来自哪次运行、哪个产物 */
  runId: string
  artifactId: string
  workflowId: string
  revision: number
  createdAt: string
  artifactKind: string
  /** 这一档可能是旧版本：交付产物标了 stale 的，画面就不是最新的 */
  stale: boolean
}

/** 一次制作到目前为止有没有画面、有哪些画面。 */
export interface StageState {
  /** 由近到远的候选（先按运行时间，再按同次运行的档位排序），第一个就是中间区域默认显示的。 */
  visuals: StageVisual[]
  /** 有没有任何一次运行 —— 没有运行 = 还没开始，不是「做完了没画面」 */
  hasRun: boolean
  /** 最近一次运行的状态。空态文案按它分：没跑过 / 正在跑 / 跑完没出画面 */
  lastRunStatus: 'none' | 'running' | 'completed' | 'failed' | 'cancelled'
  /** 最近一次运行产出的、不含画面的东西（如渲染请求记录）—— 空态如实说明它不产生视频 */
  requestOnly: boolean
}

type Json = Record<string, unknown>

function parse(text: string): Json | null {
  try {
    const v: unknown = JSON.parse(text)
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : null
  } catch {
    return null
  }
}

const filesOf = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '') : []

const VIDEO_RE = /\.(mp4|mov|webm|m4v)$/i

/** 一个产物能提供哪些画面。只认产物里真的指到文件的字段（images / video / file）。 */
function visualsOf(art: WfArtifact, tier: StageTier, run: WorkflowRun, stale: boolean): StageVisual[] {
  const json = parse(art.content)
  if (!json) return []
  const files = [...filesOf(json.images), ...filesOf(json.frames)]
  if (typeof json.video === 'string' && json.video.trim()) files.push(json.video)
  if (typeof json.file === 'string' && json.file.trim()) files.push(json.file)
  const seen = new Set<string>()
  return files
    .filter((f) => /\.(mp4|mov|webm|m4v|png|jpe?g|webp|gif|avif|svg)$/i.test(f))
    .filter((f) => (seen.has(f) ? false : (seen.add(f), true)))
    .map((f) => ({
      id: `${art.id}:${f}`,
      tier,
      tierLabel: TIER_LABEL[tier],
      name: f.split('/').pop() ?? f,
      media: VIDEO_RE.test(f) ? ('video' as const) : ('image' as const),
      file: f,
      runId: run.id,
      artifactId: art.id,
      workflowId: run.workflowId,
      revision: run.revision,
      createdAt: run.finishedAt ?? run.startedAt,
      artifactKind: art.kind,
      stale,
    }))
}

/**
 * 从工作流的运行记录里读「这次制作做到哪一档」。
 *
 * `workflows` 已按项目筛过；`runs` 不限，这里自己按 workflowId 过滤。
 * 显式按运行开始时间倒序，不依赖调用方传入记录的顺序。
 */
export function stageState(workflows: WorkflowDef[], runs: WorkflowRun[]): StageState {
  const mine = new Set(workflows.map((w) => w.id))
  const projectRuns = runs.filter((r) => mine.has(r.workflowId)).sort((a, b) => b.startedAt.localeCompare(a.startedAt))
  const last = projectRuns[0] ?? null
  if (!projectRuns.length) {
    return { visuals: [], hasRun: false, lastRunStatus: 'none', requestOnly: false }
  }

  const visuals: StageVisual[] = []
  // 最新一次有画面的运行优先；同次运行内再按档位排序。
  for (const run of projectRuns) {
    const inRun: StageVisual[] = []
    for (const art of run.artifacts) {
      const tier = TIER_OF_KIND[art.kind]
      if (!tier) continue
      const node = workflows.find((w) => w.id === run.workflowId)?.nodes.find((n) => n.id === art.nodeId)
      const stale = node?.params.stale === true || node?.params.status === 'stale'
      inRun.push(...visualsOf(art, tier, run, stale))
    }
    inRun.sort((a, b) => TIER_RANK[b.tier] - TIER_RANK[a.tier])
    visuals.push(...inRun)
  }

  const status = last.status
  const runStatus: StageState['lastRunStatus'] =
    status === 'running' || status === 'queued' || status === 'building' ? 'running'
      : status === 'completed' ? 'completed'
      : status === 'failed' ? 'failed' : 'cancelled'

  /* 跑完了、有产物、但没有任何产物指到画面 —— 那多半只产出了请求记录。
     这不是失败，要如实说清楚「没有视频生成」，不能让用户等一个不会来的画面。 */
  const requestOnly = status === 'completed' && last.artifacts.length > 0 && visuals.length === 0

  return { visuals, hasRun: true, lastRunStatus: runStatus, requestOnly }
}
