import type * as React from 'react'
import { trackVisualKind, TRACK_ICON, KIND_ICON } from '@/features/workbench/components/timeline/timelineDisplay'
import { sequenceClipKey as clipKey, type SequenceTrack } from '@/features/workbench/model/sequenceManifest'
import { UiIcon, SemIcons } from '@/shared/icons/UiIcon'
import { formatTimecode } from '@/features/workbench/model/timeRange'
import type { WorkbenchTimelineSpan } from '@/features/workbench/components/WorkbenchTimeline'

export interface TimelineRowsProps {
  collapsedIds: Set<string>
  onSeek: (seconds: number) => void
  pct: (t: number) => number
  pickedId: string | null
  playhead: React.JSX.Element | null
  setCollapsedIds: React.Dispatch<React.SetStateAction<Set<string>>>
  setPickedId: React.Dispatch<React.SetStateAction<string | null>>
  span: WorkbenchTimelineSpan | null
  spanEnd: number
  spanStart: number
  trackStatus: string | undefined
  tracks: SequenceTrack[]
  unavailable: boolean
  viewEnd: number
  viewStart: number
}

/** 时间线的轨道列表：每条轨道可折叠，按当前视野画出片段块，点击片段即选中并跳到其起点；选区以贯穿全轨的底带标出。 */
export function TimelineRows({ collapsedIds, onSeek, pct, pickedId, playhead, setCollapsedIds, setPickedId, span, spanEnd, spanStart, trackStatus, tracks, unavailable, viewEnd, viewStart }: TimelineRowsProps) {
  return (
    <div className="wb-tl-rows" tabIndex={0} role="region" aria-label="轨道列表">
      {/* 贯穿全轨的时间选区高亮底带 */}
      {span && spanEnd > spanStart && (
        <span
          className="wb-tl-span-layer"
          style={{
            left: `calc(var(--wb-tl-gutter) + (100% - var(--wb-tl-gutter)) * ${pct(spanStart) / 100})`,
            width: `calc((100% - var(--wb-tl-gutter)) * ${(pct(spanEnd) - pct(spanStart)) / 100})`,
          }}
          aria-hidden="true"
        />
      )}

      {/* 无轨道清单状态 */}
      {tracks.length === 0 && !unavailable && (
        <div className="wb-tl-empty" role="status">
          {trackStatus || '当前版本暂无可识别的轨道'}，仍可选择时间范围
        </div>
      )}

      {/* 各轨道行（默认每轨 44px） */}
      {tracks.map((tItem) => {
        const parts = tItem.name.split(/\s*[·・]\s*/, 2)
        const trackCode = parts.length > 1 ? parts[0] : ''
        const trackName = parts.length > 1 ? parts[1] : tItem.name
        const visualKind = trackVisualKind(tItem)
        const TrackIconComp = TRACK_ICON[visualKind]
        const collapsed = collapsedIds.has(tItem.id)

        return (
          <div
            className="wb-tl-grid wb-tl-row wb-tl-row-track"
            key={tItem.id}
            data-visual={visualKind}
            data-collapsed={collapsed || undefined}
            data-active={tItem.clips.some((clip) => clipKey(tItem.id, clip.id) === pickedId) || undefined}
          >
            {/* 轨道头：折叠箭头 → 类型图标 → 轨道名称 → 次要代号 */}
            <div className="wb-tl-gutter" title={`${tItem.name} · ${tItem.clips.length} 个片段`}>
              <button
                type="button"
                className="wb-tl-track-fold"
                aria-expanded={!collapsed}
                aria-label={collapsed ? `展开${trackName}` : `折叠${trackName}`}
                onClick={() => setCollapsedIds((prev) => {
                  const next = new Set(prev)
                  if (next.has(tItem.id)) next.delete(tItem.id)
                  else next.add(tItem.id)
                  return next
                })}
              >
                <UiIcon icon={SemIcons.expand} size="xs" className={`wb-tl-fold-arrow ${collapsed ? '' : 'is-expanded'} `} />
              </button>

              <span className="wb-tl-track-type-icon" aria-hidden="true">
                <TrackIconComp size={14} />
              </span>

              <span className="wb-tl-track-name">{trackName}</span>

              {trackCode && <span className="wb-tl-track-code">{trackCode}</span>}

              {/* 仅在多片段轨道上提供紧凑提示 */}
              {tItem.clips.length > 1 && (
                <span className="wb-tl-track-count" title={`${tItem.clips.length} 个片段`}>
                  {tItem.clips.length}
                </span>
              )}
            </div>

            {/* 轨道槽与片段块 */}
            <div className="wb-tl-lane">
              {collapsed ? null : tItem.clips.map((clip) => {
                const key = clipKey(tItem.id, clip.id)
                const shownStart = clip.start
                const shownDuration = clip.duration
                const left = Math.max(shownStart, viewStart)
                const right = Math.min(shownStart + shownDuration, viewEnd)
                if (right <= left) return null
                const hasSpecialIcon = clip.kind === 'text' || clip.kind === 'audio'
                const ClipIcon = KIND_ICON[clip.kind]
                const clipWidthPct = pct(right) - pct(left)

                return (
                  <button
                    key={clip.id}
                    type="button"
                    className="wb-tl-clip"
                    style={{ left: `${pct(left)}%`, width: `${clipWidthPct}%` }}
                    title={`${clip.name} (${formatTimecode(clip.start, true)}–${formatTimecode(clip.start + clip.duration, true)})`}
                    disabled={unavailable}
                    data-kind={clip.kind}
                    data-picked={pickedId === key || undefined}
                    aria-pressed={pickedId === key}
                    onClick={() => {
                      setPickedId(key)
                      onSeek(clip.start)
                    }}
                  >
                    {/* 优先突出 12px 内容名称，类型已在轨道头明确表达；仅在特殊素材且空间充裕时展示小图标 */}
                    {hasSpecialIcon && clipWidthPct >= 10 && (
                      <span className="wb-tl-clip-icon">
                        <ClipIcon size={12} />
                      </span>
                    )}
                    <span className="wb-tl-clip-name">{clip.name}</span>
                  </button>
                )
              })}
              {playhead}
            </div>
          </div>
        )
      })}
    </div>
  )
}
