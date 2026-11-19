import { type ThemeId, type WallpaperId, type WallpaperScope } from '@/features/settings/model/settings-model'

/** 主题样片的三条色带 = 各主题的 bg / surf / acc（设计常量，与 brand.css 一致） */
export const THEMES: Array<{ id: ThemeId; label: string; desc: string }> = [
  { id: 'dark', label: '深色', desc: '默认' },
  { id: 'light', label: '浅色', desc: '' },
  { id: 'tactile', label: '纸感', desc: '' },
]

/** 壁纸候选：id 与 wallpaper.css 的 data-wall 一一对应 */
export const WALLPAPERS: Array<{ id: WallpaperId; label: string }> = [
  { id: 'none', label: '默认背景' },
  { id: 'aurora', label: '极光' },
  { id: 'dusk', label: '暮色' },
  { id: 'paper', label: '纸纹' },
  { id: 'grid', label: '网格' },
]

/** 显示范围：按真实视图 id 匹配（global = 全部） */
export const SCOPES: Array<{ value: WallpaperScope; label: string }> = [
  { value: 'global', label: '全部页面' },
  { value: 'home', label: '仅首页' },
  { value: 'conversation', label: '仅我的创作' },
  { value: 'assets', label: '仅我的素材' },
  { value: 'production', label: '仅制作工作台' },
]

export const CONTEXTS = [32, 64, 128] as const

/** 「设置与偏好」占用量：真实量一下 localStorage 里的设置 JSON，不估算 */
export function settingsBytes(): number {
  try {
    const raw = localStorage.getItem('fengmotion:settings') ?? ''
    return Math.max(1, Math.ceil(new TextEncoder().encode(raw).byteLength / 1024))
  } catch { return 0 }
}
