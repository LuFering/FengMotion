import { LICENSE_LABEL, MEDIA_LABEL, REVIEW_LABEL, SOURCE_LABEL, type MediaType, type MyAsset } from '@/features/assets/model/myAssets'
import { formatBytes, formatDur } from '@/features/assets/services/assetApiService'

export type SortKey = 'recent' | 'used' | 'name' | 'size' | 'duration'

export const SORT_LABEL: Record<SortKey, string> = {
  recent: '最近导入', used: '最近使用', name: '名称', size: '大小', duration: '时长',
}

export const TYPE_IDS: MediaType[] = ['image', 'video', 'audio', 'font', 'doc']

/**
 * 网格里只显示「需要有人处理」的异常状态。
 * 待审核是生成结果的默认状态，不逐格重复；它在组织栏、列表审核列、检查器和状态栏里可见。
 */
export function assetFlag(a: MyAsset): { label: string; tone: 'warn' | 'bad' } | null {
  if (a.licenseStatus === 'restricted') return { label: LICENSE_LABEL.restricted, tone: 'bad' }
  if (a.licenseStatus === 'unknown') return { label: LICENSE_LABEL.unknown, tone: 'warn' }
  if (a.reviewStatus === 'needs_review') return { label: REVIEW_LABEL.needs_review, tone: 'warn' }
  if (a.licenseStatus === 'attribution_required') return { label: LICENSE_LABEL.attribution_required, tone: 'warn' }
  return null
}

/** 卡片第二行：媒体属性优先（时长 / 尺寸），来源留给列表和检查器 */
export function cardSpec(a: MyAsset): string {
  if (a.mediaType === 'video') {
    return [a.duration != null ? formatDur(a.duration) : null,
            a.width != null ? `${a.width}×${a.height}` : null].filter(Boolean).join(' · ')
  }
  if (a.mediaType === 'audio') return a.duration != null ? `音频 · ${formatDur(a.duration)}` : '音频'
  if (a.mediaType === 'image') {
    return [a.width != null ? `${a.width}×${a.height}` : null, formatBytes(a.sizeBytes)]
      .filter(Boolean).join(' · ')
  }
  return `${MEDIA_LABEL[a.mediaType]} · ${formatBytes(a.sizeBytes)}`
}

export function listSpec(a: MyAsset): string {
  if (a.mediaType === 'video' || a.mediaType === 'audio') return formatDur(a.duration)
  if (a.width != null && a.height != null) return `${a.width}×${a.height}`
  return '—'
}

export function fullMeta(a: MyAsset): string {
  const dims = a.width != null ? ` · ${a.width}×${a.height}` : ''
  return `${a.name}\n${SOURCE_LABEL[a.sourceType]} · ${formatBytes(a.sizeBytes)}${dims}\n授权：${LICENSE_LABEL[a.licenseStatus]} · 审核：${REVIEW_LABEL[a.reviewStatus]}`
}
