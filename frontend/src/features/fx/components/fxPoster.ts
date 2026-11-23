import { originalSceneLoader } from '@/features/fx/components/fxOriginalRegistry'
import type { FxTechnique } from '@/features/fx/model/fxTechniques'

export type OriginalPosterMap = Record<string, { file: string; frame: number; frameSource: string; checksum: string }>

/**
 * 技法画面：卡片与详情共用同一张，避免「卡片有图、打开详情没图」。
 * 有原始场景封面时用它（与悬停播放的原片同一画面），否则用后端的 previewImageUrl；
 * 两者都没有返回空串，由调用方如实显示「暂无预览」。
 */
export function resolvePoster(t: FxTechnique, posters: OriginalPosterMap): string {
  const hasOriginal = Boolean(originalSceneLoader(t.sourceProject, t.sourcePath))
  const original = hasOriginal && t.sourcePath ? posters[t.sourcePath] : undefined
  if (original && /^[a-f0-9]{20}\.jpg$/.test(original.file)) {
    return `${import.meta.env.BASE_URL}fx-original-posters/${original.file}?v=${encodeURIComponent(original.checksum || '')}`
  }
  return t.previewImage || ''
}
