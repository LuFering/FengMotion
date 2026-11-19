import type * as React from 'react'
import type { LocalSegment, ServerVideo } from '@/features/reference/services/referenceApiService'
import type { PendingRefCard } from '@/features/assets/hooks/usePendingAssets'
import { REF_STASH_KEY } from '@/features/reference/model/refLibraryStore'
import type { ReferenceSegment } from '@/features/reference/model/referenceLibrary'

export interface UseRefPendingArgs {
  addRef: (cards: PendingRefCard[]) => number
  outbox: string[]
  setOutbox: React.Dispatch<React.SetStateAction<string[]>>
  showToast: (msg: string) => void
  videos: ServerVideo[]
}

/** 把参考片段带出片库：加入待发送、拖拽前暂存参数，以及加入或移出参考清单。 */
export function useRefPending({ addRef, outbox, setOutbox, showToast, videos }: UseRefPendingArgs) {
  /* 片段 → 待发送条目。
     参数一定要跟着走：参考片段的价值是"能借鉴什么"，
     只把视频带过去等于让 AI 重新猜一遍。
     brief 用观察+推断拼成给 AI 的一句话，用户想看可以展开。 */
  const toRefCard = (s: LocalSegment): PendingRefCard => {
    // 从服务端视频里取标题与缩略图；取不到就用中性说法，不拼演示静态图路径
    // （真实片段 ID 在演示图里不存在，拼出来是裂图）。
    const v = videos.find((x) => x.id === s.videoId)
    const pick = (k: 'cameraMove' | 'composition' | 'lighting' | 'rhythm' | 'transition' | 'reusable') => {
      const a = s.analysis[k]
      return a?.pending ? undefined : a?.value
    }
    return {
      segmentId: s.id,
      // 带上所属视频：投给 agent 时只说「片段 2」它不知道是哪段视频的。
      videoId: s.videoId,
      title: `${v?.title ?? '参考片'} · 片段 ${s.index + 1}`,
      start: s.start,
      end: s.end,
      poster: v?.thumbnailUrl ?? undefined,
      params: {
        cameraMove: pick('cameraMove'),
        composition: pick('composition'),
        lighting: pick('lighting'),
        rhythm: pick('rhythm'),
        transition: pick('transition'),
        reusable: pick('reusable'),
      },
      brief: [s.observation, s.inference].filter(Boolean).join(' '),
    }
  }

  /* 拖拽开始前把参数包暂存到 sessionStorage：
     DataTransfer 里只能放字符串，参数包太大不适合塞进去，
     所以只传 ID，落点再按 ID 取回完整参数。 */
  const stashRefCard = (s: LocalSegment) => {
    try {
      const raw = sessionStorage.getItem(REF_STASH_KEY)
      const map = raw ? JSON.parse(raw) as Record<string, PendingRefCard> : {}
      map[s.id] = toRefCard(s)
      sessionStorage.setItem(REF_STASH_KEY, JSON.stringify(map))
    } catch { /* 存储不可用时仅内存态可用 */ }
  }

  const addRefToPending = (segs: LocalSegment[]) => {
    const n = addRef(segs.map(toRefCard))
    showToast(n > 0 ? `已加入待发送 ${n} 个片段` : '已在待发送中')
  }

  const toggleReference = (seg: ReferenceSegment) => {
    if (outbox.includes(seg.id)) {
      setOutbox(outbox.filter((id) => id !== seg.id))
      showToast('已移出参考清单')
    } else {
      setOutbox([seg.id, ...outbox])
      showToast('已加入参考清单，工作台场景可引用该片段')
    }
  }
  return { toggleReference, addRefToPending, stashRefCard }
}
