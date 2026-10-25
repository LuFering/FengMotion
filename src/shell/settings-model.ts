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
  /** 新会话默认引擎（data/harnesses.ts 的 id） */
  harness: string
  /** 服务端点：演示态只存本机 */
  harnessEndpoint: string
  /** 默认模型（属于所选引擎的 models 列表） */
  model: string
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'dark',
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
  const h = HARNESSES.find((x) => x.id === s.harness) ?? HARNESSES[0]
  return { ...s, harness: h.id, model: h.models.includes(s.model) ? s.model : h.models[0] }
}

export function saveSettings(s: Settings) {
  try { localStorage.setItem(STORE, JSON.stringify(s)) } catch { /* 内存态即可 */ }
}
