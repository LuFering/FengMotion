import { type FxTechnique } from '@/features/fx/model/fxTechniques'

/** 拖拽时按特效 ID 暂存参数包（DataTransfer 只能传字符串） */
export const FX_STASH_KEY = 'fm-fx-card-stash-v1'

export const LIB_KEY = 'fm-fx-library-v1'

export const OUTBOX_KEY = 'fm-fx-usage-outbox-v1'

export type SortKey = 'cat' | 'name' | 'complexity' | 'updated'

export type Scope = 'all' | 'featured' | 'favorites' | 'recent'

export interface FxLibState {
  favorites: string[]
  recent: string[]
}

/** 服务端技法目录。加载前为空数组，界面据此显示「正在读取」而不是「技法库是空的」。 */
export const EMPTY_TECHNIQUES: FxTechnique[] = []

export function loadLibState(): FxLibState {
  try {
    const raw = localStorage.getItem(LIB_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<FxLibState>
      return {
        favorites: Array.isArray(parsed.favorites) ? parsed.favorites : [],
        recent: Array.isArray(parsed.recent) ? parsed.recent : [],
      }
    }
  } catch {
    /* 存档不可用时以空状态起步 */
  }
  return { favorites: [], recent: [] }
}
