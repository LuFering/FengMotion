import { LICENSE_LABEL, MEDIA_LABEL, REVIEW_LABEL, SOURCE_LABEL, type MediaType, type MyAsset } from '@/features/assets/model/myAssets'
import { formatBytes, formatDur } from '@/features/assets/services/assetApiService'

export type SortKey = 'recent' | 'used' | 'name' | 'size' | 'duration'

export const SORT_LABEL: Record<SortKey, string> = {
  recent: '最近导入', used: '最近使用', name: '名称', size: '文件大小', duration: '时长',
}

export const TYPE_IDS: MediaType[] = ['image', 'video', 'audio', 'font', 'doc']

export type StatusTone = 'bad' | 'warn' | 'neutral'

/**
 * 卡片状态签（契约 assets-ui.md「卡片状态签」）：每张卡最多一枚，按优先级取第一个命中。
 * 授权未知、未提审、待审核、已通过、可商用是常态，卡片上不提示 ——
 * 它们在列表列、详情和左侧「授权与审核」分类里仍可见。
 */
export function assetFlag(a: MyAsset): { label: string; tone: StatusTone } | null {
  if (a.processingStatus === 'failed') return { label: a.processingError || '处理失败', tone: 'bad' }
  if (a.availability === 'deprecated') return { label: '已弃用', tone: 'bad' }
  if (a.availability === 'disabled') return { label: '已停用', tone: 'neutral' }
  if (a.processingStatus === 'pending') return { label: '等待处理', tone: 'neutral' }
  if (a.processingStatus === 'processing') return { label: '处理中', tone: 'neutral' }
  if (a.licenseStatus === 'restricted') return { label: LICENSE_LABEL.restricted, tone: 'bad' }
  if (a.reviewStatus === 'rejected') return { label: REVIEW_LABEL.rejected, tone: 'bad' }
  if (a.reviewStatus === 'needs_review') return { label: REVIEW_LABEL.needs_review, tone: 'warn' }
  if (a.licenseStatus === 'attribution_required') return { label: LICENSE_LABEL.attribution_required, tone: 'warn' }
  return null
}

/** 列表与详情里的状态色调：常态值不上色，只有需要处理的值带圆点。 */
export function licenseTone(s: MyAsset['licenseStatus']): StatusTone | null {
  if (s === 'restricted') return 'bad'
  if (s === 'attribution_required') return 'warn'
  return null
}
export function reviewTone(s: MyAsset['reviewStatus']): StatusTone | null {
  if (s === 'rejected') return 'bad'
  if (s === 'needs_review') return 'warn'
  return null
}

/** 提取大写格式铭牌（如 MP4 / PNG / WOFF2 / PDF），用于卡片规格行、非缩略图卡面与详情 */
export function assetFormatBadge(a: MyAsset): string {
  const dot = a.name.lastIndexOf('.')
  if (dot > 0 && dot < a.name.length - 1) {
    const ext = a.name.slice(dot + 1).trim().toUpperCase()
    if (ext.length <= 6) return ext
  }
  const sub = a.mimeType.split('/')[1]?.split(';')[0]?.trim().toUpperCase()
  if (sub && sub.length <= 8) return sub
  return MEDIA_LABEL[a.mediaType]
}

/** 可能带透明通道的图片格式才铺棋盘底；JPG 等不透明格式铺棋盘只会多出一圈花纹。按格式推断，不检测像素。 */
export function mayHaveAlpha(a: MyAsset): boolean {
  if (a.mediaType !== 'image') return false
  return /^(PNG|WEBP|GIF|SVG|SVG\+XML|AVIF|APNG)$/.test(assetFormatBadge(a))
}

function dims(a: MyAsset): string | null {
  return a.width != null && a.height != null ? `${a.width}×${a.height}` : null
}

/** 卡片第二行（不含格式铭牌）：尺寸 · 大小。时长贴在画面角上，这里不重复。 */
export function cardSpec(a: MyAsset): string {
  return [dims(a), formatBytes(a.sizeBytes)].filter(Boolean).join(' · ')
}

/** 详情标题下的规格行：格式 · 尺寸 · 时长 · 大小，缺失项不写。 */
export function detailSpec(a: MyAsset): string {
  return [
    assetFormatBadge(a),
    dims(a),
    a.duration != null ? formatDur(a.duration) : null,
    formatBytes(a.sizeBytes),
  ].filter(Boolean).join(' · ')
}

export function listSpec(a: MyAsset): string {
  if ((a.mediaType === 'video' || a.mediaType === 'audio') && a.duration != null) return formatDur(a.duration)
  return dims(a) ?? '—'
}

export function fullMeta(a: MyAsset): string {
  const d = dims(a)
  return `${a.name}\n${SOURCE_LABEL[a.sourceType]} · ${formatBytes(a.sizeBytes)}${d ? ` · ${d}` : ''}\n授权：${LICENSE_LABEL[a.licenseStatus]} · 审核：${REVIEW_LABEL[a.reviewStatus]}`
}

/** 日期：当天「今天 14:20」，同年「11月5日 14:20」，跨年「2025年11月5日」。与工作流列表一致。 */
export function formatAssetDate(ms: number | undefined): string {
  if (!ms) return '—'
  const d = new Date(ms)
  const now = new Date()
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  if (d.toDateString() === now.toDateString()) return `今天 ${hh}:${mm}`
  if (d.getFullYear() !== now.getFullYear()) return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`
  return `${d.getMonth() + 1}月${d.getDate()}日 ${hh}:${mm}`
}

/** 可用性与授权正交；未知授权不能被自动解释为停用。 */
export function assetUseBlock(a: MyAsset): string | null {
  if (a.availability === 'deprecated') return '已弃用'
  if (a.availability === 'disabled') return '已停用'
  if (a.processingStatus === 'failed') return '处理失败'
  if (a.processingStatus === 'pending') return '等待处理'
  if (a.processingStatus === 'processing') return '处理中'
  return null
}
