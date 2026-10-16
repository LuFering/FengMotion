import { useState } from 'react'
import { ACTIVE_SCENES } from '@/data/projectModel'
import { ACTIVE_DURATION, FILM_FPS } from '@/data/timeline'

/**
 * 镜头时间线 —— 本产品特有的控件（paba 没有）。
 *
 * ⚠️ 但**规格沿用工作台那套**（.tl-* 见 workbench.css）：
 *      头 30px / 片段 8px 圆角 --hole 底 / 悬停变强调边 / 播放头强调色
 *    不用 shadcn，不用 Tailwind 拼视觉 —— 只留布局工具类。
 *
 * ⚠️ 本组件在 Remotion Player **之外**渲染，
 *    所以播放头是 prop 传进来的 —— 绝不能在这里调 useCurrentFrame()。
 */
export function StoryTimeline({
  selectedId, onSelect, activeFrame, onSeek,
}: {
  selectedId: string
  onSelect: (sceneId: string, storyboardId?: string | null) => void
  activeFrame: number
  onSeek: (frame: number) => void
}) {
  const [scale, setScale] = useState(1)
  const [showDraft, setShowDraft] = useState(false)
  const width = Math.max(1000, 1400 * scale)
  const totalSeconds = ACTIVE_DURATION
  const selected = ACTIVE_SCENES.find((s) => s.id === selectedId)
  const playhead = Math.min((activeFrame / FILM_FPS) / totalSeconds * 100, 100)

  return (
    <div className="flex h-full flex-col bg-surf">
      {/* 头：paba .fw-toolbar 规格的压缩版 */}
      <div className="tl-head">
        <b>镜头时间线</b>
        <button className="mini" type="button"
                aria-pressed={showDraft}
                onClick={() => setShowDraft((v) => !v)}>
          {showDraft ? '隐藏 V3 分镜' : '显示 V3 分镜'}
        </button>
        <span className="spacer" />
        <span className="num">旧版剪辑 · {totalSeconds.toFixed(1)}s</span>
        <div className="fw-zoom">
          <button type="button" disabled={scale <= 0.7} title="缩小"
                  onClick={() => setScale((s) => Math.max(0.7, s - 0.15))}>−</button>
          <button type="button" disabled={scale >= 2.2} title="放大"
                  onClick={() => setScale((s) => Math.min(2.2, s + 0.15))}>+</button>
        </div>
      </div>

      <div className="tl-body">
        <div style={{ width, position: 'relative' }}>
          {/* 刻度尺 */}
          <div className="tl-ruler">
            {Array.from({ length: 16 }, (_, i) => (
              <span key={i} style={{ left: `${(i * 10 / totalSeconds) * 100}%` }}>
                {`${String(Math.floor(i / 6)).padStart(2, '0')}:${String(i % 6 * 10).padStart(2, '0')}`}
              </span>
            ))}
          </div>

          {/* 片段轨 */}
          <div className="tl-track">
            {/* 已播区：从 0 到播放头铺一条半透明带（一眼看到"演到哪了"） */}
            <div className="tl-played" style={{ width: `${playhead}%` }} aria-hidden="true" />
            {/* 未播区压暗：已播/未播的差别比"给已播染一点蓝"更看得出来 */}
            <div className="tl-future" style={{ left: `${playhead}%` }} aria-hidden="true" />
            {ACTIVE_SCENES.map((clip) => {
              const sel = clip.id === selectedId
              return (
                <button key={`${clip.id}-${clip.start}`} type="button"
                        className="tl-clip"
                        aria-current={sel ? 'true' : undefined}
                        title={`${clip.id} · ${clip.title} · ${clip.start.toFixed(1)}–${(clip.start + clip.duration).toFixed(1)}s`}
                        onClick={() => onSelect(clip.id, clip.storyboardId)}
                        style={{
                          left: `${clip.start / totalSeconds * 100}%`,
                          width: `${Math.max(clip.duration / totalSeconds * 100, .7)}%`,
                        }}>
                  {clip.frame && <img src={clip.frame} alt="" loading="lazy" />}
                  <i>{clip.id}</i>
                </button>
              )
            })}
            <div className="tl-playhead" style={{ left: `${playhead}%` }} />
          </div>

          {/* 拖动层：整条可点可拖 */}
          <button
            type="button"
            aria-label="拖动播放头"
            className="absolute inset-x-2 top-0 h-full cursor-ew-resize opacity-0"
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect()
              onSeek(Math.round(((e.clientX - rect.left) / rect.width) * totalSeconds * FILM_FPS))
            }}
          />

          {showDraft && (
            <div className="tl-note">
              V3 分镜共 72 个正式段 + 19b 插段，目标 273.6s；当前未映射成完整剪辑，故不叠加到 152s 播放时间线上。
            </div>
          )}
          {selected && (
            <div className="tl-meta">
              <span>{selected.id} · {selected.title}</span>
              <span className="num">
                {selected.start.toFixed(2)}—{(selected.start + selected.duration).toFixed(2)}s · track {selected.track}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
