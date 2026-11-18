import { useEffect, useRef, useState } from 'react'
import { UiIcon, SemIcons } from '@/components/icons/UiIcon'
import { Maximize01, SwitchHorizontal01 } from '@untitledui/icons'
import type { StageVisual } from '@/data/stageVisual'
import { containedMediaRect, formatMediaTime } from '@/data/previewGeometry'

/**
 * 真实预览对比组件：
 * 严格使用双侧真实视频/图片文件；
 * 支持联动同步（默认定位到修改目标时间）与分别定位（应对两版时长或剪辑变动导致时间偏移的场景）；
 * 左右交换时保留各自独立播放时间；切回联动时先统一对齐两侧时间再恢复同步；
 * 旧框选区域默认标为基准目标，新版本仅作为原位置参考且提意见时绝不自动绑定旧框。
 */
export function WorkbenchPreviewCompare({ left, right, initialTime, bbox, onClose, onDiscuss, onFocus, focused }: {
  left: StageVisual
  right: StageVisual
  /** 打开时对齐到的秒数：从「用户指的那一帧」打开，而不是从 0 开始 */
  initialTime?: number
  /** 用户框选的区域（归一化 0–1，相对媒体画面） */
  bbox?: { x: number; y: number; w: number; h: number } | null
  onClose: () => void
  onFocus: () => void
  focused: boolean
  onDiscuss: (visual: StageVisual, seconds: number | undefined, image: string, bbox?: { x: number; y: number; w: number; h: number } | null) => void
}) {
  const videos = useRef<(HTMLVideoElement | null)[]>([null, null])
  const stills = useRef<(HTMLImageElement | null)[]>([null, null])

  const startAt = left.media === 'video' && typeof initialTime === 'number' && Number.isFinite(initialTime) ? Math.max(0, initialTime) : 0

  // 严格按版本 ID 维护每个视频自身的播放进度与时长，不受左右交换重挂载影响
  const visualTimes = useRef<Record<string, number>>({
    [left.id]: startAt,
    [right.id]: startAt,
  })
  const visualDurations = useRef<Record<string, number>>({})

  const [durations, setDurations] = useState<Record<string, number>>({})
  const [displayTimes, setDisplayTimes] = useState<Record<string, number>>({
    [left.id]: startAt,
    [right.id]: startAt,
  })
  const [sidePlaying, setSidePlaying] = useState<[boolean, boolean]>([false, false])
  const [time, setTime] = useState(startAt)
  const [mode, setMode] = useState<'linked' | 'independent'>('linked')
  const [playing, setPlaying] = useState(false)
  const [failed, setFailed] = useState(false)
  const [captureError, setCaptureError] = useState('')

  // 左右交换功能：只改显示槽位，各版本自身保留独立进度
  const [swapped, setSwapped] = useState(false)
  const swap = () => {
    pauseAll()
    setSwapped((value) => !value)
  }
  const sides: [StageVisual, StageVisual] = swapped ? [right, left] : [left, right]

  const leftDuration = durations[left.id] ?? 0
  const rightDuration = durations[right.id] ?? 0
  const duration = (leftDuration > 0 && rightDuration > 0)
    ? Math.min(leftDuration, rightDuration)
    : Math.max(leftDuration, rightDuration)

  useEffect(() => {
    if (duration > 0 && mode === 'linked') {
      setTime((current) => Math.min(current, duration))
    }
  }, [duration, mode])

  const pauseAll = () => {
    videos.current.forEach((v) => v?.pause())
    setPlaying(false)
    setSidePlaying([false, false])
  }

  // 联动 Seek：同时更新两侧与共享时间
  const seekLinked = (seconds: number) => {
    pauseAll()
    videos.current.forEach((v) => {
      if (v && v.readyState >= 1) v.currentTime = seconds
    })
    visualTimes.current[left.id] = seconds
    visualTimes.current[right.id] = seconds
    setTime(seconds)
    setDisplayTimes({ [left.id]: seconds, [right.id]: seconds })
  }

  // 独立 Seek：只更新该槽位对应版本的进度
  const seekSide = (index: number, visualId: string, seconds: number) => {
    const v = videos.current[index]
    if (v && v.readyState >= 1) {
      v.pause()
      v.currentTime = seconds
    }
    visualTimes.current[visualId] = seconds
    setSidePlaying((old) => [index === 0 ? false : old[0], index === 1 ? false : old[1]])
    setDisplayTimes((old) => ({ ...old, [visualId]: seconds }))
  }

  // 分别定位切回联动：明确以基准画面（或当前左侧画面）为时间基准，先对齐两侧时间再同步
  const switchToLinked = () => {
    pauseAll()
    const anchorId = sides[0].id
    const anchorTime = visualTimes.current[anchorId] ?? time
    const clamped = duration > 0 ? Math.min(anchorTime, duration) : anchorTime

    videos.current.forEach((v) => {
      if (v && v.readyState >= 1) {
        v.currentTime = clamped
      }
    })
    visualTimes.current[left.id] = clamped
    visualTimes.current[right.id] = clamped
    setDisplayTimes({ [left.id]: clamped, [right.id]: clamped })
    setTime(clamped)
    setMode('linked')
  }

  const playLinked = async () => {
    if (playing) {
      pauseAll()
      return
    }
    if (time >= duration) seekLinked(0)
    try {
      await Promise.all(videos.current.map((v) => v?.play()))
      setPlaying(true)
      setSidePlaying([true, true])
    } catch {
      pauseAll()
      setFailed(true)
    }
  }

  const playSide = async (index: number, visualId: string) => {
    const isThisPlaying = sidePlaying[index]
    const v = videos.current[index]
    if (!v) return
    if (isThisPlaying) {
      v.pause()
      setSidePlaying((old) => [index === 0 ? false : old[0], index === 1 ? false : old[1]])
      return
    }
    const ownDuration = durations[visualId] ?? 0
    if (v.currentTime >= ownDuration) {
      v.currentTime = 0
    }
    try {
      await v.play()
      setSidePlaying((old) => [index === 0 ? true : old[0], index === 1 ? true : old[1]])
    } catch {
      setFailed(true)
    }
  }

  const tick = (index: number, visualId: string, media: HTMLVideoElement) => {
    const own = media.currentTime
    visualTimes.current[visualId] = own
    setDisplayTimes((old) => ({ ...old, [visualId]: own }))

    if (mode === 'linked') {
      if (own >= duration) {
        pauseAll()
        setTime(duration)
        return
      }
      setTime(own)
      const otherIdx = index === 0 ? 1 : 0
      const other = videos.current[otherIdx]
      if (other && Math.abs(other.currentTime - own) > 0.12) {
        other.currentTime = own
      }
    }
  }

  const discuss = (index: number) => {
    pauseAll()
    const visual = sides[index]
    const isBaseline = visual.id === left.id
    const media = visual.media === 'video' ? videos.current[index] : stills.current[index]
    try {
      if (!media) throw new Error('画面未加载')
      const width = media instanceof HTMLVideoElement ? media.videoWidth : media.naturalWidth
      const height = media instanceof HTMLVideoElement ? media.videoHeight : media.naturalHeight
      if (!width || !height) throw new Error('画面未加载')
      const scale = Math.min(1, 1600 / Math.max(width, height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(width * scale))
      canvas.height = Math.max(1, Math.round(height * scale))
      const context = canvas.getContext('2d')
      if (!context) throw new Error('无法创建画布')
      context.drawImage(media, 0, 0, canvas.width, canvas.height)
      const seconds = visual.media === 'video' ? (media as HTMLVideoElement).currentTime : undefined

      // 关键防错：基准画面可带上原框；新版本画面绝不自动套用旧框（传 null，由用户重新框定新目标）
      const regionToAttach = isBaseline ? bbox : null
      onDiscuss(visual, seconds, canvas.toDataURL('image/jpeg', 0.85), regionToAttach)
    } catch {
      setCaptureError('无法提取当前画面，请返回预览后重试。')
    }
  }

  const alignLabel = startAt > 0 ? `对齐到 ${formatMediaTime(startAt)}` : ''

  return (
    <section className="wb-preview-compare" aria-label="真实预览对比">
      <header>
        <div className="flex items-center gap-1.5 flex-wrap">
          <UiIcon icon={SwitchHorizontal01} size="md" />
          <span>{mode === 'linked' ? '联动同步对比' : '分别定位对比'}</span>
          {alignLabel && <small>{alignLabel}</small>}
        </div>

        {/* 模式切换：联动同步 vs 分别定位 */}
        <div className="flex items-center gap-1 bg-[var(--hole)] p-0.5 rounded-md border border-[var(--line)] text-xs">
          <button
            type="button"
            className={`px-2 py-0.5 rounded transition-colors ${mode === 'linked' ? 'bg-[var(--surf)] font-medium text-[var(--tx)]' : 'text-[var(--tx3)] hover:text-[var(--tx)]'}`}
            onClick={switchToLinked}
            title="以当前画面时间为基准，对齐两侧并恢复联动同步"
          >
            联动同步
          </button>
          <button
            type="button"
            className={`px-2 py-0.5 rounded transition-colors flex items-center gap-1 ${mode === 'independent' ? 'bg-[var(--surf)] font-medium text-[var(--tx)]' : 'text-[var(--tx3)] hover:text-[var(--tx)]'}`}
            onClick={() => {
              pauseAll()
              setMode('independent')
            }}
            title="当两版时长或剪辑变动导致时间偏移时，允许分别定位左右两侧画面"
          >
            <UiIcon icon={SemIcons.sliders} size="xs" />
            分别定位
          </button>
        </div>

        <button type="button" className="wb-compare-swap" onClick={swap} title="交换左右两侧">
          <UiIcon icon={SwitchHorizontal01} size="sm" />交换
        </button>
        <button type="button" className="wb-compare-focus" onClick={onFocus}>
          <UiIcon icon={Maximize01} size="sm" />{focused ? '展开审阅' : '专注画面'}
        </button>
        <button type="button" onClick={onClose} aria-label="关闭预览对比">
          <UiIcon icon={SemIcons.close} size="md" />
        </button>
      </header>

      <div className="wb-compare-pair">
        {[0, 1].map((index) => {
          const visual = sides[index]
          const isBaseline = visual.id === left.id
          const ownDuration = durations[visual.id] ?? 0
          const currentVisualTime = displayTimes[visual.id] ?? startAt
          const isSidePlaying = sidePlaying[index]

          return (
            <figure key={`${index}:${visual.id}`} className="flex flex-col">
              <figcaption>
                <span>{isBaseline ? '基准对照画面' : '本轮生成画面'}</span>
                <b>{visual.name}</b>
                <small>{visual.tierLabel} · {visual.origin === 'scene' ? '场景版本' : visual.origin === 'editor' ? '编辑版本' : '工作流'} v{visual.revision}</small>
              </figcaption>

              <div className="wb-compare-media">
                {visual.media === 'video' ? (
                  <video
                    muted
                    playsInline
                    crossOrigin="anonymous"
                    preload="metadata"
                    src={visual.file}
                    ref={(v) => { videos.current[index] = v }}
                    onLoadedMetadata={(e) => {
                      const media = e.currentTarget
                      const own = media.duration
                      if (Number.isFinite(own)) {
                        visualDurations.current[visual.id] = own
                        setDurations((old) => ({ ...old, [visual.id]: own }))
                      }
                      // 关键修复：从 visualTimes 中读取该版本自己之前停留的时间，绝不重置回 startAt
                      const savedTime = visualTimes.current[visual.id] ?? startAt
                      if (media.readyState >= 1 && Number.isFinite(own)) {
                        media.currentTime = Math.min(savedTime, own)
                      }
                    }}
                    onTimeUpdate={(e) => tick(index, visual.id, e.currentTarget)}
                    onEnded={pauseAll}
                    onError={() => { pauseAll(); setFailed(true) }}
                  />
                ) : (
                  <img
                    crossOrigin="anonymous"
                    src={visual.file}
                    alt={`${isBaseline ? '对照' : '本轮'}：${visual.name}`}
                    ref={(el) => { stills.current[index] = el }}
                    onError={() => setFailed(true)}
                  />
                )}

                {/* 框选区域：基准画面绘制原目标区域；新版本画面若展示则明确标为原位置参考虚线 */}
                {bbox && (
                  <CompareRegionBox
                    media={visual.media === 'video' ? videos : stills}
                    index={index}
                    bbox={bbox}
                    tickSeconds={currentVisualTime}
                    isBaseline={isBaseline}
                  />
                )}
              </div>

              {/* 分别定位模式下的独立时间轴调节器 */}
              {mode === 'independent' && visual.media === 'video' && (
                <div className="flex items-center gap-1.5 px-2 py-1.5 bg-[var(--hole)] border-t border-[var(--line)] text-xs">
                  <button
                    type="button"
                    className="p-1 text-[var(--tx)] hover:text-blue-500"
                    onClick={() => void playSide(index, visual.id)}
                    aria-label={isSidePlaying ? '暂停' : '播放'}
                  >
                    {isSidePlaying ? <UiIcon icon={SemIcons.pause} size="xs" /> : <UiIcon icon={SemIcons.play} size="xs" />}
                  </button>
                  <time className="font-mono text-[11px] shrink-0 text-[var(--tx2)]">{formatMediaTime(currentVisualTime)}</time>
                  <input
                    type="range"
                    aria-label={`单独调整${isBaseline ? '基准' : '本轮'}画面时间`}
                    className="flex-1 accent-blue-500 h-1"
                    min={0}
                    max={ownDuration || 0}
                    step={0.001}
                    value={Math.min(currentVisualTime, ownDuration || 0)}
                    disabled={!ownDuration}
                    onChange={(e) => seekSide(index, visual.id, Number(e.target.value))}
                  />
                  <time className="font-mono text-[11px] shrink-0 text-[var(--tx3)]">{formatMediaTime(ownDuration)}</time>
                </div>
              )}

              <button type="button" onClick={() => discuss(index)}>
                针对{isBaseline ? '基准对照' : '本轮生成'}画面继续提意见
              </button>
            </figure>
          )
        })}
      </div>

      {captureError && <div className="wb-compare-error" role="alert">{captureError}</div>}

      {failed ? (
        <div className="wb-compare-error" role="alert">
          有画面加载或播放失败，请返回预览检查文件后重试。
          <button type="button" onClick={onClose}>返回预览</button>
        </div>
      ) : mode === 'linked' && left.media === 'video' && (
        <div className="wb-compare-transport">
          <button type="button" onClick={() => void playLinked()} disabled={!duration} aria-label={playing ? '暂停同步对比' : '播放同步对比'}>
            {playing ? <UiIcon icon={SemIcons.pause} size="md" /> : <UiIcon icon={SemIcons.play} size="md" />}
          </button>
          <time>{formatMediaTime(time)}</time>
          <input
            type="range"
            aria-label="同步对比时间"
            min={0}
            max={duration || 0}
            step={0.001}
            value={Math.min(time, duration)}
            disabled={!duration}
            onChange={(e) => seekLinked(Number(e.target.value))}
          />
          <time>{formatMediaTime(duration)}</time>
        </div>
      )}
    </section>
  )
}

function CompareRegionBox({ media, index, bbox: { x, y, w, h }, tickSeconds, isBaseline }: {
  media: React.RefObject<(HTMLVideoElement | HTMLImageElement | null)[]>
  index: number
  bbox: { x: number; y: number; w: number; h: number }
  tickSeconds: number
  isBaseline: boolean
}) {
  const [rect, setRect] = useState<{ left: number; top: number; width: number; height: number } | null>(null)
  useEffect(() => {
    const element = media.current[index]
    const host = element?.parentElement
    if (!element || !host) return
    const measure = () => {
      const naturalWidth = element instanceof HTMLVideoElement ? element.videoWidth : element.naturalWidth
      const naturalHeight = element instanceof HTMLVideoElement ? element.videoHeight : element.naturalHeight
      const visible = containedMediaRect(element.getBoundingClientRect(), naturalWidth, naturalHeight)
      if (!visible) return
      const box = host.getBoundingClientRect()
      setRect({
        left: visible.left - box.left + visible.width * x,
        top: visible.top - box.top + visible.height * y,
        width: visible.width * w,
        height: visible.height * h,
      })
    }
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    element.addEventListener('loadedmetadata', measure)
    element.addEventListener('load', measure)
    measure()
    return () => {
      observer.disconnect()
      element.removeEventListener('loadedmetadata', measure)
      element.removeEventListener('load', measure)
    }
  }, [media, index, x, y, w, h, tickSeconds])

  if (!rect) return null

  return (
    <div
      className={isBaseline ? 'wb-compare-region' : 'wb-compare-region border-dashed opacity-60'}
      aria-label={isBaseline ? '原目标区域' : '原位置参考（新画面可能已变动）'}
      style={rect}
    >
      <span className="text-[10px] absolute -top-5 left-0 px-1 py-0.5 rounded bg-black/75 text-white font-mono whitespace-nowrap pointer-events-none">
        {isBaseline ? '原目标区域' : '原位置参考'}
      </span>
    </div>
  )
}
