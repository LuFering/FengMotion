import { useState } from 'react'
import { ACTIVE_SCENES } from '@/data/projectModel'
import { ACTIVE_DURATION, FILM_FPS } from '@/data/timeline'

/** 秒数：整数不写尾随 .0（0.0s → 0s），有真实小数才保留（3.9s）。
    与 Workbench 的 fmtSec 同口径；本文件是 view 内部组件，
    不跨文件 import 那个函数以免与 Workbench 形成循环依赖。 */
function sec(v: number) {
  const r = Math.round(v * 10) / 10
  return `${Number.isInteger(r) ? r : r.toFixed(1)}s`
}

/**
 * 场景时间线 —— 本产品特有的控件（paba 没有）。
 *
 * ⚠️ 本组件在 Remotion Player **之外**渲染，
 *    所以播放头是 prop 传进来的 —— 绝不能在这里调 useCurrentFrame()。
 *
 * A2 云端岛屿 V3：轨道 32px、片段块按时长比例 + 3px 间隙、
 * 选中块强调描边、播放头 2.5px + 三角 + 光晕、5 个等分刻度、缩放 1×–4×。
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
  const totalSeconds = ACTIVE_DURATION
  const selected = ACTIVE_SCENES.find((s) => s.id === selectedId)
  const playhead = Math.min((activeFrame / FILM_FPS) / totalSeconds * 100, 100)
  const ticks = Array.from({ length: 5 }, (_, i) => totalSeconds * i / 4)

  const formatTick = (seconds: number) => {
    const m = Math.floor(seconds / 60)
    const s = Math.floor(seconds % 60)
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }

  const seekAt = (event: React.MouseEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width))
    onSeek(Math.round(ratio * totalSeconds * FILM_FPS))
  }

  return (
    <div className="flex h-full flex-col">
      <div className="tl-head">
        <span className="wb-sec">时间线</span>
        <button className="tl-plan-toggle" type="button"
                aria-pressed={showDraft}
                onClick={() => setShowDraft((v) => !v)}>
          {showDraft ? '隐藏计划段' : '计划段'}
        </button>
        {showDraft && <span className="tl-plan-note">计划段仅作结构参考</span>}
        <span className="wb-spacer" />
        {/* 只显示画面名。原来前面还挂着内部编号（S01），用户不需要知道数据层的 id。 */}
        {selected && <span className="tl-selected">{selected.title}</span>}
        <div className="wb-zoom">
          <button type="button" disabled={scale <= 1} title="缩小" onClick={() => setScale((s) => Math.max(1, s - 0.5))}>−</button>
          <span className="num">{scale % 1 === 0 ? scale : scale.toFixed(1)}×</span>
          <button type="button" disabled={scale >= 4} title="放大" onClick={() => setScale((s) => Math.min(4, s + 0.5))}>+</button>
        </div>
      </div>

      <div className="tl-body">
        <div className="tl-canvas" style={{ width: `${scale * 100}%` }}>
          <div className="tl-track" onClick={(e) => { if (!(e.target as HTMLElement).closest('.tl-clip')) seekAt(e) }}>
            {ACTIVE_SCENES.map((clip) => {
              const sel = clip.id === selectedId
              return (
                <button key={`${clip.id}-${clip.start}`} type="button"
                        className="tl-clip"
                        aria-current={sel ? 'true' : undefined}
                        title={`${clip.title} · ${sec(clip.start)}–${sec(clip.start + clip.duration)}`}
                        onClick={() => onSelect(clip.id, clip.storyboardId)}
                        style={{ flexGrow: clip.duration, flexBasis: 0 }}>
                  {clip.frame && <img className="tl-clip-thumb" src={clip.frame} alt="" loading="lazy" />}
                  <span>{clip.id.slice(1)}</span>
                </button>
              )
            })}
            <div className="tl-playhead" style={{ left: `${playhead}%` }} aria-hidden="true" />
          </div>
          <div className="wb-scale num">
            {ticks.map((tick) => <span key={tick}>{formatTick(tick)}</span>)}
          </div>
        </div>
      </div>
    </div>
  )
}
