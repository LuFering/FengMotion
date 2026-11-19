import type * as React from 'react'
import { useEffect } from 'react'

export interface UseOriginalPostersArgs {
  setOriginalPosters: React.Dispatch<React.SetStateAction<Record<string, { file: string; frame: number; frameSource: string; checksum: string }>>>
}

/** 读取技法原片静态预览图的清单；清单尚未生成时不改动现有状态。 */
export function useOriginalPosters({ setOriginalPosters }: UseOriginalPostersArgs) {
  useEffect(() => {
    const abort = new AbortController()
    void fetch(`${import.meta.env.BASE_URL}fx-original-posters/manifest.json?t=${Date.now()}`, { signal: abort.signal })
      .then((response) => response.ok ? response.json() : {})
      .then((data) => { if (!abort.signal.aborted) setOriginalPosters(data) })
      .catch(() => { /* 尚未生成静态预览时保留原状态 */ })
    return () => abort.abort()
  }, [])
  return {  }
}
