import {
  BUILTIN_ASSETS, LICENSE_LABEL, MEDIA_LABEL, REVIEW_LABEL,
  type MediaType, type MyAsset,
} from '@/data/myAssets'

/**
 * 左栏「资料 → 素材与参考」展开后的那摞牌：**同一格式的文件叠成一张卡**。
 *
 * 只列真东西，来源都在素材索引里（`myAssets.ts` 的字段，不是猜的）：
 *   · 属于本项目的文件      = `refs` 里有 `{ kind:'project', id: 本项目 }`；
 *   · 工作流采纳为参考的     = 工作流引用节点的 `assetIds`（卡片上如实标出）；
 *   · 缺失 / 不可用          = 授权不是「可商用」、或审核需要复核的条目。
 *
 * 不做「用户上传」这种空分类：现在一条导入都没有，空卡片只是噪音；
 * 也不做「当前场景关联」—— 素材索引的 refs 只有 project / workflow / task，
 * **没有场景级关联这个字段**，编不出来（这一点在界面上如实说明）。
 */

export type MaterialFile = {
  id: string
  name: string
  /** 时长 + 授权 + 审核，一行说完 */
  meta: string
  /** 有缩略图才给，没有就不占位 */
  thumb?: string
}

export type MaterialCard = {
  id: string
  title: string
  hint: string
  /** 这张卡的圆点语义：格式卡是安静的灰点，缺材料的卡是琥珀点 */
  s: 'idle' | 'waiting'
  files: MaterialFile[]
}

function metaOf(a: MyAsset): string {
  const parts: string[] = []
  if (a.duration) parts.push(`${a.duration}s`)
  parts.push(LICENSE_LABEL[a.licenseStatus])
  if (a.reviewStatus !== 'approved') parts.push(REVIEW_LABEL[a.reviewStatus])
  return parts.join(' · ')
}

const fileOf = (a: MyAsset): MaterialFile => ({
  id: a.id, name: a.name, meta: metaOf(a), thumb: a.thumbnailPath,
})

export function materialDeck(projectId: string, adoptedIds: string[]): MaterialCard[] {
  const mine = BUILTIN_ASSETS.filter((a) => a.refs.some((r) => r.kind === 'project' && r.id === projectId))
  if (mine.length === 0) return []
  const adopted = new Set(adoptedIds)

  /* 按格式归堆：顺序固定成 图片 → 视频 → 音频 → 字体 → 文档，避免每次进来看见不同排法 */
  const order: MediaType[] = ['image', 'video', 'audio', 'font', 'doc']
  const cards: MaterialCard[] = []
  for (const media of order) {
    const items = mine.filter((a) => a.mediaType === media)
    if (items.length === 0) continue
    const picked = items.filter((a) => adopted.has(a.id)).length
    cards.push({
      id: `media:${media}`,
      title: MEDIA_LABEL[media],
      hint: `${items.length} 项${picked ? ` · 工作流用 ${picked}` : ''}`,
      s: 'idle',
      files: items.map(fileOf),
    })
  }

  const flagged = mine.filter((a) => a.licenseStatus !== 'allowed' || a.reviewStatus === 'needs_review')
  if (flagged.length > 0) {
    cards.push({
      id: 'flagged',
      title: '缺失 / 不可用',
      hint: `${flagged.length} 项待处理`,
      s: 'waiting',
      files: flagged.map(fileOf),
    })
  }
  return cards
}
