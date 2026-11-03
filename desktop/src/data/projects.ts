import { PRODUCTION_FACTS } from '@/data/productionData'

/**
 * 项目目录 —— 一级界面的数据源。
 *
 * ⚠️ 现在磁盘上**只有一个真实项目**（/home/lufering/video-cut/token）。
 *    所以这里不编假项目：一个真项目 + 一个「新建」入口。
 *    将来接后端时，把这个数组换成 API 返回值即可（结构不变）。
 *
 * 每个字段都能追到真实来源：
 *   name/duration  PROGRESS.md（23 镜全绿，152.0s）
 *   clips          成片时间轴
 *   segments       V3 分镜段数
 *   compositions   film/compositions/*.html
 *   cover          成片抽帧
 */

export type ProjectStage = 'idea' | 'draft' | 'editing' | 'rendering' | 'done'

export interface ProjectSummary {
  id: string
  /** 项目名 —— 来自 meta.json 或 PROGRESS.md 标题 */
  name: string
  /** 一句话：这片子讲什么 */
  tagline: string
  stage: ProjectStage
  /** 成片时长（秒）。未排完的用目标时长 */
  duration: number
  /** 定稿镜数 */
  doneClips: number
  /** 分镜表规划的总镜数 */
  totalClips: number
  /** V3 分镜段数 */
  segments: number
  /** 合成文件数 —— 实际产出 */
  compositions: number
  /** 封面（成片抽帧） */
  cover: string
  /** 来源路径，给「在文件管理器中打开」用 */
  path: string
  /** 最后改动时间（ISO）—— 排序用 */
  updatedAt: string

  /** ⚠️ 演示新建出来的项目：**还没落盘**（内存里存在，磁盘上没目录）。界面必须标出来 */
  planned?: true
  /** 片型 id（GENOMES 六选一）—— planned 项目记录"要做哪一类" */
  genome?: string
  /** 目标时长（秒）—— planned 项目还没有成片 */
  targetDuration?: number
}

export const STAGE_LABEL: Record<ProjectStage, string> = {
  idea:      '构思',
  draft:     '草稿',
  editing:   '制作中',
  rendering: '渲染中',
  done:      '已完成',
}

export const PROJECTS: ProjectSummary[] = [
  {
    id: PRODUCTION_FACTS.activeFilmClipsSource ? 'token' : 'token',
    name: 'Token 科普视频',
    tagline: '黄仁勋两小时反复提的那个词，到底是什么',
    stage: 'done',
    duration: PRODUCTION_FACTS.timelineDuration,
    /** 23 镜全部定稿（PROGRESS.md：23/23，check 全绿） */
    doneClips: PRODUCTION_FACTS.progressDone,
    totalClips: PRODUCTION_FACTS.progressRecorded,
    segments: PRODUCTION_FACTS.storyboardSegments,
    compositions: PRODUCTION_FACTS.compositions,
    cover: './frames/film/s01.jpg',
    path: '/home/lufering/video-cut/token',
    updatedAt: '2026-10-08T04:49:00',
  },
]

/** 磁盘上的真实项目根目录 —— 新建项目时用它拼默认路径 */
export const PROJECTS_ROOT = '/home/lufering/video-cut'

/** 汇总数字给一级页头的统计用 */
export function catalogStats(list: ProjectSummary[]) {
  return {
    count: list.length,
    clips: list.reduce((n, p) => n + p.doneClips, 0),
    seconds: list.reduce((n, p) => n + p.duration, 0),
    compositions: list.reduce((n, p) => n + p.compositions, 0),
  }
}

/** 一个项目下的四个子视图 —— 导航、项目条、总览页共用这一张表（单一来源）
 *  state: ready = 有真界面 · todo = 还是占位页（界面上如实标"未实现"） */
export interface ProjectSubView {
  id: 'assets' | 'render'
  label: string
  icon: string
  state: 'ready' | 'todo'
  hint: string
}
export const PROJECT_SUBVIEWS: ProjectSubView[] = [
  { id: 'assets', label: '创作资产',   icon: 'image',       state: 'ready', hint: '素材、出处、许可、关联' },
  { id: 'render', label: '发布与验收', icon: 'upload',      state: 'ready', hint: '交付物、渲染任务、合成清单' },
]

/** 总览页头上那排数 —— 每个都能追到真实来源（PRODUCTION_FACTS / 成片时间轴）。
 *  planned 项目没有产物，全部报 "—"。 */
export function projectStats(p: ProjectSummary): { k: string; v: string }[] {
  if (p.planned) {
    return [
      { k: '场景', v: '—' },
      { k: '时长', v: p.targetDuration ? `目标 ${p.targetDuration}s` : '—' },
      { k: '分段', v: '—' },
      { k: '合成', v: '—' },
    ]
  }
  return [
    { k: '场景', v: `${p.doneClips}/${p.totalClips}` },
    { k: '时长', v: `${p.duration.toFixed(0)}s` },
    { k: '分段', v: String(p.segments) },
    { k: '合成', v: String(p.compositions) },
  ]
}

/** 相对时间（paba HM.dateFormat 的同义件）—— 项目卡与总览共用 */
export function fmtDate(iso: string) {
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
  if (d <= 0) return '今天'
  if (d === 1) return '昨天'
  if (d < 30) return `${d} 天前`
  return `${Math.floor(d / 30)} 个月前`
}
