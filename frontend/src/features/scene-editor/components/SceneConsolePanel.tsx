import type * as React from 'react'
import { UiIcon, SemIcons } from '@/shared/icons/UiIcon'
import { Save01, RefreshCw01, RefreshCcw01, Type01, ImagePlus, Film01, MusicNote01, Square, Image01 } from '@untitledui/icons'
import type { SceneDocument, LayerKind, EditorLayer, ElementPatch, EditorManifest, HtmlElementInfo } from '@/features/scene-editor/types'
import { SceneInspector } from '@/features/scene-editor/SceneInspector'
import { exportProject, download } from '@/features/scene-editor/service'

export interface SceneConsolePanelProps {
  abort: React.RefObject<AbortController | null>
  add: (kind: LayerKind) => void
  busy: boolean
  change: (fn: (doc: SceneDocument) => SceneDocument, history?: boolean) => void
  changeLayer: (patch: Partial<EditorLayer>) => void
  changePatch: (patch: ElementPatch) => void
  consoleHeader: React.ReactNode
  current: React.RefObject<SceneDocument | null>
  document: SceneDocument
  exportMedia: (kind: 'still' | 'video') => Promise<void>
  historyMove: (back: boolean) => void
  historySizes: { undo: number; redo: number }
  jsonDraft: string
  jsonError: string
  jsonOpen: boolean
  manifest: EditorManifest
  openAssets: () => Promise<void>
  persist: (doc: SceneDocument | null) => boolean
  progress: number
  savedAt: string
  selected: string | null
  selectedElement: HtmlElementInfo | undefined
  selectedLayer: EditorLayer | undefined
  setJsonDraft: React.Dispatch<React.SetStateAction<string>>
  setJsonError: React.Dispatch<React.SetStateAction<string>>
  setJsonOpen: React.Dispatch<React.SetStateAction<boolean>>
  setMessage: React.Dispatch<React.SetStateAction<string>>
  setSelected: React.Dispatch<React.SetStateAction<string | null>>
  setTime: React.Dispatch<React.SetStateAction<number>>
  time: number
}

/** 从 SceneEditorWorkspace.tsx 原样拆出的界面区块；props 与原处的变量同名。 */
export function SceneConsolePanel({ abort, add, busy, change, changeLayer, changePatch, consoleHeader, current, document, exportMedia, historyMove, historySizes, jsonDraft, jsonError, jsonOpen, manifest, openAssets, persist, progress, savedAt, selected, selectedElement, selectedLayer, setJsonDraft, setJsonError, setJsonOpen, setMessage, setSelected, setTime, time }: SceneConsolePanelProps) {
  return (
    <aside className="se-console" aria-label="场景参数面板">
      {consoleHeader}
      <div className="se-save-status">
                      <span>
                        {savedAt ? (
                          <>
                            <UiIcon icon={SemIcons.check} size="xs" />
                            本机已保存 {savedAt}
                          </>
                        ) : (
                          '编辑副本 · 即将保存在本机'
                        )}
                      </span>
                      <button
                        type="button"
                        aria-label="立即保存场景"
                        onClick={() => persist(current.current)}
                        disabled={busy}
                      >
                        <UiIcon icon={Save01} size="sm" />
                      </button>
                      <button
                        type="button"
                        className="se-json-toggle"
                        aria-expanded={jsonOpen}
                        onClick={() => {
                          if (!jsonOpen && document) {
                            setJsonDraft(JSON.stringify(document, null, 2))
                            setJsonError('')
                          }
                          setJsonOpen((v) => !v)
                        }}
                      >
                        {'{ }'} JSON
                      </button>
                    </div>
                    {jsonOpen && (
                      <div className="se-json-editor">
                        <textarea
                          aria-label="场景 JSON"
                          spellCheck={false}
                          value={jsonDraft}
                          onChange={(e) => setJsonDraft(e.target.value)}
                        />
                        {jsonError && <p className="se-json-error">{jsonError}</p>}
                        <div className="se-json-actions">
                          <button
                            type="button"
                            onClick={() => {
                              setJsonOpen(false)
                              setJsonError('')
                            }}
                          >
                            取消
                          </button>
                          <button
                            type="button"
                            className="se-primary"
                            onClick={() => {
                              try {
                                const parsed = JSON.parse(jsonDraft) as SceneDocument
                                if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.layers)) {
                                  setJsonError('需要是一个包含 layers 数组的场景对象。')
                                  return
                                }
                                change(() => ({ ...parsed, updatedAt: new Date().toISOString() }))
                                setJsonOpen(false)
                                setJsonError('')
                              } catch (err) {
                                setJsonError(`JSON 解析失败：${String(err instanceof Error ? err.message : err)}`)
                              }
                            }}
                          >
                            应用
                          </button>
                        </div>
                      </div>
                    )}
      <div className="se-tools">
                      <div className="se-history">
                        <button
                          type="button"
                          className="se-icon"
                          aria-label="撤销编辑"
                          disabled={!historySizes.undo || busy}
                          onClick={() => historyMove(true)}
                        >
                          <UiIcon icon={RefreshCw01} size="sm" />
                        </button>
                        <button
                          type="button"
                          className="se-icon"
                          aria-label="重做编辑"
                          disabled={!historySizes.redo || busy}
                          onClick={() => historyMove(false)}
                        >
                          <UiIcon icon={RefreshCcw01} size="sm" />
                        </button>
                      </div>
                      {document.engine === 'remotion' ? (
                        <div className="se-add-tools">
                          {(
                            [
                              ['text', '文字', Type01],
                              ['image', '图片', ImagePlus],
                              ['video', '视频', Film01],
                              ['audio', '声音', MusicNote01],
                              ['shape', '形状', Square],
                            ] as const
                          ).map(([kind, label, Icon]) => (
                            <button type="button" key={kind} disabled={busy} onClick={() => add(kind)}>
                              <Icon size={13} />
                              {label}
                            </button>
                          ))}
                        </div>
                      ) : (
                        <span className="se-caption">保留原始动画 · 点击画面选择真实元素</span>
                      )}
                      <button
                        type="button"
                        className="se-icon"
                        title="场景设置"
                        aria-label="场景设置"
                        onClick={() => setSelected(null)}
                      >
                        <UiIcon icon={SemIcons.settings} size="sm" />
                      </button>
                    </div>
      <fieldset className="se-properties" disabled={busy}>
                      <SceneInspector
                        document={document}
                        layer={selectedLayer}
                        element={selectedElement}
                        selected={selected}
                        onDocument={(patch) => {
                          if (patch.durationSeconds !== undefined)
                            setTime((value) => Math.min(value, patch.durationSeconds!))
                          change((doc) => ({ ...doc, ...patch }))
                        }}
                        onLayer={changeLayer}
                        onPatch={changePatch}
                        onChooseAsset={() => void openAssets()}
                        onDelete={() => {
                          change((doc) => ({ ...doc, layers: doc.layers.filter((l) => l.id !== selected) }))
                          setSelected(null)
                        }}
                        onDuplicate={() => {
                          if (!selectedLayer) return
                          const copy = {
                            ...structuredClone(selectedLayer),
                            id: crypto.randomUUID(),
                            name: `${selectedLayer.name} 副本`,
                            x: selectedLayer.x + 30,
                            y: selectedLayer.y + 30,
                          }
                          change((doc) => ({ ...doc, layers: [...doc.layers, copy] }))
                          setSelected(copy.id)
                        }}
                        playhead={time}
                        onReorder={(direction) =>
                          change((doc) => {
                            const i = doc.layers.findIndex((l) => l.id === selected),
                              next = i + direction
                            if (next >= 0 && next < doc.layers.length)
                              [doc.layers[i], doc.layers[next]] = [doc.layers[next], doc.layers[i]]
                            return doc
                          })
                        }
                      />
                    </fieldset>
      <div className="se-export">
                      <button
                        type="button"
                        disabled={busy}
                        className="se-action"
                        onClick={() => {
                          void exportProject(structuredClone(document), manifest).catch((e) =>
                            setMessage(`工程导出失败：${e.message}`),
                          )
                        }}
                      >
                        <UiIcon icon={SemIcons.download} size="xs" />
                        导出工程包
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        className="se-action"
                        onClick={() =>
                          download(
                            new Blob([JSON.stringify(document, null, 2)], { type: 'application/json' }),
                            `${document.name}.json`,
                          )
                        }
                      >
                        导出参数 JSON
                      </button>
                      {document.engine === 'remotion' ? (
                        <>
                          <button
                            type="button"
                            className="se-action"
                            disabled={busy}
                            onClick={() => void exportMedia('still')}
                          >
                            <UiIcon icon={Image01} size="xs" />
                            导出当前帧
                          </button>
                          <button
                            type="button"
                            className="se-primary"
                            disabled={busy}
                            onClick={() => void exportMedia('video')}
                          >
                            <UiIcon icon={SemIcons.film} size="xs" />
                            导出场景视频
                          </button>
                        </>
                      ) : (
                        <p className="se-caption">此 HTML 引擎支持源工程包导出；视频编码器尚未连接。</p>
                      )}
                      {busy && (
                        <div className="se-render-progress" role="status">
                          <UiIcon icon={SemIcons.loading} size="xs" className="animate-spin" />
                          <span>实际渲染中 {Math.round(progress * 100)}%</span>
                          <button type="button" onClick={() => abort.current?.abort()}>
                            取消
                          </button>
                        </div>
                      )}
                    </div>
    </aside>
  )
}
