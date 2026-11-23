import { MEDIA_LABEL, type MediaType } from '@/features/assets/model/myAssets'
import { type FolderRow } from '@/features/assets/services/assetApiService'

export type NodeId = 'all' | 'favorites' | 'recent' | 'unassigned' | 'imported' | 'generated' | 'builtin'
  | 'review:pending' | 'review:needs_review' | 'license:unknown' | 'license:restricted'
  | 'refs:none' | `type:${MediaType}` | `folder:${string}` | `tag:${string}` | `proj:${string}`

export type TreeEntry = { id: NodeId; label: string; icon: string; count: number; badge?: string }

/** 项目列表里素材页用得到的部分：按 ID 归属，名称只用于显示 */
export interface ProjectOption { id: string; name: string }

/** 标签色点调色板（数据色点，非主题色） */
export const TAG_COLORS = ['#f5b83d', '#4caf7d', '#3B8CF8', '#e06c75', '#b48cf2', '#4cc2ff', '#f28cb1', '#9ece6a']

export function tagColor(t: string): string {
  let h = 0
  for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) >>> 0
  return TAG_COLORS[h % TAG_COLORS.length]
}

/** 当前分类的中文名（工具条 / 组织栏共用） */
export function nodeLabel(id: NodeId, folders: FolderRow[], projects: ProjectOption[] = []): string {
  if (id.startsWith('type:')) return MEDIA_LABEL[id.slice(5) as MediaType]
  if (id.startsWith('folder:')) return folders.find((f) => f.id === id.slice(7))?.name ?? '文件夹'
  if (id.startsWith('tag:')) return id.slice(4)
  if (id.startsWith('proj:')) return projects.find((p) => p.id === id.slice(5))?.name ?? '项目'
  switch (id) {
    case 'favorites': return '收藏'
    case 'recent': return '最近使用'
    case 'unassigned': return '未归属'
    case 'imported': return '导入素材'
    case 'generated': return '生成结果'
    case 'builtin': return '内置素材'
    case 'review:pending': return '待审核'
    case 'review:needs_review': return '需复核'
    case 'license:unknown': return '授权未知'
    case 'license:restricted': return '限制使用'
    case 'refs:none': return '未被引用'
    default: return '全部素材'
  }
}
