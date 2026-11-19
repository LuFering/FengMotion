import { useEffect, useRef, useState, type ComponentType } from 'react'
import { Player, type PlayerRef } from '@remotion/player'
import { originalSceneLoader } from './fxOriginalRegistry'

/** 指定来源的原始组件；支持静态定格帧预览与 hover 动态播放 */
export default function FxOriginalWavesPreview({
  sourceProject,
  sourcePath,
  playing = false,
}: {
  sourceProject: string
  sourcePath: string
  playing?: boolean
}) {
  const host = useRef<HTMLDivElement>(null)
  const playerRef = useRef<PlayerRef>(null)
  const [visible, setVisible] = useState(true)
  const [foreground, setForeground] = useState(!document.hidden)
  const [scene, setScene] = useState<ComponentType | null>(null)
  const [failed, setFailed] = useState(false)
  const [dimensions, setDimensions] = useState({ width: 1280, height: 720, duration: 180 })

  useEffect(() => {
    let cancelled = false
    setScene(null)
    setFailed(false)
    const descriptor = originalSceneLoader(sourceProject, sourcePath)
    if (!descriptor) { setFailed(true); return }
    void descriptor.loader().then((loaded) => {
      const exports = loaded as Record<string, unknown>
      const component = exports[descriptor.exportName]
      if (typeof component !== 'function') throw new Error('未找到对应场景导出')
      const rawDuration = descriptor.durationExport ? exports[descriptor.durationExport] : 180
      if (typeof rawDuration !== 'number' || !Number.isInteger(rawDuration) || rawDuration < 1 || rawDuration > 3600) throw new Error('场景时长无效')
      if (!cancelled) {
        setDimensions({ width: descriptor.width, height: descriptor.height, duration: rawDuration })
        setScene(() => component as ComponentType)
      }
    }).catch(() => { if (!cancelled) setFailed(true) })
    return () => { cancelled = true }
  }, [sourcePath, sourceProject])

  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: 0.05 })
    if (host.current) observer.observe(host.current)
    const changed = () => setForeground(!document.hidden)
    document.addEventListener('visibilitychange', changed)
    return () => { observer.disconnect(); document.removeEventListener('visibilitychange', changed) }
  }, [])

  // 严格受控播放：hover 时动起来，未 hover 时定格，零 CPU/GPU 占用
  useEffect(() => {
    const ref = playerRef.current
    if (!ref || !scene) return
    if (playing && visible && foreground) {
      ref.play()
    } else {
      ref.pause()
    }
  }, [playing, visible, foreground, scene])

  // 定格在展开关键帧（避免开场白屏或黑屏）
  const initialFrame = Math.min(30, Math.floor(dimensions.duration * 0.25))

  return (
    <div className="fx-original-preview" ref={host} aria-label="原始画面快照帧预览">
      {failed && <span className="fxc-media-empty">原始画面加载失败</span>}
      {!scene && !failed && <span className="fxc-media-empty">正在加载画面帧…</span>}
      {scene && visible && foreground && (
        <Player
          ref={playerRef}
          component={scene}
          compositionWidth={dimensions.width}
          compositionHeight={dimensions.height}
          fps={30}
          durationInFrames={dimensions.duration}
          initialFrame={initialFrame}
          numberOfSharedAudioTags={0}
          autoPlay={false}
          loop
          controls={false}
          style={{ width: '100%', height: '100%', pointerEvents: 'none' }}
        />
      )}
    </div>
  )
}
