/**
 * 假数据 —— 静态原型阶段用。
 *
 * 数据形态参照 video-cut/token 的真实产物：
 * - 分镜来自 PROGRESS.md 的 23 镜状态表
 * - 缩略帧来自 film/preview/ 的真实抽帧（不是色块）
 * - 素材来自 assets/people（带 SOURCES.md 出处）
 * - 卡点来自 airemotion 的四段式流程
 *
 * ⚠️ 这一层将来会被后端替换。保持字段名中性。
 */

// ── 真实制作数据：分镜表、PROGRESS.md、film 时间轴与合成标题 ─────
export { UNITS, STORYBOARD, WORKFLOW_STEPS, PRODUCTION_FACTS } from '@/data/productionData'
export type { Unit, UnitStatus, StoryboardEntry } from '@/data/productionData'

// ── 素材台账 ────────────────────────────────────────────────
export interface Asset {
  id: string
  name: string
  kind: 'image' | 'font' | 'audio' | 'video' | 'doc'
  source: string
  license: string
  attribution: boolean
  commercial: boolean
  usedIn: string[]
}

export const ASSETS: Asset[] = [
  { id: 'a1',  name: 'jensen.jpg',              kind: 'image', source: 'Wikimedia Commons', license: 'CC BY-SA 4.0', attribution: true,  commercial: true,  usedIn: ['u09', 'u10'] },
  { id: 'a2',  name: 'altman.jpg',              kind: 'image', source: 'Wikimedia Commons', license: 'CC BY 4.0',    attribution: true,  commercial: true,  usedIn: ['u02'] },
  { id: 'a3',  name: 'musk.jpg',                kind: 'image', source: 'Wikimedia Commons', license: 'CC BY-SA 4.0', attribution: true,  commercial: true,  usedIn: ['u02'] },
  { id: 'a4',  name: 'nadella.jpg',             kind: 'image', source: 'Wikimedia Commons', license: 'CC BY 4.0',    attribution: true,  commercial: true,  usedIn: ['u02'] },
  { id: 'a5',  name: 'pichai.jpg',              kind: 'image', source: 'Wikimedia Commons', license: 'CC BY 4.0',    attribution: true,  commercial: true,  usedIn: ['u02'] },
  { id: 'a6',  name: 'big-shoulders-800.woff2', kind: 'font',  source: 'Google Fonts',      license: 'OFL 1.1',      attribution: false, commercial: true,  usedIn: ['u01', 'u03', 'u08'] },
  { id: 'a7',  name: 'noto-sans-sc-900.woff2',  kind: 'font',  source: 'Google Fonts',      license: 'OFL 1.1',      attribution: false, commercial: true,  usedIn: ['全部'] },
  { id: 'a8',  name: 'plex-mono-500.woff2',     kind: 'font',  source: 'IBM',               license: 'OFL 1.1',      attribution: false, commercial: true,  usedIn: ['u05', 'u06'] },
  { id: 'a9',  name: 'tv-off.wav',              kind: 'audio', source: '自制',              license: 'CC0',          attribution: false, commercial: true,  usedIn: ['u23'] },
  { id: 'a10', name: 'intro.mp4',               kind: 'video', source: '自制',              license: 'CC0',          attribution: false, commercial: true,  usedIn: ['u12'] },
  { id: 'a11', name: '拆解报告 round2',         kind: 'doc',   source: '内部研究',          license: '仅内部',       attribution: false, commercial: false, usedIn: [] },
]

// ── 项目活动：只取制作状态表中已有的确切进度 ────────────────
export type TaskStatus = 'done' | 'running' | 'waiting' | 'failed'

export interface Task {
  id: string
  title: string
  status: TaskStatus
  unit?: string
  detail: string
}

export const TASKS: Task[] = [
  { id: 't1', title: '23 镜制作', status: 'done', detail: 'PROGRESS.md：23/23 全部完成' },
  { id: 't2', title: '代码检查', status: 'done', detail: 'check 全绿（0 errors）' },
  { id: 't3', title: '主体口播录音', status: 'waiting', detail: '尚未提供' },
  { id: 't4', title: '尾音轨（BGM / 音效）', status: 'waiting', detail: '全片做完后补' },
]

// ── 项目 ────────────────────────────────────────────────────
export const PROJECT = {
  name: 'Token · CRT 关机衔接',
  fps: 30,
  width: 1920,
  height: 1080,
  totalDuration: 152.0,
  doneCount: 23,
  totalCount: 23,
}
