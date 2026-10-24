/**
 * 我的素材 —— 数据模型与内置种子。
 *
 * 职责边界（与参考片库 / 特效库分离）：这里只管理**真实文件**的索引与元数据 ——
 * 用户导入的文件、工作流输入与生成结果；不负责镜头分析（参考片库），
 * 不负责技法定义（特效库）。
 *
 * 数据真实性：
 *   · 种子全部是仓库里的真实文件（成片 / 生成片段 / 抽帧 / 项目参考图 / 设计字体），
 *     元数据由 ffprobe / 文件头实测得出，不是编的；
 *   · 授权状态（licenseStatus）与审核状态（reviewStatus）是两个独立字段 ——
 *     审核只改审核，不推断授权；无可靠授权信息一律 unknown；
 *   · 引用关系（refs）只写真实存在的关联（如成片 ← 项目「Token 科普视频」）。
 */

export type MediaType = 'image' | 'video' | 'audio' | 'font' | 'doc'
export type SourceType = 'builtin' | 'imported' | 'generated'
export type LicenseStatus = 'allowed' | 'attribution_required' | 'restricted' | 'unknown'
export type ReviewStatus = 'pending' | 'approved' | 'needs_review'

export interface AssetRef {
  kind: 'project' | 'workflow' | 'task'
  id: string
  label: string
}

export interface MyAsset {
  id: string
  name: string
  /** 内置素材 = public 下的真实路径；导入素材 = 原始文件名（本体在本地索引里） */
  filePath: string
  mimeType: string
  sizeBytes: number
  mediaType: MediaType
  /** 内置图片用自身路径当缩略图；导入素材的缩略图是索引里的 blob（由 service 解析） */
  thumbnailPath?: string
  duration?: number
  width?: number
  height?: number
  tags: string[]
  folderId: string | null
  sourceType: SourceType
  licenseStatus: LicenseStatus
  licenseDetails?: string
  reviewStatus: ReviewStatus
  createdAt: number
  lastUsedAt?: number
  refs: AssetRef[]
  /** true = 内置种子（删除后不再恢复）；false = 用户导入 */
  builtin: boolean
}

export const MEDIA_LABEL: Record<MediaType, string> = {
  image: '图片', video: '视频', audio: '音频', font: '字体', doc: '文档',
}

export const SOURCE_LABEL: Record<SourceType, string> = {
  builtin: '内置', imported: '导入', generated: '生成结果',
}

export const LICENSE_LABEL: Record<LicenseStatus, string> = {
  allowed: '可商用', attribution_required: '需署名', restricted: '限制使用', unknown: '未知',
}

export const REVIEW_LABEL: Record<ReviewStatus, string> = {
  pending: '待审核', approved: '已通过', needs_review: '需复核',
}

export const MEDIA_ICON: Record<MediaType, string> = {
  image: 'image', video: 'film', audio: 'audio-lines', font: 'pilcrow', doc: 'file-text',
}

/** 从 MIME / 扩展名判断媒体类型（导入用） */
export function mediaTypeOf(file: File): MediaType | null {
  const t = file.type.toLowerCase()
  const n = file.name.toLowerCase()
  if (t.startsWith('image/')) return 'image'
  if (t.startsWith('video/')) return 'video'
  if (t.startsWith('audio/')) return 'audio'
  if (t.startsWith('font/') || /\.(woff2?|ttf|otf)$/.test(n)) return 'font'
  if (t === 'application/pdf' || /\.(pdf|md|txt|docx?|json)$/.test(n)) return 'doc'
  return null
}

const D = (s: string) => Date.parse(s)

/** 种子：仓库真实文件（尺寸/时长/字节数均为实测值） */
export const BUILTIN_ASSETS: MyAsset[] = [
  // ── 成片（生成结果）──
  {
    id: 'b-film', name: 'token-full-legacy.mp4', filePath: './media/token-full-legacy.mp4',
    mimeType: 'video/mp4', sizeBytes: 24485125, mediaType: 'video',
    duration: 152, width: 1920, height: 1080,
    tags: ['成片', 'Token 科普'], folderId: null, sourceType: 'generated',
    licenseStatus: 'allowed', licenseDetails: '自有项目成片（Token 科普视频），内部素材',
    reviewStatus: 'approved', createdAt: D('2026-10-14T06:28:00+08:00'),
    refs: [{ kind: 'project', id: 'token', label: 'Token 科普视频' }], builtin: true,
  },
  // ── 生成片段 ──
  ...Array.from({ length: 8 }, (_, i): MyAsset => ({
    id: `b-clip-${i + 1}`, name: `c${i + 1}.mp4`, filePath: `./media/clips/c${i + 1}.mp4`,
    mimeType: 'video/mp4', sizeBytes: [21312, 15723, 22087, 12361, 10604, 20805, 9723, 17957][i],
    mediaType: 'video', duration: 3, width: 480, height: 270,
    tags: ['片段', 'Token 科普'], folderId: null, sourceType: 'generated',
    licenseStatus: 'allowed', reviewStatus: 'pending',
    createdAt: D('2026-10-14T06:28:00+08:00'),
    refs: [{ kind: 'project', id: 'token', label: 'Token 科普视频' }], builtin: true,
  })),
  // ── 成片抽帧 ──
  ...Array.from({ length: 8 }, (_, i): MyAsset => ({
    id: `b-frame-s${String(i + 1).padStart(2, '0')}`,
    name: `s${String(i + 1).padStart(2, '0')}.jpg`,
    filePath: `./frames/film/s${String(i + 1).padStart(2, '0')}.jpg`,
    mimeType: 'image/jpeg',
    sizeBytes: [5267, 8380, 7789, 1885, 4034, 6163, 2365, 985][i],
    mediaType: 'image', width: 480, height: 270,
    thumbnailPath: `./frames/film/s${String(i + 1).padStart(2, '0')}.jpg`,
    tags: ['抽帧'], folderId: null, sourceType: 'generated',
    licenseStatus: 'allowed', reviewStatus: 'approved',
    createdAt: D('2026-10-14T06:28:00+08:00'),
    refs: [{ kind: 'project', id: 'token', label: 'Token 科普视频' }], builtin: true,
  })),
  // ── 项目参考图（Token 科普片的素材）──
  ...([['jensen', 'Jensen Huang 参考图', 275139], ['musk', 'Musk 参考图', 183606],
      ['pichai', 'Pichai 参考图', 371635], ['altman', 'Altman 参考图', 385482],
      ['nadella', 'Nadella 参考图', 231372], ['report', '报道截图', 1830053],
      ['intro-frame', '片头帧', 82964]] as const).map(([slug, label, size], i): MyAsset => ({
    id: `b-ledger-${slug}`, name: `${slug}.${slug === 'report' ? 'png' : 'jpg'}`,
    filePath: `/ledger/${slug}.${slug === 'report' ? 'png' : 'jpg'}`,
    mimeType: slug === 'report' ? 'image/png' : 'image/jpeg', sizeBytes: size,
    mediaType: 'image',
    thumbnailPath: `/ledger/${slug}.${slug === 'report' ? 'png' : 'jpg'}`,
    tags: ['参考图', label.includes('参考图') ? '人像' : '资料'],
    folderId: null, sourceType: 'builtin',
    licenseStatus: 'unknown', licenseDetails: '来源与授权待补充',
    reviewStatus: i < 5 ? 'approved' : 'needs_review',
    createdAt: D('2026-10-14T06:28:00+08:00'),
    refs: [{ kind: 'project', id: 'token', label: 'Token 科普视频' }], builtin: true,
  })),
  // ── 设计字体（内置）──
  ...([['noto-sans-sc-900', 'Noto Sans SC Black', 75476], ['plex-mono-500', 'IBM Plex Mono Medium', 6972],
      ['big-shoulders-800', 'Big Shoulders ExtraBold', 4600]] as const).map(([slug, label, size]): MyAsset => ({
    id: `b-font-${slug}`, name: `${slug}.woff2`, filePath: `/ledger/${slug}.woff2`,
    mimeType: 'font/woff2', sizeBytes: size, mediaType: 'font',
    tags: ['字体', label], folderId: null, sourceType: 'builtin',
    licenseStatus: 'allowed', licenseDetails: '随项目打包的开源字体',
    reviewStatus: 'approved', createdAt: D('2026-10-14T06:28:00+08:00'),
    refs: [], builtin: true,
  })),
]
