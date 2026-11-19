import type * as React from 'react'
import { UiIcon, SemIcons } from '@/shared/icons/UiIcon'
import { createNativeDocument } from '@/features/scene-editor/model/document'
import { HtmlScenePreview } from '@/features/scene-editor/components/HtmlScenePreview'
import { NativeScenePreview } from '@/features/scene-editor/components/NativeScenePreview'
import { SceneTracks } from '@/features/scene-editor/components/SceneTracks'
import type { SceneDocument, EditorLayer, HtmlElementInfo } from '@/features/scene-editor/model/types'

export interface SceneMainProps {
  busy: boolean
  change: (fn: (doc: SceneDocument) => SceneDocument, history?: boolean) => void
  changeLayer: (patch: Partial<EditorLayer>) => void
  checkpoint: () => void
  current: React.RefObject<SceneDocument | null>
  document: SceneDocument
  elements: HtmlElementInfo[]
  endPlayback: () => void
  importInput: React.RefObject<HTMLInputElement | null>
  load: (doc: SceneDocument) => void
  locals: SceneDocument[]
  nativeDocs: SceneDocument[]
  onClose: () => void
  persist: (doc: SceneDocument | null) => boolean
  playing: boolean
  projectId: string
  selected: string | null
  setElements: React.Dispatch<React.SetStateAction<HtmlElementInfo[]>>
  setPlaying: React.Dispatch<React.SetStateAction<boolean>>
  setSelected: React.Dispatch<React.SetStateAction<string | null>>
  setTime: React.Dispatch<React.SetStateAction<number>>
  sourceDocs: SceneDocument[]
  time: number
  trackDrag: React.RefObject<{ id: string; edge: 'start' | 'end'; trackLeft: number; trackWidth: number } | null>
}

/** 场景编辑器的主区：顶栏切换、新建、导入场景与返回工作台，中间是场景预览、播放条和图层轨道。 */
export function SceneMain({ busy, change, changeLayer, checkpoint, current, document, elements, endPlayback, importInput, load, locals, nativeDocs, onClose, persist, playing, projectId, selected, setElements, setPlaying, setSelected, setTime, sourceDocs, time, trackDrag }: SceneMainProps) {
  return (
    <div className="se-main">
      <header className="se-header">
        <div className="se-title">
          <span className="se-editor-symbol">
            <UiIcon icon={SemIcons.film} size="md" />
          </span>
          <div>
            <strong>场景编辑器</strong>
            <small>
              {document?.engine === 'html-gsap' ? 'HTML + GSAP · 真实源工程' : 'Remotion · 图层合成'}
            </small>
          </div>
        </div>
        <select
          aria-label="选择编辑场景"
          disabled={busy}
          value={document?.id ?? ''}
          onChange={(e) => {
            const doc = [...locals, ...sourceDocs].find((d) => d.id === e.target.value)
            if (doc) load(doc)
          }}
        >
          <option value="" disabled>
            选择源场景
          </option>
          {sourceDocs.length > 0 && (
            <optgroup label="已绑定的 HTML 源工程">
              {sourceDocs.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </optgroup>
          )}
          <optgroup label="本项目 Remotion 场景">
            {[
              ...nativeDocs,
              ...(document?.engine === 'remotion' && !nativeDocs.some((d) => d.id === document.id)
                ? [document]
                : []),
            ].map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </optgroup>
        </select>
        <button
          type="button"
          className="se-header-action"
          disabled={busy}
          onClick={() => load(createNativeDocument(projectId))}
        >
          <UiIcon icon={SemIcons.plus} size="sm" />
          新建 Remotion
        </button>
        <span className="se-header-spacer" />
        <button
          type="button"
          disabled={busy}
          className="se-icon"
          aria-label="导入场景文档或工程包"
          title="导入场景 JSON / ZIP"
          onClick={() => importInput.current?.click()}
        >
          <UiIcon icon={SemIcons.upload} size="sm" />
        </button>
        <button
          type="button"
          disabled={busy}
          className="se-exit"
          onClick={() => {
            persist(current.current)
            setPlaying(false)
            onClose()
          }}
        >
          <UiIcon icon={SemIcons.back} size="xs" />
          返回工作台
        </button>
      </header>
      <div className="se-stage" style={busy ? { pointerEvents: 'none' } : undefined}>
                {document.engine === 'html-gsap' ? (
                  <HtmlScenePreview
                    key={document.id}
                    document={document}
                    time={time}
                    selected={selected}
                    onSelect={setSelected}
                    onElements={setElements}
                  />
                ) : (
                  <NativeScenePreview
                    key={document.id}
                    document={document}
                    time={time}
                    playing={playing}
                    onEnded={endPlayback}
                    selected={selected}
                    onSelect={setSelected}
                    onTime={setTime}
                    onGestureStart={checkpoint}
                    onMove={(id, x, y) =>
                      change(
                        (doc) => ({
                          ...doc,
                          layers: doc.layers.map((l) => (l.id === id ? { ...l, x, y } : l)),
                        }),
                        false,
                      )
                    }
                  />
                )}
              </div>
      <div className="se-transport">
                <button
                  type="button"
                  aria-label={playing ? '暂停场景' : '播放场景'}
                  onClick={() => {
                    if (time >= document.durationSeconds - 0.05) setTime(0)
                    setPlaying(!playing)
                  }}
                >
                  {playing ? <UiIcon icon={SemIcons.pause} size="md" /> : <UiIcon icon={SemIcons.play} size="md" />}
                </button>
                <span>{time.toFixed(2)}s</span>
                <input
                  aria-label="场景播放时间"
                  type="range"
                  min={0}
                  max={document.durationSeconds}
                  step={1 / document.fps}
                  value={Math.min(time, document.durationSeconds)}
                  onChange={(e) => {
                    setPlaying(false)
                    setTime(Number(e.target.value))
                  }}
                />
                <span>{document.durationSeconds.toFixed(2)}s</span>
                <small>
                  {document.width} × {document.height} · {document.fps} fps
                </small>
              </div>
      <SceneTracks
        changeLayer={changeLayer}
        checkpoint={checkpoint}
        document={document}
        elements={elements}
        selected={selected}
        setSelected={setSelected}
        trackDrag={trackDrag}
      />
    </div>
  )
}
