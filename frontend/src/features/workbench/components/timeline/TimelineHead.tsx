import type * as React from 'react'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/shared/ui/tooltip'
import { MediaIcon } from '@/shared/icons/MediaIcon'
import { UiIcon, SemIcons } from '@/shared/icons/UiIcon'
import { ChevronLeftDouble, ChevronRightDouble, Minus, Scan, SkipBack, SkipForward } from '@untitledui/icons'
import type { SequenceEntry, SequenceTrack } from '@/features/workbench/model/sequenceManifest'
import type { SpanElement } from '@/features/workbench/model/timelineGroups'
import { clipTime } from '@/features/workbench/components/timeline/timelineDisplay'
import { SpanElements } from '@/features/workbench/components/timeline/SpanElements'
import type { WorkbenchTimelineSpan } from '@/features/workbench/components/WorkbenchTimeline'
import type { CapabilityResult } from '@/features/workbench/services/workbenchCapabilityEvaluator'

export interface TimelineHeadProps {
  currentTime: number
  frameFps: number | undefined
  limit: number
  looping: boolean
  markBoundary: (edge: 'start' | 'end') => void
  maxZoom: number
  onClear: () => void
  onClipReference: ((clip: SequenceEntry, track: SequenceTrack) => void) | undefined
  onToggleLoop: () => void
  opsDisabledReason: string | undefined
  picked: SequenceEntry | null
  pickedTrack: SequenceTrack | undefined
  setPickedId: React.Dispatch<React.SetStateAction<string | null>>
  setStart: React.Dispatch<React.SetStateAction<number>>
  setZoom: React.Dispatch<React.SetStateAction<number>>
  setZoomTo: (value: number, anchor?: { time: number; ratio: number }) => void
  span: WorkbenchTimelineSpan | null
  stepFrame: (direction: -1 | 1) => void
  trackClipCapability: CapabilityResult | undefined
  tracksVerified: boolean
  unavailable: boolean
  zoom: number
  /** 在轨道上找元素 */
  search: { query: string; setQuery: (q: string) => void; count: number; index: number; step: (direction: -1 | 1) => void }
  /** 搜索框（按 / 聚焦） */
  searchInput: React.RefObject<HTMLInputElement | null>
  /** 跳到前一个 / 后一个切点（元素出现或消失的地方）；没有就是 null */
  cut: { prev: number | null; next: number | null; go: (direction: -1 | 1) => void }
  spanElements: SpanElement[]
  onSpanPick: (element: SpanElement) => void
  onSpanAsk?: (prompt: string) => Promise<boolean>
  askBusy?: boolean
  /** 改过的元素：数量、跳到下一处、清掉标记 */
  changes: { count: number; next: () => void; clear: () => void } | null
}

/** 时间线的顶栏：时码读数、逐帧与选区起止标记，中间显示已选片段或选区（可引用给 AI、循环、清除），右侧是缩放控制。 */
export function TimelineHead({ currentTime, frameFps, limit, looping, markBoundary, maxZoom, onClear, onClipReference, onToggleLoop, opsDisabledReason, picked, pickedTrack, setPickedId, setStart, setZoom, setZoomTo, span, stepFrame, trackClipCapability, tracksVerified, unavailable, zoom, search, searchInput, cut, spanElements, onSpanPick, onSpanAsk, askBusy, changes }: TimelineHeadProps) {
  return (
    <div className="wb-tl-head">
      {/* 左侧：时间线标题 + 时码读数 + 逐帧 + 选区（紧密靠拢，组间留 12-16px 呼吸间距，不加额外底框） */}
      <div className="wb-tl-head-left">
        <span className="wb-tl-title">时间线</span>
        <div className="wb-tl-readout">
          <span className="wb-tl-time-current">{clipTime(currentTime, frameFps)}</span>
          <span className="wb-tl-sep">/</span>
          <span className="wb-tl-total">{clipTime(limit, frameFps)}</span>
        </div>

        {/* 逐帧定位：紧贴时间读数 */}
        <div className="wb-tl-frame-step" role="group" aria-label="逐帧定位">
          <Tooltip>
            <TooltipTrigger asChild>
              <button type="button" className="wb-tl-icon" aria-label="上一帧" disabled={unavailable || !frameFps || currentTime <= 0} onClick={() => stepFrame(-1)}>
                <MediaIcon name="chevronLeft" size={16} />
              </button>
            </TooltipTrigger>
            <TooltipContent>{unavailable ? opsDisabledReason : frameFps ? '上一帧' : '帧率未知'}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button type="button" className="wb-tl-icon" aria-label="下一帧" disabled={unavailable || !frameFps || currentTime >= limit} onClick={() => stepFrame(1)}>
                <MediaIcon name="chevronRight" size={16} />
              </button>
            </TooltipTrigger>
            <TooltipContent>{unavailable ? opsDisabledReason : frameFps ? '下一帧' : '帧率未知'}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button type="button" className="wb-tl-icon" aria-label="上一个切点" disabled={unavailable || cut.prev === null} onClick={() => cut.go(-1)}>
                <UiIcon icon={SkipBack} size="sm" />
              </button>
            </TooltipTrigger>
            <TooltipContent>{unavailable ? opsDisabledReason : <>上一个切点 <kbd>[</kbd></>}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button type="button" className="wb-tl-icon" aria-label="下一个切点" disabled={unavailable || cut.next === null} onClick={() => cut.go(1)}>
                <UiIcon icon={SkipForward} size="sm" />
              </button>
            </TooltipTrigger>
            <TooltipContent>{unavailable ? opsDisabledReason : <>下一个切点 <kbd>]</kbd></>}</TooltipContent>
          </Tooltip>
        </div>

        {/* 选区范围标记：紧接逐帧 */}
        <div className="wb-tl-range-markers" role="group" aria-label="设置选区范围">
          <Tooltip>
            <TooltipTrigger asChild>
              <button type="button" className="wb-tl-icon" aria-label="设为选区起点" disabled={unavailable || currentTime >= limit - 0.05} onClick={() => markBoundary('start')}>
                <UiIcon icon={ChevronLeftDouble} size="md" />
              </button>
            </TooltipTrigger>
            <TooltipContent>{unavailable ? opsDisabledReason : <>设为选区起点 <kbd>I</kbd></>}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button type="button" className="wb-tl-icon" aria-label="设为选区终点" disabled={unavailable || currentTime <= 0.05} onClick={() => markBoundary('end')}>
                <UiIcon icon={ChevronRightDouble} size="md" />
              </button>
            </TooltipTrigger>
            <TooltipContent>{unavailable ? opsDisabledReason : <>设为选区终点 <kbd>O</kbd></>}</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* 中间：选中状态或默认操作（位置稳定，选中时展示“引用给 AI”，未选中时自然留白，不漂移浮动） */}
      <div className="wb-tl-head-center">
        {picked ? (
          <div className="wb-tl-focus-pill" role="status">
            <span className="wb-tl-focus-label">已选</span>
            <span className="wb-tl-focus-name" title={picked.name}>{picked.name}</span>
            <span className="wb-tl-focus-range">{clipTime(picked.start, frameFps)}–{clipTime(picked.start + picked.duration, frameFps)}</span>
            {tracksVerified && (trackClipCapability?.allowed ?? true) ? (
              <button
                type="button"
                className="wb-tl-action-btn primary"
                disabled={unavailable}
                onClick={() => pickedTrack && onClipReference?.(picked, pickedTrack)}
              >
                引用给 AI
              </button>
            ) : (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="wb-tl-ref-tag" tabIndex={0}>参考</span>
                </TooltipTrigger>
                <TooltipContent>
                  {trackClipCapability && !trackClipCapability.allowed
                    ? trackClipCapability.reason
                    : '当前轨道尚未确认与当前版本对应，仅支持时间与内容定位'}
                </TooltipContent>
              </Tooltip>
            )}
            <button type="button" className="wb-tl-icon sm" aria-label="取消选择" onClick={() => setPickedId(null)}>
              <UiIcon icon={SemIcons.close} size="sm" />
            </button>
          </div>
        ) : span ? (
          <div className="wb-tl-focus-pill" role="status">
            <span className="wb-tl-focus-label">选区</span>
            <span className="wb-tl-focus-range">{clipTime(span.start, frameFps)}–{clipTime(span.end, frameFps)}</span>
            <SpanElements span={span} elements={spanElements} fps={frameFps} onPick={onSpanPick} onAsk={onSpanAsk} busy={askBusy} />
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="wb-tl-icon sm"
                  data-active={looping || undefined}
                  aria-pressed={looping}
                  aria-label={looping ? '停止循环' : '循环选区'}
                  disabled={unavailable}
                  onClick={onToggleLoop}
                >
                  <UiIcon icon={SemIcons.refresh} size="sm" />
                </button>
              </TooltipTrigger>
              <TooltipContent>{looping ? '停止循环' : '循环选区'}</TooltipContent>
            </Tooltip>
            <button type="button" className="wb-tl-icon sm" aria-label="清除选区" onClick={onClear}>
              <UiIcon icon={SemIcons.close} size="sm" />
            </button>
          </div>
        ) : changes && changes.count > 0 ? (
          <div className="wb-tl-focus-pill" role="status" data-tone="changes">
            <span className="wb-tl-change-dot" aria-hidden="true" />
            <span className="wb-tl-focus-name">改过 {changes.count} 处</span>
            <button type="button" className="wb-tl-action-btn" onClick={changes.next}>下一处</button>
            <Tooltip>
              <TooltipTrigger asChild>
                <button type="button" className="wb-tl-icon sm" aria-label="清除改动标记" onClick={changes.clear}>
                  <UiIcon icon={SemIcons.close} size="sm" />
                </button>
              </TooltipTrigger>
              <TooltipContent>清除改动标记</TooltipContent>
            </Tooltip>
          </div>
        ) : null}
      </div>

      {/* 右侧：缩放控制器 */}
      <div className="wb-tl-head-right">
        {/* 找元素：命中的高亮、其余变淡，回车跳到下一个 */}
        <label className="wb-tl-search" data-active={search.query ? true : undefined}>
          <UiIcon icon={SemIcons.search} size="xs" />
          <input
            ref={searchInput}
            type="search"
            value={search.query}
            placeholder="找元素"
            aria-label="在轨道上找元素"
            onChange={(e) => search.setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); search.step(e.shiftKey ? -1 : 1) }
              else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (search.query) search.setQuery(''); else e.currentTarget.blur() }
            }}
          />
          {search.query && <span className="wb-tl-search-count" aria-live="polite">{search.count ? `${search.index + 1}/${search.count}` : '0'}</span>}
        </label>
        <div className="wb-tl-zoom" role="group" aria-label="缩放">
          <Tooltip>
            <TooltipTrigger asChild>
              <button type="button" className="wb-tl-icon" aria-label="缩小时间线" disabled={unavailable || zoom <= 1.001} onClick={() => setZoomTo(zoom / 1.8)}>
                <UiIcon icon={Minus} size="sm" />
              </button>
            </TooltipTrigger>
            <TooltipContent>{unavailable ? opsDisabledReason : '缩小'}</TooltipContent>
          </Tooltip>
          <input
            type="range"
            className="wb-tl-zoom-slider"
            aria-label="缩放比例"
            min={1}
            max={Math.max(1, maxZoom)}
            step="any"
            value={zoom}
            disabled={unavailable || maxZoom <= 1}
            onChange={(e) => setZoomTo(Number(e.target.value))}
          />
          <Tooltip>
            <TooltipTrigger asChild>
              <button type="button" className="wb-tl-icon" aria-label="放大时间线" disabled={unavailable || zoom >= maxZoom - 0.001} onClick={() => setZoomTo(zoom * 1.8)}>
                <UiIcon icon={SemIcons.plus} size="sm" />
              </button>
            </TooltipTrigger>
            <TooltipContent>{unavailable ? opsDisabledReason : '放大'}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button type="button" className="wb-tl-icon" aria-label="适应整片" disabled={unavailable || zoom <= 1.001} onClick={() => { setStart(0); setZoom(1) }}>
                <UiIcon icon={Scan} size="sm" />
              </button>
            </TooltipTrigger>
            <TooltipContent>{unavailable ? opsDisabledReason : '适应整片 (重置缩放)'}</TooltipContent>
          </Tooltip>
        </div>
      </div>
    </div>
  )
}
