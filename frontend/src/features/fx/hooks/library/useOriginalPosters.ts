import type * as React from 'react'
import { useEffect } from 'react'

export interface UseOriginalPostersArgs {
  setOriginalPosters: React.Dispatch<React.SetStateAction<Record<string, { file: string; frame: number; frameSource: string; checksum: string }>>>
}

/** 从 FxLibrary.tsx 的 FxLibrary 原样搬出的一段状态与逻辑；参数与返回值和原处的变量同名。 */
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
