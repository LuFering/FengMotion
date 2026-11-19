import type * as React from 'react'
import { useEffect } from 'react'
import { listTechniques, importLegacyFavorites, loadUserState } from '@/features/fx/services/fxApiService'
import { loadLibState, LIB_KEY, type FxLibState } from '@/features/fx/model/fxLibraryStore'
import type { FxTechnique } from '@/features/fx/model/fxTechniques'

export interface UseFxCatalogLoadArgs {
  setCatalogError: React.Dispatch<React.SetStateAction<string | null>>
  setCatalogLoading: React.Dispatch<React.SetStateAction<boolean>>
  setLib: React.Dispatch<React.SetStateAction<FxLibState>>
  setTechniques: React.Dispatch<React.SetStateAction<FxTechnique[]>>
}

/** 从 FxLibrary.tsx 的 FxLibrary 原样搬出的一段状态与逻辑；参数与返回值和原处的变量同名。 */
export function useFxCatalogLoad({ setCatalogError, setCatalogLoading, setLib, setTechniques }: UseFxCatalogLoadArgs) {
  /* 首次加载：拉技法目录与用户状态。
     旧版收藏存在 localStorage，先批量推到服务端再清空本地标记 ——
     用户收藏过的技法不该因为换存储而消失。 */
  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const list = await listTechniques()
        if (!alive) return
        setTechniques(list)
        setCatalogError(null)

        const legacy = loadLibState()
        if (legacy.favorites.length > 0) {
          const pushed = await importLegacyFavorites(legacy.favorites)
          if (pushed > 0) {
            // 推成功才清本地，失败时保留，下次再试。
            try {
              localStorage.removeItem(LIB_KEY)
            } catch {
              /* 清不掉也不影响使用 */
            }
          }
        }
        const state = await loadUserState()
        if (!alive) return
        setLib({ favorites: [...state.favorited], recent: state.recent })
      } catch (error) {
        if (!alive) return
        setCatalogError(error instanceof Error ? error.message : '读取技法库失败')
      } finally {
        if (alive) setCatalogLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [])
  return {  }
}
