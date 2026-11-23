import type * as React from 'react'
import { Icon } from '@/features/reference/components/RefIcon'

export interface RefActionsProps {
  fileInputRef: React.RefObject<HTMLInputElement | null>
  panelOpen: boolean
  setBrowseOpen: React.Dispatch<React.SetStateAction<boolean>>
  setPanelOpen: React.Dispatch<React.SetStateAction<boolean>>
}

/**
 * 顶部只放片级动作：导入视频（主）· 片库 · 分析面板开关。
 * 原先「片库」「搜索与筛选」打开同一个覆层，合并成一个；
 * 收藏是片段级动作，移进分析面板；「选择片段」移进片库覆层头部。
 */
export function RefActions({ fileInputRef, panelOpen, setBrowseOpen, setPanelOpen }: RefActionsProps) {
  return (
    <div className="rfc-actions">
      <button type="button" className="rfc-gbtn rfc-gbtn-primary" onClick={() => fileInputRef.current?.click()}>
        <Icon name="upload" /> 导入视频
      </button>
      <button type="button" className="rfc-gbtn" onClick={() => setBrowseOpen(true)} title="片库：搜索、筛选、收藏与集合">
        <Icon name="search" /> 片库
      </button>
      <button
        type="button"
        className={`rfc-gbtn${panelOpen ? ' is-on' : ''}`}
        onClick={() => setPanelOpen((v) => !v)}
        aria-pressed={panelOpen}
        title={panelOpen ? '收起分析面板' : '展开分析面板'}
      >
        <Icon name="panel-right" /> 分析
      </button>
    </div>
  )
}
