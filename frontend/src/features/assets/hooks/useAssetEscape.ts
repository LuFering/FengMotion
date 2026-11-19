import type * as React from 'react'
import { useEffect } from 'react'
import type { MyAsset } from '@/features/assets/model/myAssets'

export interface UseAssetEscapeArgs {
  setDetailId: React.Dispatch<React.SetStateAction<string | null>>
  setPickMode: React.Dispatch<React.SetStateAction<boolean>>
  setPop: React.Dispatch<React.SetStateAction<'sort' | 'type' | null>>
  setRenaming: React.Dispatch<React.SetStateAction<MyAsset | null>>
  setSelected: React.Dispatch<React.SetStateAction<Set<string>>>
}

/** 我的素材页的全局 Esc 键：一次收起页面上打开的临时状态。 */
export function useAssetEscape({ setDetailId, setPickMode, setPop, setRenaming, setSelected }: UseAssetEscapeArgs) {
  // Esc 关闭检查器 / 浮层 / 重命名（输入框自己也会处理）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setPop(null)
      setDetailId(null)
      setRenaming(null)
      /* Esc 也能退出选择模式 —— 否则进了模式只能找那个按钮才能出来 */
      setPickMode(false)
      setSelected(new Set())
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  return {  }
}
