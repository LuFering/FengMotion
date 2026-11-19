import type * as React from 'react'
import { useEffect } from 'react'

export interface UseFxDrawerArgs {
  closeRef: React.RefObject<HTMLButtonElement | null>
  drawerOpen: boolean
  pushRecent: (id: string) => void
  selectedId: string | null
  setDrawerOpen: React.Dispatch<React.SetStateAction<boolean>>
  setSelectedId: React.Dispatch<React.SetStateAction<string | null>>
}

/** 技法详情弹窗的开关：打开时记入最近浏览，关闭后把焦点还给对应的技法卡。 */
export function useFxDrawer({ closeRef, drawerOpen, pushRecent, selectedId, setDrawerOpen, setSelectedId }: UseFxDrawerArgs) {
  function openDrawer(id: string) {
    setSelectedId(id)
    setDrawerOpen(true)
    pushRecent(id)
  }

  function closeDrawer() {
    const id = selectedId
    setDrawerOpen(false)
    window.requestAnimationFrame(() => {
      if (id) document.querySelector<HTMLElement>(`[data-fx-id="${id}"]`)?.focus()
    })
  }

  /**
   * 弹窗打开时把焦点放到关闭键。
   * Esc 关闭、Tab 焦点圈、滚动锁定都交给 radix Dialog 自己处理 ——
   * 之前抽屉是自绘的才需要手写这套，现在再写一遍会变成双重响应。
   */
  useEffect(() => {
    if (!drawerOpen) return
    window.requestAnimationFrame(() => closeRef.current?.focus())
  }, [drawerOpen])
  return { openDrawer, closeDrawer }
}
