import {
  BUILTIN_ASSETS, LICENSE_LABEL, MEDIA_LABEL, REVIEW_LABEL,
  type MediaType, type MyAsset,
} from '@/data/myAssets'

/**
 * 左栏「资料」页的素材与参考：**素材和参考分开两格**，每格按格式一摞一摞地堆
 * （图片一摞、视频一摞、音频一摞），不再合成一摞「格式卡」。
 *
 * 作者定稿：不做抽屉、不跳素材库；素材与参考分开展示；堆叠按格式来。
 *
 * 只列真东西，靠素材索引里已有的字段分，不猜：
 *   · 属于本项目的      = `refs` 里有 `{ kind:'project', id: 本项目 }`；
 *   · 参考 / 素材        = 标签里有「参考图」的是参考，其余本项目文件是素材
 *                        （索引里没有专门的字段，「参考图」标签是唯一真实信号）；
 *   · 缺失 / 不可用      = 授权不是「可商用」、或审核需要复核的条目；
 *   · 工作流用了几项     = 引用节点 `assetIds` 真正绑定的数量，如实标出。
 *
 * 不摆「用户上传」空格子：现在一条导入都没有，空卡片只是噪音。
 * 也不编「当前场景关联」—— 索引没有场景级关联字段，这一点在界面上如实说明。
 */

export type MaterialFile = {
  id: string
  name: string
  /** 卡片占位图标用（没有缩略图的格式靠它认出来） */
  media: MediaType
  /** 时长 + 授权 + 审核，一行说完 */
  meta: string
  /** 有缩略图才给，没有就不占位 */
  thumb?: string
  /** 工作流引用节点绑定了它 */
  adopted: boolean
}

/** 一摞 = 一个格式的文件叠在一起（每张卡是一个文件，见 Workbench 的文件牌堆） */
export type MaterialPile = {
  id: string
  title: string
  files: MaterialFile[]
}

export type MaterialShelf = {
  id: 'material' | 'reference' | 'flagged'
  title: string
  count: number
  /** 这一格为什么是空的（有内容时为空串），空的时候照实写，不留空列表 */
  empty?: string
  piles: MaterialPile[]
}

const REFERENCE_TAG = '参考图'
const ORDER: MediaType[] = ['image', 'video', 'audio', 'font', 'doc']

function metaOf(a: MyAsset): string {
  const parts: string[] = []
  if (a.duration) parts.push(`${a.duration}s`)
  parts.push(LICENSE_LABEL[a.licenseStatus])
  if (a.reviewStatus !== 'approved') parts.push(REVIEW_LABEL[a.reviewStatus])
  return parts.join(' · ')
}

function pilesOf(items: MyAsset[], adopted: Set<string>): MaterialPile[] {
  const piles: MaterialPile[] = []
  for (const media of ORDER) {
    const group = items.filter((a) => a.mediaType === media)
    if (group.length === 0) continue
    piles.push({
      id: `pile:${media}`,
      title: MEDIA_LABEL[media],
      files: group.map((a) => ({
        id: a.id, name: a.name, media: a.mediaType, meta: metaOf(a),
        thumb: a.thumbnailPath, adopted: adopted.has(a.id),
      })),
    })
  }
  return piles
}

/** 这个项目有没有属于它自己的画面文件（成片/片段/抽帧；参考图不算）。
    没有就说明还没产出画面 —— 中间不该摆一台播放器放别的片子。 */
export function hasOwnPicture(projectId: string): boolean {
  return BUILTIN_ASSETS.some((a) =>
    a.refs.some((r) => r.kind === 'project' && r.id === projectId) &&
    !a.tags.includes(REFERENCE_TAG) &&
    (a.mediaType === 'video' || a.mediaType === 'image'),
  )
}

export function materialShelves(projectId: string, adoptedIds: string[]): MaterialShelf[] {
  const mine = BUILTIN_ASSETS.filter((a) => a.refs.some((r) => r.kind === 'project' && r.id === projectId))
  if (mine.length === 0) return []
  const adopted = new Set(adoptedIds)

  const reference = mine.filter((a) => a.tags.includes(REFERENCE_TAG))
  const material = mine.filter((a) => !a.tags.includes(REFERENCE_TAG))
  const flagged = mine.filter((a) => a.licenseStatus !== 'allowed' || a.reviewStatus === 'needs_review')

  const shelves: MaterialShelf[] = [
    {
      id: 'material', title: '素材', count: material.length,
      empty: material.length === 0 ? '这个项目还没有自己的素材文件。' : undefined,
      piles: pilesOf(material, adopted),
    },
    {
      id: 'reference', title: '参考', count: reference.length,
      empty: reference.length === 0 ? '这个项目还没有参考素材（参考图会带「参考图」标签）。' : undefined,
      piles: pilesOf(reference, adopted),
    },
  ]
  if (flagged.length > 0) {
    shelves.push({
      id: 'flagged', title: '缺失 / 不可用', count: flagged.length,
      piles: pilesOf(flagged, adopted),
    })
  }
  return shelves
}
