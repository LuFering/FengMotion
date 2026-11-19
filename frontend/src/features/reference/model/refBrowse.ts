import { type LocalSegment } from '@/features/reference/services/referenceApiService'
import { type ReferenceSegment } from '@/features/reference/model/referenceLibrary'

/**
 * 参考片库 —— 影院形态（2026-10-23 选型定版：三套排版语法中选「影院」）。
 *
 * 单位口径与项目一致：项目已去除「镜头」单位，本页的分析单位是**片段**
 * （参考片中一段连续时间范围），与工作台的场景以时间范围互相引用。
 *
 * 形态：画面铺满整个内容区，片单、片段段、分析全部以玻璃覆层浮在画面上，
 * 没有分栏。原页的库功能（搜索 / 字段筛选 / 收藏 / 最近 / 集合 / 排序）
 * 全部收进「片库」覆层网格，不丢功能。
 *
 * 数据口径：只展示现有演示数据；参考片没有视频文件，播放是逐帧静帧预览
 * （播放头推进 + 片段自动切换），不伪装真实视频播放；待分析字段保持
 * 「待分析」。「用作参考」把片段写入本地参考清单（localStorage outbox），
 * 工作台 AgentReference 接入后从该清单取用——当前不假装已直达工作台。
 */

export type BrowseTab = 'all' | 'favorites' | 'recent' | 'collections'

export type SortKey = 'source' | 'timecode' | 'status'

/* 以下两处原先在模块作用域里，直接绑定到演示常量。
   数据改为服务端加载后，必须变成「按当前数据构建」的函数 ——
   模块级 Map 会在数据到达前就固定成空表，之后永远查不到。 */

export const TAB_ITEMS: Array<{ id: BrowseTab; label: string }> = [
  { id: 'all', label: '全部片段' },
  { id: 'favorites', label: '收藏' },
  { id: 'recent', label: '最近浏览' },
  { id: 'collections', label: '参考集合' },
]

export const SORT_ITEMS: Array<{ value: SortKey; label: string }> = [
  { value: 'source', label: '按来源' },
  { value: 'timecode', label: '按时间码' },
  { value: 'status', label: '按状态' },
]

/** 网格与覆层只显示短语；完整值（含「不适用（…）」）保留在分析面板里。 */
export function shortValue(value: string): string {
  const wrapped = value.match(/^不适用（(.+)）$/)
  return wrapped ? wrapped[1] : value
}

/** 某视频的片段（按 index 排序）。数据由调用方传入，不再读模块常量。 */
export function segmentsOf(all: ReferenceSegment[], videoId: string): ReferenceSegment[] {
  return all.filter((s) => s.videoId === videoId).sort((a, b) => a.index - b.index)
}

/**
 * 筛选下拉的候选项：从**已解析**的片段里收集实际出现过的取值。
 *
 * 待解析（pending）的维度不参与 —— 它们的 value 是空串，收进来会多出一个
 * 无意义的空选项。数据由调用方传入，不再读模块级演示常量。
 */
export function fieldOptions(all: LocalSegment[], key: 'cameraMove' | 'transition'): string[] {
  const seen = new Set<string>()
  for (const s of all) {
    const a = s.analysis[key]
    if (a && !a.pending && a.value) seen.add(a.value)
  }
  return [...seen]
}
