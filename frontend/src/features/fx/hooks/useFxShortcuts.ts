import type * as React from 'react'
import { useEffect } from 'react'

export interface UseFxShortcutsArgs {
  drawerOpen: boolean
  filtersOpen: boolean
  query: string
  searchRef: React.RefObject<HTMLInputElement | null>
  setFiltersOpen: React.Dispatch<React.SetStateAction<boolean>>
  setQuery: React.Dispatch<React.SetStateAction<string>>
}

/** 技法库页面的键盘快捷键，覆盖搜索框与筛选浮层。 */
export function useFxShortcuts({ drawerOpen, filtersOpen, query, searchRef, setFiltersOpen, setQuery }: UseFxShortcutsArgs) {
  /** / 聚焦搜索；Esc 清搜索。抽屉打开时交给抽屉自己的键盘处理 */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      const typing = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')
      if (e.key === '/' && !typing && !drawerOpen) {
        e.preventDefault()
        searchRef.current?.focus()
        return
      }
      if (e.key === 'Escape' && !drawerOpen && document.activeElement === searchRef.current) {
        if (query) setQuery('')
        else searchRef.current?.blur()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [query, drawerOpen])

  /** 筛选浮层：Esc 关闭 */
  useEffect(() => {
    if (!filtersOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFiltersOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [filtersOpen])
  return {  }
}
