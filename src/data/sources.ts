/**
 * 知识源 —— 「导入进来的东西」的台账。
 *
 * 四条真实来源（来自 data/knowledge 的 SOURCES 与卡库/判例/流程的共同出处）。
 * 用户新导入的条目只存在内存里（本次会话），**没落盘** —— 界面必须标出来。
 *
 * ⚠️ 解析（skill 解析 / 视频解析）是后端能力，**当前未接入**：
 *    新导入的条目一律落在 pending（待解析），界面上如实写「等后端」，
 *    不模拟进度条 —— 假的进度比没有更糟。
 */

export type SourceKind = 'skill' | 'url' | 'video'

/** 一条来源解析出了什么（数字全部可点，跳到对应的库） */
export interface Yields {
  cards?: number
  rules?: number
  methods?: number
  clips?: number
  shots?: number
  /** 产物里不适合用数字说的那部分 */
  note?: string
}

export type SourceStatus = 'ready' | 'pending' | 'disabled'

export interface KSource {
  id: string
  kind: SourceKind
  name: string
  /** 网址 / 文件名 */
  ref?: string
  /** 一句话说这条来源是什么（列表里不铺开） */
  what: string
  status: SourceStatus
  yields: Yields
  /** 已入库的条目带 logo（外链库有）；新导入的没有 */
  logo?: string
  tone?: string
  /** 新导入的文件才有 */
  size?: number
  /** 视频文件能读到的真实时长（秒）—— 浏览器端读，不需要后端 */
  duration?: number
  addedAt?: string
}

export const KIND_CN: Record<SourceKind, string> = {
  skill: 'skill 包',
  url: '网址',
  video: '参考视频',
}

/** 已入库的四条来源 */
export const SEED_SOURCES: KSource[] = [
  {
    id: 'shotcraft',
    kind: 'skill',
    name: '镜刻',
    ref: 'video-shotcraft',
    what: '镜头配方卡 + 动态样片画廊，卡上有调校参数与已知坑',
    status: 'ready',
    logo: '/assets/partners/shotcraft.svg',
    tone: '#D3923C',
    yields: { cards: 157, rules: 27, methods: 1, note: '214 条样片' },
    addedAt: '2026-09-01',
  },
  {
    id: 'scenes',
    kind: 'url',
    name: 'Remotion Scenes',
    ref: 'lifeprompt-team.github.io/remotion-scenes',
    what: '带源码的场景组件库，逐条可在线预览',
    status: 'ready',
    logo: '/assets/partners/scenes.svg',
    tone: '#6366F1',
    yields: { note: '201 个场景 · 16 类' },
    addedAt: '2026-09-04',
  },
  {
    id: 'rve',
    kind: 'url',
    name: 'React Video Editor',
    ref: 'reactvideoeditor.com',
    what: '零依赖单文件模板，复制即用',
    status: 'ready',
    logo: '/assets/partners/rve.svg',
    tone: '#3D4BE0',
    yields: { note: '81 个模板 · 9 类' },
    addedAt: '2026-09-04',
  },
  {
    id: 'reffilms',
    kind: 'video',
    name: '参考片拆解',
    ref: '3 个实测画像 · 3 套片型规格',
    what: '3 段参考片量出来的实测指纹（ASL / 出镜占比 / 锚点回归 / 暗部落点 / 响度），另加 3 套片型规格',
    status: 'ready',
    yields: { clips: 3, note: '3 套片型规格 · 6 套做法' },
    addedAt: '2026-09-08',
  },
]

/** 产物数字 → 一句话（列表里只显示这个，不铺开） */
export function yieldsLine(y: Yields): string {
  const parts: string[] = []
  if (y.cards) parts.push(`${y.cards} 卡`)
  if (y.rules) parts.push(`${y.rules} 判例`)
  if (y.methods) parts.push(`${y.methods} 流程`)
  if (y.clips) parts.push(`${y.clips} 段`)
  if (y.shots) parts.push(`${y.shots} 镜`)
  if (y.note) parts.push(y.note)
  return parts.join(' · ')
}

export const STATUS_CN: Record<SourceStatus, string> = {
  ready: '已解析',
  pending: '待解析',
  disabled: '已停用',
}

/**
 * 内置来源（随仓库一起来的预置数据）不是"本次解析出来的"——
 * 直接标成"已解析"是在说谎，所以它有自己的状态词。
 */
const SEED_IDS = new Set(SEED_SOURCES.map((s) => s.id))
export const isBuiltin = (id: string) => SEED_IDS.has(id)

export function statusLabel(s: KSource): string {
  if (s.status === 'pending') return '待解析'
  if (s.status === 'disabled') return '已停用'
  return isBuiltin(s.id) ? '内置 · 已确认' : '已解析'
}

export function fmtSize(bytes?: number): string {
  if (!bytes) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function fmtDur(sec?: number): string {
  if (!sec || !isFinite(sec)) return '—'
  const m = Math.floor(sec / 60)
  const s = Math.round(sec % 60)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

/** 按后缀猜这条来源是什么类型（选文件时用） */
export function guessKind(name: string): SourceKind {
  return /\.(mp4|mov|mkv|webm|avi|m4v)$/i.test(name) ? 'video' : 'skill'
}

/** 在浏览器里读一个视频文件的真实时长（不需要后端） */
export function readVideoDuration(file: File): Promise<number> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const v = document.createElement('video')
    v.preload = 'metadata'
    v.onloadedmetadata = () => { URL.revokeObjectURL(url); resolve(v.duration || 0) }
    v.onerror = () => { URL.revokeObjectURL(url); resolve(0) }
    v.src = url
  })
}
