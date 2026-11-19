import type * as React from 'react'
import { Icon } from '@/features/reference/components/RefIcon'
import { useRefImport } from '@/features/reference/hooks/useRefImport'

export interface RefEmptyLibraryProps {
  fileInputRef: React.RefObject<HTMLInputElement | null>
  onPickFiles: ReturnType<typeof useRefImport>['onPickFiles']
}

/** 参考片库还没有任何视频时的引导页，提供选择视频导入的入口。 */
export function RefEmptyLibrary({ fileInputRef, onPickFiles }: RefEmptyLibraryProps) {
  return (
    <div className="rfc rfc-empty-state">
      <div className="rfc-empty-card">
        <div className="rfc-empty-icon" aria-hidden="true"><Icon name="film" /></div>
        <h2 className="rfc-empty-title">把参考视频拖进来</h2>
        <p className="rfc-empty-desc">自动切分与分析尚未接入，标记需手动完成。</p>
        <button type="button" className="rfc-empty-btn" onClick={() => fileInputRef.current?.click()}>
          <Icon name="upload" /> 选择视频
        </button>
        <p className="rfc-empty-hint">支持 mp4 / mov / webm</p>
      </div>
      <input ref={fileInputRef} type="file" accept="video/*" multiple hidden onChange={onPickFiles} />
    </div>
  )
}
