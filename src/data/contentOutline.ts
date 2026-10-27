import type { AgentReference } from '@/services/studioApi'
import type { WorkflowDef, WorkflowRun } from '@/services/workflowService'

/** 内容行的引用只能是场景一种 —— 别的地方就不用再对联合类型做窄化了 */
export type SceneRef = Extract<AgentReference, { kind: 'scene' }>

/**
 * 左栏「内容」页要的行：整片之外，这部片真实有哪些内容单元。
 *
 * 规矩（作者定）：**有可靠结构才展示，没有就保留「整片」，不强行拆段。**
 * 所以这里不发明任何结构，只读工作流真的产出的产物（`run.artifacts[].content`），
 * 按 workflow-v5 里存在的产物形态认字段：
 *
 *   scene-spec     场景规格 —— `scenes[].from / durationInFrames`（配根上的 fps）
 *                              → 有真实时间，可定位
 *   scene-intents  场景意图 —— `scenes[].name` → 只有名字，不假装有时间
 *   film-plan      导演处理 —— `stages[]` 叙事阶段 → 只有名字
 *
 * 字段名照 `workflow-v5/`（`FIXTURES.md` 说夹具内容只管校验、不当模板；
 * 这里同样只认字段名，不认夹具内容）。
 *
 * ⚠️ 那条占位视频（`activeFilm.ts` 的 25 个片段、`productionData.ts` 的 UNITS+STORYBOARD、
 * `projectModel.ts` 的 152s 时间轴）**不是来源**：它的画面与结构都是虚构的。
 * 左边这一栏要显示的是「这部片有哪些画面」，不是「这次渲染切了几段」。
 *
 * 层级不固定三级：产物里嵌套几层就渲染几层（简单短片只有场景，多镜头才有镜头）。
 */

export type ContentRow = {
  id: string
  /** 缩进层级：场景 / 叙事阶段 = 1，镜头 = 2 */
  depth: number
  /** 行号（01、02…）。只给第一层编号 —— 它就是用户说「这一段」时指的名字 */
  index: string
  name: string
  /** 简短状态。取工作流里产物节点的状态，不自己编 */
  status: string
  /** 真实时间（秒）。只有产物里真的写了帧号/时长才有 */
  span?: { from: number; duration: number }
  /** 真实画面：产物里指到预览文件才有。没有就不渲染缩略图位，不拿空框占位 */
  thumb?: string
  /** 这一行自己声明要外部素材（不是程序化生成）时，把需求写出来。
      素材索引目前没有场景级关联，所以「需要什么」是这一行唯一能证实的信号 ——
      不去编「缺少哪张图」。 */
  needs?: string
  /** 点这一行时交给 AI 的范围 */
  ref: SceneRef
}

export type ContentOutline = {
  rows: ContentRow[]
  /** 结构从哪来；null = 没有可靠结构，只有整片 */
  source: 'scene-spec' | 'scene-intents' | 'film-plan' | null
}

/** 产物状态 → 给人看的话。词取自工作流编辑器里那张表，不另造一套 */
const STATUS_LABEL: Record<string, string> = {
  missing: '计划中', draft: '草稿', candidate: '候选', confirmed: '已确认',
}

type Json = Record<string, unknown>

const str = (v: unknown): string => (typeof v === 'string' && v.trim() ? v.trim() : '')
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const listOf = (v: unknown): Json[] =>
  Array.isArray(v) ? (v.filter((x) => x && typeof x === 'object') as Json[]) : []

function parseJson(text: string): Json | null {
  try {
    const parsed: unknown = JSON.parse(text)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Json) : null
  } catch {
    return null
  }
}

const nameOf = (o: Json, fallback: string): string =>
  str(o.name) || str(o.title) || str(o.label) || str(o.sceneId) || str(o.id) || fallback

/** 帧号 + fps → 秒。缺 fps 或帧号就不给时间：宁可没有，也不拿假时间凑 */
function spanOf(o: Json, fps: number | null): ContentRow['span'] {
  const from = num(o.from)
  const frames = num(o.durationInFrames)
  if (fps === null || from === null || frames === null) return undefined
  return { from: from / fps, duration: frames / fps }
}

/** 素材策略 → 缺什么。只认产物里真写了 strategy 的（procedural = 不需要外部素材） */
const NEED_LABEL: Record<string, string> = {
  'video-footage': '实拍 / 素材片段',
  footage: '实拍 / 素材片段',
  image: '图片素材',
  photo: '图片素材',
  audio: '音频',
  music: '音乐',
  'svg-asset': '矢量素材',
}

/** 子层：产物里叫 shots / scenes 的都认，认到什么渲染什么 */
const childrenOf = (o: Json): Json[] => [...listOf(o.shots), ...listOf(o.scenes)]

function rowsOf(items: Json[], depth: number, ctx: { fps: number | null; status: string; source: string; prefix: string }): ContentRow[] {
  const rows: ContentRow[] = []
  items.forEach((item, i) => {
    const id = `${ctx.source}:${str(item.sceneId) || str(item.id) || `${ctx.prefix}${i + 1}`}`
    const name = nameOf(item, `单位 ${i + 1}`)
    const index = depth === 1 ? String(i + 1).padStart(2, '0') : ''
    rows.push({
      id,
      depth,
      index,
      name,
      status: ctx.status,
      span: spanOf(item, ctx.fps),
      thumb: str(item.preview) || str(item.thumb) || undefined,
      needs: (() => {
        const strategy = str(item.assetStrategy)
        if (!strategy || strategy === 'procedural') return undefined
        return NEED_LABEL[strategy] ?? `外部素材（${strategy}）`
      })(),
      ref: {
        id: `scene:${id}`, role: 'target', kind: 'scene', sceneId: id,
        label: `${index ? `${index} ` : ''}${name}`,
      },
    })
    rows.push(...rowsOf(childrenOf(item), depth + 1, { ...ctx, prefix: `${ctx.prefix}${i + 1}-` }))
  })
  return rows
}

/**
 * 从项目的运行记录里读内容结构。最近的运行优先 —— 结构以最近一次产出为准。
 * 读不到就返回空行：调用方照「有可靠结构才展示」保留整片。
 */
export function contentOutline(workflows: WorkflowDef[], runs: WorkflowRun[]): ContentOutline {
  const ids = new Set(workflows.map((w) => w.id))
  const mine = runs.filter((r) => ids.has(r.workflowId))
  for (const run of mine) {
    /* 一个运行里的产物按「谁更像内容结构」排序：场景规格 > 场景意图 > 叙事阶段 */
    const ranked = [...run.artifacts].sort((a, b) => rank(b) - rank(a))
    for (const art of ranked) {
      const json = parseJson(art.content)
      if (!json) continue
      const fps = num(json.fps)
      const scenes = listOf(json.scenes)
      const stages = listOf(json.stages)
      const node = workflows.find((w) => w.id === run.workflowId)?.nodes.find((n) => n.id === art.nodeId)
      const status = STATUS_LABEL[String(node?.params.status ?? '')] ?? '草稿'
      if (scenes.length && scenes.some((s) => num(s.from) !== null)) {
        return { rows: rowsOf(scenes, 1, { fps, status, source: 'scenes', prefix: 's' }), source: 'scene-spec' }
      }
      if (scenes.length) return { rows: rowsOf(scenes, 1, { fps: null, status, source: 'scenes', prefix: 's' }), source: 'scene-intents' }
      if (stages.length) return { rows: rowsOf(stages, 1, { fps: null, status, source: 'stages', prefix: 'n' }), source: 'film-plan' }
    }
  }
  return { rows: [], source: null }
}

/** scene-spec 的 `type` 最明确；没有 type 就看有没有帧号 —— 有帧号的那份更能算结构 */
function rank(art: WorkflowRun['artifacts'][number]): number {
  const json = parseJson(art.content)
  if (!json) return 0
  let score = 1
  if (str(json.type) === 'scene-spec') score += 2
  if (listOf(json.scenes).some((s) => num(s.from) !== null)) score += 2
  if (str(art.kind) === 'scene-spec' || art.filename.includes('scene')) score += 1
  return score
}
