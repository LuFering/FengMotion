import type * as React from 'react'
import type { EditorLayer, SceneDocument, HtmlElementInfo } from '@/features/scene-editor/types'

export interface SceneTracksProps {
  changeLayer: (patch: Partial<EditorLayer>) => void
  checkpoint: () => void
  document: SceneDocument
  elements: HtmlElementInfo[]
  selected: string | null
  setSelected: React.Dispatch<React.SetStateAction<string | null>>
  trackDrag: React.RefObject<{ id: string; edge: 'start' | 'end'; trackLeft: number; trackWidth: number } | null>
}

/** 从 SceneEditorWorkspace.tsx 原样拆出的界面区块；props 与原处的变量同名。 */
export function SceneTracks({ changeLayer, checkpoint, document, elements, selected, setSelected, trackDrag }: SceneTracksProps) {
  return (
    <div className="se-tracks">
      <div className="se-track-heading">
        <span>{document.engine === 'html-gsap' ? '源场景元素' : '图层与时间范围'}</span>
        <small>
          {document.engine === 'html-gsap' ? elements.length : document.layers.length} 项
        </small>
      </div>
      <div className="se-track-list">
        {document.engine === 'html-gsap'
          ? elements.map((el) => (
              <button
                type="button"
                key={el.id}
                aria-pressed={selected === el.id}
                onClick={() => setSelected(el.id)}
              >
                <span className="se-track-type">
                  {el.kind === 'text' ? 'T' : el.kind === 'image' ? 'IMG' : 'G'}
                </span>
                <b>{el.name}</b>
                <small>{el.id}</small>
              </button>
            ))
          : [...document.layers].reverse().map((layer) => (
              <button
                type="button"
                key={layer.id}
                aria-pressed={selected === layer.id}
                onClick={() => setSelected(layer.id)}
              >
                <span className="se-track-type">
                  {layer.kind === 'text'
                    ? 'T'
                    : layer.kind === 'audio'
                      ? 'SND'
                      : layer.kind.toUpperCase()}
                </span>
                <b>
                  {layer.name}
                  {layer.locked ? ' · 锁定' : ''}
                  {!layer.visible ? ' · 隐藏' : ''}
                </b>
                <span className="se-track-range">
                  {/* 左右两个手柄拖动入点与出点；条身拖动整体平移。
                      官方时间轴可以「延长手柄」，以前这里只能看不能改。 */}
                  <span
                    className="se-track-handle"
                    data-edge="start"
                    role="slider"
                    tabIndex={0}
                    aria-label={`${layer.name} 入点`}
                    aria-valuemin={0}
                    aria-valuemax={document.durationSeconds}
                    aria-valuenow={Number(layer.start.toFixed(2))}
                    onPointerDown={(e) => {
                      e.stopPropagation()
                      if (layer.locked) return
                      e.currentTarget.setPointerCapture(e.pointerId)
                      const track = e.currentTarget.parentElement!.getBoundingClientRect()
                      trackDrag.current = {
                        id: layer.id, edge: 'start', trackLeft: track.left, trackWidth: track.width,
                      }
                      checkpoint()
                    }}
                    onPointerMove={(e) => {
                      const state = trackDrag.current
                      if (!state || state.id !== layer.id || state.edge !== 'start') return
                      const ratio = Math.max(0, Math.min(1, (e.clientX - state.trackLeft) / state.trackWidth))
                      const next = ratio * document.durationSeconds
                      changeLayer({ start: Math.min(Number(next.toFixed(2)), layer.end - 0.1) })
                    }}
                    onPointerUp={(e) => {
                      trackDrag.current = null
                      e.currentTarget.releasePointerCapture(e.pointerId)
                    }}
                    onKeyDown={(e) => {
                      if (layer.locked) return
                      if (e.key === 'ArrowLeft') { e.preventDefault(); changeLayer({ start: Math.max(0, Number((layer.start - 0.1).toFixed(2))) }) }
                      if (e.key === 'ArrowRight') { e.preventDefault(); changeLayer({ start: Math.min(layer.end - 0.1, Number((layer.start + 0.1).toFixed(2))) }) }
                    }}
                  />
                  <span
                    className="se-track-handle"
                    data-edge="end"
                    role="slider"
                    tabIndex={0}
                    aria-label={`${layer.name} 出点`}
                    aria-valuemin={0}
                    aria-valuemax={document.durationSeconds}
                    aria-valuenow={Number(layer.end.toFixed(2))}
                    onPointerDown={(e) => {
                      e.stopPropagation()
                      if (layer.locked) return
                      e.currentTarget.setPointerCapture(e.pointerId)
                      const track = e.currentTarget.parentElement!.getBoundingClientRect()
                      trackDrag.current = {
                        id: layer.id, edge: 'end', trackLeft: track.left, trackWidth: track.width,
                      }
                      checkpoint()
                    }}
                    onPointerMove={(e) => {
                      const state = trackDrag.current
                      if (!state || state.id !== layer.id || state.edge !== 'end') return
                      const ratio = Math.max(0, Math.min(1, (e.clientX - state.trackLeft) / state.trackWidth))
                      const next = ratio * document.durationSeconds
                      changeLayer({ end: Math.max(Number(next.toFixed(2)), layer.start + 0.1) })
                    }}
                    onPointerUp={(e) => {
                      trackDrag.current = null
                      e.currentTarget.releasePointerCapture(e.pointerId)
                    }}
                    onKeyDown={(e) => {
                      if (layer.locked) return
                      if (e.key === 'ArrowLeft') { e.preventDefault(); changeLayer({ end: Math.max(layer.start + 0.1, Number((layer.end - 0.1).toFixed(2))) }) }
                      if (e.key === 'ArrowRight') { e.preventDefault(); changeLayer({ end: Math.min(document.durationSeconds, Number((layer.end + 0.1).toFixed(2))) }) }
                    }}
                  />
                  <i
                    style={{
                      left: `${(layer.start / document.durationSeconds) * 100}%`,
                      width: `${((layer.end - layer.start) / document.durationSeconds) * 100}%`,
                    }}
                  />
                </span>
                <small>
                  {layer.start.toFixed(1)}–{layer.end.toFixed(1)}s
                </small>
              </button>
            ))}
      </div>
    </div>
  )
}
