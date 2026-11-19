import type { FxTechnique } from '@/features/fx/model/fxTechniques'
import { usePendingAssets, type PendingFxCard } from '@/features/assets/hooks/usePendingAssets'
import { FX_STASH_KEY } from '@/features/fx/model/fxLibraryStore'
import { toast as emitToast } from '@/shared/lib/toast'

export interface UseFxPendingArgs {
  pendingStore: ReturnType<typeof usePendingAssets>
}

/** 从 FxLibrary.tsx 的 FxLibrary 原样搬出的一段状态与逻辑；参数与返回值和原处的变量同名。 */
export function useFxPending({ pendingStore }: UseFxPendingArgs) {
  /* 特效 → 待发送条目。特效不是文件，带过去的是「做法」本身：
     分类、用途、实现方式、复杂度。这些正是 AI 照着复现所需的最小信息。
     只丢一个名字过去，等于让 AI 重新猜一遍。 */
  const toFxCard = (t: FxTechnique): PendingFxCard => ({
    fxId: t.id,
    name: t.name,
    intent: t.intent,
    categoryLabel: t.categoryLabel,
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
    const n = pendingStore.addFx(list.map(toFxCard))
    emitToast(n > 0 ? `已加入待发送 ${n} 个特效` : '已在待发送中')
  }
  return { addFxToPending, stashFxCard }
}
