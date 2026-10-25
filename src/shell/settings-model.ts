import { HARNESSES } from '@/data/harnesses'

/**
 * 设置的数据模型与持久化 —— 从 SettingsScreen 拆出来单独成文件：
 * 组件文件只导出组件（react fast-refresh 规则），App 与壳层从这里拿类型与读写。
 *
 * 持久化：fengmotion:settings 全量 JSON；旧版只存过主题 key（fengmotion:theme），
 * 首次读取时迁移进来。
 */

export type ThemeId = 'dark' | 'light' | 'tactile'

export interface Settings {
  theme: ThemeId
  /** 打开应用默认进入的视图 */
  startView: 'home' | 'conversation'
  /** 减弱动效：压平全局动画与过渡（无障碍） */
  reduceMotion: boolean
  /** 新会话默认引擎（data/harnesses.ts 的 id） */
  harness: string
  /** 服务端点：演示态只存本机 */
  harnessEndpoint: string
  /** 默认模型（属于所选引擎的 models 列表） */
  model: string
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'dark',
  startView: 'home',
  reduceMotion: false,
  harness: 'deepseek',
  harnessEndpoint: 'http://127.0.0.1:8788/v1',
  model: 'deepseek-chat',
}

const STORE = 'fengmotion:settings'

/** 读取持久化设置；校验引擎/模型仍然存在（种子改名时自动回落） */
export function loadSettings(): Settings {
  let s = DEFAULT_SETTINGS
  try {
    const raw = localStorage.getItem(STORE)
    if (raw) {
      const v: unknown = JSON.parse(raw)
      if (v && typeof v === 'object') s = { ...DEFAULT_SETTINGS, ...(v as Partial<Settings>) }
    } else {
      const t = localStorage.getItem('fengmotion:theme')
      if (t === 'light' || t === 'tactile' || t === 'dark') s = { ...s, theme: t }
    }
  } catch { /* localStorage 不可用 → 默认值 */ }
  if (s.startView !== 'home' && s.startView !== 'conversation') s.startView = DEFAULT_SETTINGS.startView
  const h = HARNESSES.find((x) => x.id === s.harness) ?? HARNESSES[0]
  return {
    ...s,
    reduceMotion: typeof s.reduceMotion === 'boolean' ? s.reduceMotion : false,
    harness: h.id,
    model: h.models.includes(s.model) ? s.model : h.models[0],
  }
}

export function saveSettings(s: Settings) {
  try { localStorage.setItem(STORE, JSON.stringify(s)) } catch { /* 内存态即可 */ }
}

// ── 备份 / 恢复 ──────────────────────────────────────────────
/**
 * 备份文件格式。只导出**本应用的偏好类数据**（设置 + 每个模型的对话偏好），
 * 不含素材索引（IndexedDB 里的文件本体动辄上百 MB，塞进 JSON 不现实）。
 */
const BACKUP_APP = 'fengmotion-desktop'
const BACKUP_VERSION = 1

export interface SettingsBackup {
  app: string
  version: number
  exportedAt: string
  settings: Settings
  /** 对话选择器的每个模型偏好（harnesses.ts 的 fengmotion:model-prefs） */
  modelPrefs: unknown
}

export function exportSettings(settings: Settings): SettingsBackup {
  let modelPrefs: unknown = null
  try { modelPrefs = JSON.parse(localStorage.getItem('fengmotion:model-prefs') ?? 'null') } catch { /* 坏数据就留空 */ }
  return {
    app: BACKUP_APP,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    settings,
    modelPrefs,
  }
}

/** 把备份写成本地文件（真实下载，不是内存里的假动作） */
export function downloadBackup(settings: Settings): string {
  const data = exportSettings(settings)
  const text = JSON.stringify(data, null, 2)
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
  const name = `fengmotion-settings-${stamp}.json`
  const blob = new Blob([text], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
  return name
}

/**
 * 校验并应用一份备份。返回要应用的设置；不合法就抛错（调用方给用户看原因）。
 * ⚠️ 校验是必须的：文件来自外部，字段可能缺失/类型不对/引擎已不存在。
 */
export function readBackup(raw: string): { settings: Settings; modelPrefs: unknown } {
  let data: unknown
  try { data = JSON.parse(raw) } catch { throw new Error('不是合法的 JSON 文件') }
  const d = data as Partial<SettingsBackup> | null
  if (!d || typeof d !== 'object' || d.app !== BACKUP_APP) throw new Error('不是 FengMotion 的设置备份文件')
  if (typeof d.version !== 'number' || d.version > BACKUP_VERSION) {
    throw new Error('备份版本比当前应用新，请升级应用后再导入')
  }
  if (!d.settings || typeof d.settings !== 'object') throw new Error('备份里没有设置内容')
  const s = d.settings as Partial<Settings>
  const merged: Settings = {
    ...DEFAULT_SETTINGS,
    ...s,
    // 逐项收口：主题/视图/引擎必须落在已知取值里
    theme: s.theme === 'light' || s.theme === 'tactile' || s.theme === 'dark' ? s.theme : DEFAULT_SETTINGS.theme,
    startView: s.startView === 'conversation' ? 'conversation' : 'home',
    reduceMotion: s.reduceMotion === true,
    harnessEndpoint: typeof s.harnessEndpoint === 'string' ? s.harnessEndpoint : DEFAULT_SETTINGS.harnessEndpoint,
  }
  const h = HARNESSES.find((x) => x.id === merged.harness) ?? HARNESSES[0]
  return {
    settings: { ...merged, harness: h.id, model: h.models.includes(merged.model) ? merged.model : h.models[0] },
    modelPrefs: d.modelPrefs && typeof d.modelPrefs === 'object' ? d.modelPrefs : null,
  }
}

export function applyBackup(b: { settings: Settings; modelPrefs: unknown }) {
  saveSettings(b.settings)
  if (b.modelPrefs) {
    try { localStorage.setItem('fengmotion:model-prefs', JSON.stringify(b.modelPrefs)) } catch { /* 存不下就算了 */ }
  }
}

/** 清除对话模型偏好（回到 DEFAULT_PREFS）。返回是否真的清掉了。 */
export function clearModelPrefs(): boolean {
  try {
    const had = localStorage.getItem('fengmotion:model-prefs') !== null
    localStorage.removeItem('fengmotion:model-prefs')
    return had
  } catch { return false }
}
