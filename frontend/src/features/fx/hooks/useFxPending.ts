import type { FxTechnique } from '@/features/fx/model/fxTechniques'
import { usePendingAssets, type PendingFxCard } from '@/features/assets/hooks/usePendingAssets'
import { FX_STASH_KEY } from '@/features/fx/model/fxLibraryStore'
import { toast as emitToast } from '@/shared/lib/toast'
import { categoryLabel } from '@/features/fx/model/fxFilters'

export interface UseFxPendingArgs {
  pendingStore: ReturnType<typeof usePendingAssets>
}

/** 把技法带进待发送：直接加入待发送清单，或先暂存在本次会话里。 */
export function useFxPending({ pendingStore }: UseFxPendingArgs) {
  /* 特效 → 待发送条目。特效不是文件，带过去的是「做法」本身：
     分类、用途、实现方式、复杂度。这些正是 AI 照着复现所需的最小信息。
     只丢一个名字过去，等于让 AI 重新猜一遍。 */
  const toFxCard = (t: FxTechnique): PendingFxCard => ({
    fxId: t.id,
    name: t.name,
    intent: t.intent,
    /* 用本站的中文分类；t.categoryLabel 是来源库的原始分类（camera、ThemeAnimations…），
       放进待发送就显示成英文。见打磨方案 §3.11 */
    categoryLabel: categoryLabel(t.category),
    execLabel: t.execLabel,
    complexity: t.complexity,
    impl: t.implLabel,
    poster: t.previewImage,
  })

  const stashFxCard = (t: FxTechnique) => {
    try {
      const raw = sessionStorage.getItem(FX_STASH_KEY)
      const map = raw ? JSON.parse(raw) as Record<string, PendingFxCard> : {}
      map[t.id] = toFxCard(t)
      sessionStorage.setItem(FX_STASH_KEY, JSON.stringify(map))
    } catch { /* 存储不可用时忽略 */ }
  }

  const addFxToPending = (list: FxTechnique[]) => {
    /* 撤销只拿走这一次新加的：原本就在待发送里的不动 */
    const fresh = list.filter((t) => !pendingStore.has(t.id)).map((t) => t.id)
    const n = pendingStore.addFx(list.map(toFxCard))
    if (n > 0) {
      emitToast(n === 1 ? '已加入待发送' : `已加入待发送 ${n} 个特效`, {
        action: { label: '撤销', run: () => pendingStore.removeMany(fresh) },
      })
    } else {
      emitToast('已在待发送中')
    }
  }
  return { addFxToPending, stashFxCard }
}
