import { useEffect, useRef, useState } from 'react'
import { Player, type PlayerRef } from '@remotion/player'
import { SceneComposition } from './SceneComposition'
import type { SceneDocument } from './types'
import { resolveDocument } from './service'
export function NativeScenePreview({
  document,
  time,
  selected,
  onSelect,
  onMove,
  onGestureStart,
  onTime,
  playing,
  onEnded,
}: {
  document: SceneDocument
  time: number
  playing: boolean
  onEnded: () => void
  selected: string | null
  onSelect: (id: string) => void
  onMove: (id: string, x: number, y: number) => void
  onGestureStart: () => void
  onTime: (seconds: number) => void
}) {
  const [resolved, setResolved] = useState<SceneDocument | null>(null)
  const [error, setError] = useState('')
  const [size, setSize] = useState({ width: 0, height: 0 })
  const host = useRef<HTMLDivElement>(null)
  const player = useRef<PlayerRef>(null)
  const dragging = useRef<{
    id: string
    x: number
    y: number
    px: number
    py: number
    started: boolean
  } | null>(null)
  useEffect(() => {
    let active = true
    void resolveDocument(document)
      .then((doc) => {
        if (active) {
          setResolved(doc)
          setError('')
        }
      })
      .catch((e) => active && setError(String(e)))
    return () => {
      active = false
    }
  }, [document])
  useEffect(() => {
    const el = host.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) =>
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height }),
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    const p = player.current
    if (!p) return
    if (playing) void p.play()
    else p.pause()
  }, [playing, resolved?.id])
  useEffect(() => {
    const p = player.current
    if (p && !p.isPlaying()) {
      const target = Math.min(
        Math.round(time * document.fps),
        Math.round(document.durationSeconds * document.fps) - 1,
      )
      if (p.getCurrentFrame() !== target) p.seekTo(target)
    }
  }, [time, document.fps, document.durationSeconds, resolved?.id])
  useEffect(() => {
    const p = player.current
    if (!p) return
    const handler = ({ detail }: { detail: { frame: number } }) => {
      if (p.isPlaying()) onTime(detail.frame / document.fps)
    }
    p.addEventListener('frameupdate', handler)
    p.addEventListener('ended', onEnded)
    return () => {
      p.removeEventListener('frameupdate', handler)
      p.removeEventListener('ended', onEnded)
    }
  }, [document.fps, resolved, onTime, onEnded])
  const scale = Math.min(size.width / document.width, size.height / document.height) || 0
  return (
    <div ref={host} className="se-native-host">
      {error ? (
        <div className="se-message" role="alert">
          {error}
        </div>
      ) : (
        resolved && (
          <div
            className="se-native-canvas"
            style={{ width: document.width * scale, height: document.height * scale }}
          >
            <Player
              ref={player}
              component={SceneComposition}
              inputProps={{ document: resolved }}
              compositionWidth={document.width}
              compositionHeight={document.height}
              fps={document.fps}
              durationInFrames={Math.max(1, Math.round(document.durationSeconds * document.fps))}
              acknowledgeRemotionLicense
              style={{ width: '100%', height: '100%' }}
            />
            <div className="se-layer-overlay">
              {document.layers
                .filter((l) => l.visible && l.kind !== 'audio' && time >= l.start && time < l.end)
                .map((layer) => (
                  <button
                    key={layer.id}
                    type="button"
                    aria-label={`选择图层：${layer.name}`}
                    data-selected={selected === layer.id}
                    style={{
                      left: layer.x * scale,
                      top: layer.y * scale,
                      width: layer.width * scale,
                      height: layer.height * scale,
                      transform: `rotate(${layer.rotation}deg)`,
                    }}
                    onClick={() => onSelect(layer.id)}
                    onPointerDown={(e) => {
                      onSelect(layer.id)
                      if (layer.locked) return
                      e.currentTarget.setPointerCapture(e.pointerId)
                      dragging.current = {
                        id: layer.id,
                        x: layer.x,
                        y: layer.y,
                        px: e.clientX,
                        py: e.clientY,
                        started: false,
                      }
                    }}
                    onPointerMove={(e) => {
                      const drag = dragging.current
                      if (drag) {
                        if (!drag.started) {
                          if (Math.hypot(e.clientX - drag.px, e.clientY - drag.py) < 2) return
                          onGestureStart()
                          drag.started = true
                        }
                        onMove(
                          drag.id,
                          Math.round(drag.x + (e.clientX - drag.px) / scale),
                          Math.round(drag.y + (e.clientY - drag.py) / scale),
                        )
                      }
                    }}
                    onPointerUp={() => {
                      dragging.current = null
                    }}
                    onPointerCancel={() => {
                      dragging.current = null
                    }}
                  >
                    {selected === layer.id && (
                      <span>
                        {layer.name}
                        {layer.locked ? ' · 已锁定' : ''}
                      </span>
                    )}
                  </button>
                ))}
            </div>
          </div>
        )
      )}
    </div>
  )
}
