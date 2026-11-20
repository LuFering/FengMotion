import { useEffect, useRef, useState } from 'react'
import type * as React from 'react'
import { createPortal } from 'react-dom'
import { CATEGORY_ICON, KIND_ICON, clipLabel, clipTime } from '@/features/workbench/components/timeline/timelineDisplay'
import { sequenceClipKey as clipKey, type SequenceEntry, type SequenceTrack } from '@/features/workbench/model/sequenceManifest'
import { densityBins, type TrackGroup } from '@/features/workbench/model/timelineGroups'
import { shortSrc } from '@/features/workbench/model/liveEdit'
import { UiIcon, SemIcons } from '@/shared/icons/UiIcon'
import type { WorkbenchTimelineSpan } from '@/features/workbench/components/WorkbenchTimeline'

export interface TimelineRowsProps {
  groups: TrackGroup[]
  isCollapsed: (group: TrackGroup) => boolean
  onToggleGroup: (group: TrackGroup) => void
  fps: number | undefined
  pct: (t: number) => number
  pickedId: string | null
  /** 选中片段所属的元素：同一元素在别处出现的片段淡淡标出 */
  pickedSrc: string | null
  onClipActivate: (clip: SequenceEntry, track: SequenceTrack) => void
  onClipZoom: (clip: SequenceEntry) => void
  /** 收起的抽屉里点了某个时间 */
  onGroupPick: (group: TrackGroup, seconds: number) => void
  /** 搜索命中的片段（clipKey）；null = 没在搜 */
  matches: ReadonlySet<string> | null
  /** 搜索时当前定位到的那一个 */
  focusKey: string | null
  /** 改过的元素（源码位置） */
  changed: ReadonlySet<string> | undefined
  onJumpChange: (group: TrackGroup) => void
  playhead: React.JSX.Element | null
  span: WorkbenchTimelineSpan | null
  spanEnd: number
  spanStart: number
  trackStatus: string | undefined
  unavailable: boolean
  viewEnd: number
  viewStart: number
}

/** 比视野窄这么多的片段只画色块，不放字 */
const TINY_PCT = 2.4
const DENSITY_BINS = 72
/** 相邻片段之间留的缝（规范 §8.5：3px） */
const CLIP_GAP = 3
/** 悬停多久出提示（规范 §7：350ms） */
const TIP_DELAY = 350

type Tip = { clip: SequenceEntry; track: SequenceTrack; rect: DOMRect }

/**
 * 时间线的轨道列表：按类别（场景 / 文字 / 图形 / 背景 / 图片与视频 / 音频）收成抽屉。
 * 抽屉收起时只留一条疏密条，看得出这一类东西在哪些时间扎堆，点一下就跳过去选中那一刻最显眼的一个；
 * 展开后每条轨一行，同时出现的元素分在不同的轨上。只有一条轨的类别直接摊开，不多占一行。
 */
export function TimelineRows(props: TimelineRowsProps) {
  const { groups, isCollapsed, onToggleGroup, fps, pct, pickedId, pickedSrc, onClipActivate, onClipZoom, onGroupPick, matches, focusKey, changed, onJumpChange, playhead, span, spanEnd, spanStart, trackStatus, unavailable, viewEnd, viewStart } = props
  const [tip, setTip] = useState<Tip | null>(null)
  const tipTimer = useRef(0)
  useEffect(() => () => window.clearTimeout(tipTimer.current), [])
  const hideTip = () => { window.clearTimeout(tipTimer.current); setTip(null) }

  /** index：场景片段在轨上的序号（块面左下角的小字标），其余类别不标 */
  const clipNode = (track: SequenceTrack, clip: SequenceEntry, index?: number) => {
    const key = clipKey(track.id, clip.id)
    const left = Math.max(clip.start, viewStart)
    const right = Math.min(clip.start + clip.duration, viewEnd)
    if (right <= left) return null
    const widthPct = pct(right) - pct(left)
    const tiny = widthPct < TINY_PCT
    const picked = pickedId === key
    const ClipIcon = KIND_ICON[clip.kind]
    const { lead, sub } = clipLabel(clip)
    return (
      <button
        key={clip.id}
        type="button"
        className="wb-tl-clip"
        style={{ left: `${pct(left)}%`, width: `max(3px, calc(${widthPct}% - ${CLIP_GAP}px))` }}
        aria-label={`${clip.name} ${clipTime(clip.start, fps)}–${clipTime(clip.start + clip.duration, fps)}`}
        disabled={unavailable}
        data-kind={clip.kind}
        data-tiny={tiny || undefined}
        data-picked={picked || undefined}
        data-related={!picked && !!pickedSrc && clip.src === pickedSrc || undefined}
        data-match={matches?.has(key) || undefined}
        data-dim={matches && !matches.has(key) || undefined}
        data-focus={focusKey === key || undefined}
        data-changed={!!clip.src && changed?.has(clip.src) || undefined}
        aria-pressed={picked}
        onPointerEnter={(e) => {
          const target = e.currentTarget
          window.clearTimeout(tipTimer.current)
          tipTimer.current = window.setTimeout(() => setTip({ clip, track, rect: target.getBoundingClientRect() }), TIP_DELAY)
        }}
        onPointerLeave={hideTip}
        onPointerDown={hideTip}
        onClick={() => onClipActivate(clip, track)}
        onDoubleClick={() => onClipZoom(clip)}
      >
        {!tiny && (clip.kind === 'audio' || clip.kind === 'video' || clip.kind === 'image') && widthPct >= 8 && (
          <span className="wb-tl-clip-icon"><ClipIcon size={11} /></span>
        )}
        {!tiny && index !== undefined && widthPct >= 5 && <span className="wb-tl-clip-tag" aria-hidden="true">{index}</span>}
        {!tiny && <span className="wb-tl-clip-name">{lead}</span>}
        {!tiny && sub && widthPct >= 9 && <span className="wb-tl-clip-sub">{sub}</span>}
      </button>
    )
  }

  return (
    <div className="wb-tl-rows" tabIndex={0} role="region" aria-label="轨道列表" onScroll={hideTip}>
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

      {groups.length === 0 && !unavailable && (
        <div className="wb-tl-empty" role="status">
          {trackStatus || '当前版本暂无可识别的轨道'}，仍可选择时间范围
        </div>
      )}

      {groups.map((group) => {
        const collapsed = isCollapsed(group)
        const single = group.tracks.length === 1
        const Icon = CATEGORY_ICON[group.category]
        const changedSrcs = new Set<string>()
        let hits = 0
        let active = false
        for (const t of group.tracks) for (const c of t.clips) {
          if (c.src && changed?.has(c.src)) changedSrcs.add(c.src)
          if (matches?.has(clipKey(t.id, c.id))) hits++
          if (clipKey(t.id, c.id) === pickedId) active = true
        }
        const countText = single ? `${group.count} 个` : `${group.tracks.length} 轨 · ${group.count} 个`
        return (
          <div className="wb-tl-group" key={group.category} data-cat={group.category} data-collapsed={collapsed && !single || undefined} data-active={active || undefined}>
            <div className="wb-tl-grid wb-tl-row wb-tl-group-head" data-single={single || undefined}>
              <div className="wb-tl-gutter" title={`${group.label} · ${countText}`}>
                {single ? <span className="wb-tl-track-fold" aria-hidden="true" /> : (
                  <button
                    type="button"
                    className="wb-tl-track-fold"
                    aria-expanded={!collapsed}
                    aria-label={collapsed ? `展开${group.label}` : `收起${group.label}`}
                    onClick={() => onToggleGroup(group)}
                  >
                    <UiIcon icon={SemIcons.expand} size="xs" className={`wb-tl-fold-arrow ${collapsed ? '' : 'is-expanded'}`} />
                  </button>
                )}
                <span className="wb-tl-track-type-icon" aria-hidden="true"><Icon size={13} /></span>
                <span className="wb-tl-group-name">{group.label}</span>
                <span className="wb-tl-group-count">{countText}</span>
                {matches && hits > 0 && <span className="wb-tl-group-hits" title={`${hits} 处符合`}>{hits}</span>}
                {changedSrcs.size > 0 && (
                  <button type="button" className="wb-tl-change-badge" title={`有 ${changedSrcs.size} 处改动，点一下跳到下一处`}
                          aria-label={`${group.label}有 ${changedSrcs.size} 处改动，跳到下一处`} onClick={() => onJumpChange(group)}>
                    {changedSrcs.size}
                  </button>
                )}
              </div>
              <div className="wb-tl-lane">
                {single ? group.tracks[0].clips.map((clip, i) => clipNode(group.tracks[0], clip, group.category === 'scene' ? i + 1 : undefined))
                  : collapsed ? <Density group={group} viewStart={viewStart} viewEnd={viewEnd} disabled={unavailable} onPick={(t) => onGroupPick(group, t)} /> : null}
                {playhead}
              </div>
            </div>
            {!single && !collapsed && group.tracks.map((track) => (
              <div className="wb-tl-grid wb-tl-row wb-tl-lane-row" key={track.id}>
                <div className="wb-tl-gutter" title={`${track.name} · ${track.clips.length} 段`}>
                  <span className="wb-tl-lane-name">{track.name}</span>
                </div>
                <div className="wb-tl-lane">
                  {track.clips.map((clip, i) => clipNode(track, clip, group.category === 'scene' ? i + 1 : undefined))}
                  {playhead}
                </div>
              </div>
            ))}
          </div>
        )
      })}

      {tip && <ClipTip tip={tip} fps={fps} changed={!!tip.clip.src && !!changed?.has(tip.clip.src)} />}
    </div>
  )
}

/** 收起的抽屉：一条疏密条，越密的地方越深 */
function Density({ group, viewStart, viewEnd, disabled, onPick }: { group: TrackGroup; viewStart: number; viewEnd: number; disabled: boolean; onPick: (seconds: number) => void }) {
  const bins = densityBins(group, viewStart, viewEnd, DENSITY_BINS)
  const max = Math.max(1, ...bins)
  return (
    <div
      className="wb-tl-density"
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-label={`${group.label}的分布，点一下跳到那里并选中`}
      aria-disabled={disabled}
      onClick={(e) => {
        if (disabled) return
        const rect = e.currentTarget.getBoundingClientRect()
        if (!rect.width) return
        onPick(viewStart + ((e.clientX - rect.left) / rect.width) * (viewEnd - viewStart))
      }}
    >
      {bins.map((n, i) => (
        <span key={i} data-empty={n === 0 || undefined} style={{ opacity: n ? 0.28 + 0.72 * (n / max) : undefined }} />
      ))}
    </div>
  )
}

/** 片段悬停提示：名称、文字、起止时间、源码位置；挂在 #pane-flow 里用工作台的颜色 */
function ClipTip({ tip, fps, changed }: { tip: Tip; fps: number | undefined; changed: boolean }) {
  const host = typeof document !== 'undefined' ? document.getElementById('pane-flow') ?? document.body : null
  if (!host) return null
  const { clip, track, rect } = tip
  const end = clip.start + clip.duration
  const { lead, sub } = clipLabel(clip)
  const x = Math.min(window.innerWidth - 240, Math.max(8, rect.left + Math.min(rect.width / 2, 120) - 20))
  return createPortal(
    <div className="wb-tl-tip" role="tooltip" style={{ left: x, top: rect.top - 6 }}>
      <strong>{lead}{changed && <em>改过</em>}</strong>
      {sub && <span className="wb-tl-tip-text">{sub}</span>}
      <span className="wb-tl-tip-time">{clipTime(clip.start, fps)} – {clipTime(end, fps)}<i>{clip.duration.toFixed(clip.duration < 10 ? 2 : 1)}s</i></span>
      <span className="wb-tl-tip-src">{track.name}{clip.src ? ` · ${shortSrc(clip.src)}` : ''}</span>
    </div>,
    host,
  )
}
