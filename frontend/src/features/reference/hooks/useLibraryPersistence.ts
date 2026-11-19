import type * as React from 'react'
import { useEffect } from 'react'
import { STORE_KEY, OUTBOX_KEY, type StoredLibrary } from '@/features/reference/model/refLibraryStore'
import type { ReferenceSegment } from '@/features/reference/model/referenceLibrary'

export interface UseLibraryPersistenceArgs {
  outbox: string[]
  segment: ReferenceSegment
  setStored: React.Dispatch<React.SetStateAction<StoredLibrary>>
  stored: StoredLibrary
}

/** 把参考片库的收藏、集合、最近浏览与参考清单写入本地存储，并在切换片段时更新最近浏览。 */
export function useLibraryPersistence({ outbox, segment, setStored, stored }: UseLibraryPersistenceArgs) {
  useEffect(() => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(stored))
    } catch { /* 存储不可用时仅内存生效 */ }
  }, [stored])

  useEffect(() => {
    try {
      localStorage.setItem(OUTBOX_KEY, JSON.stringify(outbox))
    } catch { /* 同上 */ }
  }, [outbox])

  /** 每次激活片段记入最近浏览（去重、最近在前、上限 12）。 */
  useEffect(() => {
    if (!segment) return
    setStored((prev) => {
      if (prev.recent[0] === segment.id) return prev
      return { ...prev, recent: [segment.id, ...prev.recent.filter((id) => id !== segment.id)].slice(0, 12) }
    })
  }, [segment])
  return {  }
}
