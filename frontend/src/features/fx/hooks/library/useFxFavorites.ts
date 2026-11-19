import type * as React from 'react'
import { setFavorite, markViewed } from '@/features/fx/services/fxApiService'
import type { FxLibState } from '@/features/fx/model/fxLibraryStore'

export interface UseFxFavoritesArgs {
  lib: FxLibState
  setLib: React.Dispatch<React.SetStateAction<FxLibState>>
  showToast: (msg: string) => void
}

/** 从 FxLibrary.tsx 的 FxLibrary 原样搬出的一段状态与逻辑；参数与返回值和原处的变量同名。 */
export function useFxFavorites({ lib, setLib, showToast }: UseFxFavoritesArgs) {
  /**
   * 切换收藏。
   *
   * 以服务端返回为准而不是本地取反：多开窗口时，另一边可能已经改过。
   * 失败时不假装成功 —— 界面保持原状并提示。
   */
  function toggleFavorite(id: string) {
    const next = !lib.favorites.includes(id)
    // 先乐观更新让点击有即时反馈，失败再回滚。
    setLib((prev) => ({
      ...prev,
      favorites: next ? [id, ...prev.favorites] : prev.favorites.filter((f) => f !== id),
    }))
    void setFavorite(id, next)
      .then((actual) => {
        setLib((prev) => ({
          ...prev,
          favorites: actual
            ? prev.favorites.includes(id) ? prev.favorites : [id, ...prev.favorites]
            : prev.favorites.filter((f) => f !== id),
        }))
      })
      .catch(() => {
        // 回滚到点击前的状态
        setLib((prev) => ({
          ...prev,
          favorites: next ? prev.favorites.filter((f) => f !== id) : [id, ...prev.favorites],
        }))
        showToast('收藏失败，请稍后重试')
      })
  }

  function pushRecent(id: string) {
    setLib((prev) => ({
      ...prev,
      recent: [id, ...prev.recent.filter((r) => r !== id)].slice(0, 12),
    }))
    // 服务端记一次浏览；失败不打断用户看详情。
    void markViewed(id)
  }
  return { pushRecent, toggleFavorite }
}
