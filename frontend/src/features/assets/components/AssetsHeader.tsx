import { useEffect, useRef } from 'react'
import type * as React from 'react'
import { Icon } from './AssetIcon'
import { SearchField } from '@/shared/components/SearchField'

interface AssetsHeaderProps {
  inputRef: React.RefObject<HTMLInputElement | null>
  search: string
  setSearch: (value: string) => void
  importing: boolean
}

/** 页面级操作。分类和视图工具留在浏览区域。 */
export function AssetsHeader({ inputRef, search, setSearch, importing }: AssetsHeaderProps) {
  const searchRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const focusSearch = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return
      if ((e.target as HTMLElement).closest('input, textarea, select, [contenteditable="true"]')) return
      e.preventDefault()
      searchRef.current?.focus()
    }
    window.addEventListener('keydown', focusSearch)
    return () => window.removeEventListener('keydown', focusSearch)
  }, [])
  return (
    <header className="mya-header">
      <h1>我的素材</h1>
      <div className="mya-search">
        <SearchField value={search} onChange={setSearch} inputRef={searchRef}
          placeholder="搜索名称或标签" ariaLabel="搜索素材"
          onClear={() => setSearch('')} shortcutHint="/" />
      </div>
      <button type="button" className="mya-primary" disabled={importing} onClick={() => inputRef.current?.click()}>
        <Icon name="plus" /><span>{importing ? '正在导入…' : '导入素材'}</span>
      </button>
    </header>
  )
}
