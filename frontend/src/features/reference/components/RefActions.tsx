import type * as React from 'react'
import { Icon } from '@/features/reference/components/RefIcon'
import { PickButton } from '@/shared/pick-mode/PickModeUI'
import { useCurrentSegment } from '@/features/reference/hooks/library/useCurrentSegment'
import { usePickMode } from '@/shared/pick-mode/usePickMode'
import { useSegmentActions } from '@/features/reference/hooks/library/useSegmentActions'

export interface RefActionsProps {
  current: ReturnType<typeof useCurrentSegment>['current']
  fileInputRef: React.RefObject<HTMLInputElement | null>
  hasSegment: ReturnType<typeof useCurrentSegment>['hasSegment']
  isFav: boolean
  panelOpen: boolean
  pick: ReturnType<typeof usePickMode>
  setBrowseOpen: React.Dispatch<React.SetStateAction<boolean>>
  setPanelOpen: React.Dispatch<React.SetStateAction<boolean>>
  toggleFavorite: ReturnType<typeof useSegmentActions>['toggleFavorite']
}

/** 从 RefLibrary.tsx 原样拆出的界面区块；props 与原处的变量同名。 */
export function RefActions({ current, fileInputRef, hasSegment, isFav, panelOpen, pick, setBrowseOpen, setPanelOpen, toggleFavorite }: RefActionsProps) {
  return (
    <div className="rfc-actions">
      {/* 导入视频：主入口，放在最左。用实心强调色把它和三个次级按钮区分开。 */}
      <button type="button" className="rfc-gbtn rfc-gbtn-primary" onClick={() => fileInputRef.current?.click()}>
        <Icon name="upload" /> 导入视频
      </button>
      {/* 多选入口：与素材库同一个按钮、同一套逻辑 */}
      {!pick.active && (
        <PickButton onClick={pick.enter} label="片段" />
      )}
      <button type="button" className="rfc-gbtn" onClick={() => setBrowseOpen(true)}>
        <Icon name="layout-grid" /> 片库
      </button>
      {/* Round 3（审计 20）：搜索与筛选由底部传输条移回顶部工具栏，不再贴检查器面板边缘 */}
      <button type="button" className="rfc-gbtn" onClick={() => setBrowseOpen(true)}>
        <Icon name="search" /> 搜索与筛选
      </button>
      <button
        type="button"
        className={`rfc-gbtn${isFav ? ' is-on' : ''}`}
        onClick={() => { if (hasSegment) toggleFavorite(current.id) }}
        disabled={!hasSegment}
        aria-pressed={isFav}
        title={isFav ? '取消收藏' : '收藏片段'}
      >
        <Icon name="star" /> {isFav ? '已收藏' : '收藏'}
      </button>
      <button
        type="button"
        className={`rfc-gbtn${panelOpen ? ' is-on' : ''}`}
        onClick={() => setPanelOpen((v) => !v)}
        aria-pressed={panelOpen}
      >
        <Icon name="panel-right" /> 分析
      </button>
    </div>
  )
}
