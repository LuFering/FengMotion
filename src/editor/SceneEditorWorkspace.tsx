import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ArrowLeft,
  Check,
  ChevronDown,
  Download,
  FileImage,
  Film,
  ImagePlus,
  LoaderCircle,
  Music2,
  Pause,
  Play,
  Plus,
  Redo2,
  Save,
  Settings2,
  Square,
  Type,
  Undo2,
  Upload,
  X,
} from 'lucide-react'
import { createNativeDocument, documentFromSource, makeLayer } from './document'
import { download, exportProject, importDocument, loadManifest, readDocuments, saveDocument } from './service'
import { SceneInspector } from './SceneInspector'
import { HtmlScenePreview } from './HtmlScenePreview'
import { NativeScenePreview } from './NativeScenePreview'
import { renderScene, type EditorRenderRecord } from './render'
import { getFileURL, importFiles, initLibrary, listAssets } from '@/services/assetService'
import type { MyAsset } from '@/data/myAssets'
import type {
  EditorLayer,
  EditorManifest,
  ElementPatch,
  HtmlElementInfo,
  LayerKind,
  SceneDocument,
} from './types'
import './scene-editor.css'

function stampEdit(doc: SceneDocument): SceneDocument {
  return { ...doc, updatedAt: new Date().toISOString() }
}

export function SceneEditorWorkspace({
  projectId,
  initialSceneId,
  initialDocumentId,
  onClose,
  onRendered,
}: {
  projectId: string
  initialSceneId: string
  initialDocumentId?: string | null
  onClose: () => void
  onRendered: (record: EditorRenderRecord) => void
}) {
  const [manifest, setManifest] = useState<EditorManifest>({ projectId, scenes: [], assets: [] })
  const [locals, setLocals] = useState(() => readDocuments(projectId))
  const [document, setDocument] = useState<SceneDocument | null>(null)
  const current = useRef<SceneDocument | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [elements, setElements] = useState<HtmlElementInfo[]>([])
  const [time, setTime] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(true)
  const [savedAt, setSavedAt] = useState('')
  const undo = useRef<SceneDocument[]>([]),
    redo = useRef<SceneDocument[]>([])
  const [historySizes, setHistorySizes] = useState({ undo: 0, redo: 0 })
  const refreshHistory = () => setHistorySizes({ undo: undo.current.length, redo: redo.current.length })
  const [assetPicker, setAssetPicker] = useState(false)
  const [assets, setAssets] = useState<MyAsset[]>([])
  const [assetSearch, setAssetSearch] = useState('')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const abort = useRef<AbortController | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const importInput = useRef<HTMLInputElement>(null)
  const [rendered, setRendered] = useState<{ url: string; name: string } | null>(null)
  const update = (next: SceneDocument) => {
    current.current = next
    setDocument(next)
  }
  const persist = useCallback(
    (doc: SceneDocument | null) => {
      if (!doc) return false
      try {
        saveDocument(doc)
        setLocals(readDocuments(projectId))
        setSavedAt(
          new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        )
        return true
      } catch {
        setMessage('本地保存失败，请导出场景文档备份。')
        return false
      }
    },
    [projectId],
  )
  const load = (doc: SceneDocument) => {
    if (current.current && !persist(current.current)) return
    setPlaying(false)
    undo.current = []
    redo.current = []
    refreshHistory()
    setSelected(null)
    setElements([])
    setTime(Math.min(1.8, doc.durationSeconds * 0.5))
    setSavedAt('')
    update(structuredClone(doc))
    setMessage('')
  }
  useEffect(() => {
    let active = true
    void loadManifest(projectId)
      .then((value) => {
        if (!active) return
        setManifest(value)
        const saved = readDocuments(projectId)
        const matching = value.scenes.find((s) => s.id === initialSceneId) ?? value.scenes[0]
        const last = localStorage.getItem(`fengmotion:editor-last:${projectId}`)
        const first =
          saved.find((d) => d.id === initialDocumentId) ??
          saved.find((d) => d.id === last) ??
          saved.find((d) => d.source?.id === matching?.id) ??
          (matching ? documentFromSource(projectId, matching) : saved[0])
        if (first) {
          current.current = first
          setDocument(first)
          setTime(Math.min(1.8, first.durationSeconds * 0.5))
        }
      })
      .catch((e) => active && setMessage(String(e)))
      .finally(() => active && setLoading(false))
    return () => {
      active = false
      abort.current?.abort()
    }
  }, [projectId, initialSceneId, initialDocumentId])
  useEffect(() => {
    if (!document) return
    const timer = setTimeout(() => persist(document), 600)
    return () => clearTimeout(timer)
  }, [document, persist])
  const timeRef = useRef(time)
  useEffect(() => {
    timeRef.current = time
  }, [time])
  useEffect(() => {
    if (!playing || document?.engine !== 'html-gsap') return
    const initial = timeRef.current
    let start: number | undefined, id: number
    const tick = (now: number) => {
      start ??= now
      const next = Math.min(document.durationSeconds, initial + (now - start) / 1000)
      setTime(next)
      if (next >= document.durationSeconds) setPlaying(false)
      else id = requestAnimationFrame(tick)
    }
    id = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(id)
  }, [playing, document?.id, document?.engine, document?.durationSeconds])
  useEffect(
    () => () => {
      if (rendered) URL.revokeObjectURL(rendered.url)
    },
    [rendered],
  )
  const checkpoint = () => {
    if (current.current) {
      undo.current = [...undo.current.slice(-49), structuredClone(current.current)]
      redo.current = []
      refreshHistory()
    }
  }
  const change = (fn: (doc: SceneDocument) => SceneDocument, history = true) => {
    if (!current.current || busy) return
    if (history) checkpoint()
    update(stampEdit(fn(structuredClone(current.current))))
  }
  const changeLayer = (patch: Partial<EditorLayer>) =>
    change((doc) => ({ ...doc, layers: doc.layers.map((l) => (l.id === selected ? { ...l, ...patch } : l)) }))
  const changePatch = (patch: ElementPatch) => {
    if (!selected) return
    change((doc) => ({
      ...doc,
      patches: { ...doc.patches, [selected]: { ...doc.patches[selected], ...patch } },
    }))
  }
  const historyMove = (back: boolean) => {
    const from = back ? undo.current : redo.current,
      to = back ? redo.current : undo.current
    const next = from.pop()
    if (!next || !current.current) return
    to.push(structuredClone(current.current))
    update(next)
    refreshHistory()
    setPlaying(false)
  }
  const endPlayback = useCallback(() => setPlaying(false), [])
  const add = (kind: LayerKind) => {
    if (!document) return
    const layer = makeLayer(kind, document.durationSeconds, document.layers.length)
    layer.width = Math.round(document.width * (kind === 'text' ? 0.8 : 0.65))
    layer.height = Math.round(document.height * (kind === 'text' ? 0.2 : 0.65))
    layer.x = Math.round((document.width - layer.width) / 2)
    layer.y = Math.round((document.height - layer.height) / 2)
    change((doc) => ({ ...doc, layers: [...doc.layers, layer] }))
    setSelected(layer.id)
    if (['image', 'video', 'audio'].includes(kind)) void openAssets()
  }
  async function openAssets() {
    try {
      await initLibrary()
      setAssets(await listAssets())
      setAssetSearch('')
      setAssetPicker(true)
    } catch {
      setMessage('素材库加载失败。')
    }
  }
  const pickAsset = async (asset: MyAsset) => {
    if (!document || !selected) return
    try {
      const src = await getFileURL(asset.id)
      if (!src) throw Error('文件不可用')
      if (document.engine === 'remotion')
        changeLayer({
          assetId: asset.id,
          src: asset.sourceType === 'builtin' ? src : undefined,
          name: asset.name,
          ...(asset.duration
            ? {
                end: Math.min(
                  document.durationSeconds,
                  (document.layers.find((l) => l.id === selected)?.start ?? 0) + asset.duration,
                ),
              }
            : {}),
        })
      else changePatch({ assetId: asset.id, src: asset.sourceType === 'builtin' ? src : undefined })
      setAssetPicker(false)
    } catch (e) {
      setMessage(String(e))
    }
  }
  const exportMedia = async (kind: 'still' | 'video') => {
    if (!document) return
    setBusy(true)
    setProgress(0)
    setPlaying(false)
    setMessage('')
    abort.current = new AbortController()
    persist(current.current)
    try {
      const result = await renderScene(
        structuredClone(document),
        kind,
        time,
        abort.current.signal,
        setProgress,
      )
      download(result.blob, result.name)
      setMessage(kind === 'still' ? '当前帧已导出为 PNG。' : '新视频已真实生成，并保存到素材库。')
      if (result.record) {
        onRendered(result.record)
        setRendered({ url: URL.createObjectURL(result.blob), name: result.name })
      }
    } catch (e) {
      setMessage(
        abort.current.signal.aborted
          ? '已取消导出。'
          : `导出未完成：${e instanceof Error ? e.message : String(e)}`,
      )
    } finally {
      setBusy(false)
    }
  }
  const sourceDocs = manifest.scenes.map((s) => documentFromSource(projectId, s))
  const nativeDocs = locals.filter((d) => d.engine === 'remotion')
  const selectedLayer = document?.layers.find((l) => l.id === selected)
  const selectedElement = elements.find((e) => e.id === selected)
  const expectedKind = document?.engine === 'html-gsap' ? 'image' : selectedLayer?.kind
  const filteredAssets = assets.filter(
    (a) => a.mediaType === expectedKind && a.name.toLowerCase().includes(assetSearch.toLowerCase()),
  )
  return (
    <section
      className="se-workspace"
      aria-label="源工程场景编辑器"
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          if (assetPicker) setAssetPicker(false)
          else setSelected(null)
          return
        }
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
          event.preventDefault()
          persist(current.current)
          return
        }
        if ((event.target as HTMLElement).closest('input,textarea,select,[contenteditable=true]')) return
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
          event.preventDefault()
          historyMove(!event.shiftKey)
        }
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
          event.preventDefault()
          historyMove(false)
        }
      }}
    >
      <header className="se-header">
        <div className="se-title">
          <span className="se-editor-symbol">
            <Film size={16} />
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
          <Plus size={13} />
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
          <Upload size={15} />
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
          <ArrowLeft size={13} />
          返回工作台
        </button>
      </header>
      <input
        hidden
        ref={importInput}
        type="file"
        accept=".json,.zip,application/json,application/zip"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file)
            void importDocument(file, projectId, manifest)
              .then(load)
              .catch((err) => setMessage(String(err)))
          e.target.value = ''
        }}
      />
      {document ? (
        <>
          <div className="se-body">
            <div className="se-main">
              <div className="se-tools">
                <div className="se-history">
                  <button
                    type="button"
                    className="se-icon"
                    aria-label="撤销编辑"
                    disabled={!historySizes.undo || busy}
                    onClick={() => historyMove(true)}
                  >
                    <Undo2 size={15} />
                  </button>
                  <button
                    type="button"
                    className="se-icon"
                    aria-label="重做编辑"
                    disabled={!historySizes.redo || busy}
                    onClick={() => historyMove(false)}
                  >
                    <Redo2 size={15} />
                  </button>
                </div>
                {document.engine === 'remotion' ? (
                  <div className="se-add-tools">
                    {(
                      [
                        ['text', '文字', Type],
                        ['image', '图片', ImagePlus],
                        ['video', '视频', Film],
                        ['audio', '声音', Music2],
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
                  <Settings2 size={15} />
                </button>
              </div>
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
                  {playing ? <Pause size={16} /> : <Play size={16} />}
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
            </div>
            <aside className="se-inspector" aria-label="场景参数面板">
              <div className="se-save-status">
                <span>
                  {savedAt ? (
                    <>
                      <Check size={11} />
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
                  <Save size={13} />
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
                  <Download size={13} />
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
                      <FileImage size={13} />
                      导出当前帧
                    </button>
                    <button
                      type="button"
                      className="se-primary"
                      disabled={busy}
                      onClick={() => void exportMedia('video')}
                    >
                      <Film size={13} />
                      导出场景视频
                    </button>
                  </>
                ) : (
                  <p className="se-caption">此 HTML 引擎支持源工程包导出；视频编码器尚未连接。</p>
                )}
                {busy && (
                  <div className="se-render-progress" role="status">
                    <LoaderCircle size={13} className="animate-spin" />
                    <span>实际渲染中 {Math.round(progress * 100)}%</span>
                    <button type="button" onClick={() => abort.current?.abort()}>
                      取消
                    </button>
                  </div>
                )}
              </div>
            </aside>
          </div>
          {message && (
            <div className="se-notice" role="status">
              <span>{message}</span>
              <button type="button" aria-label="关闭编辑提示" onClick={() => setMessage('')}>
                <X size={13} />
              </button>
            </div>
          )}
          {rendered && (
            <details className="se-render-result">
              <summary>
                查看刚导出的视频 · {rendered.name}
                <ChevronDown size={12} />
              </summary>
              <video src={rendered.url} controls playsInline />
              <a href={rendered.url} download={rendered.name}>
                下载已生成的视频
              </a>
            </details>
          )}
        </>
      ) : (
        <div className="se-empty">
          <Film size={32} />
          <h2>{loading ? '正在读取源工程…' : '这个项目还没有可编辑场景'}</h2>
          <p>
            {message || '可以新建 Remotion 场景，或导入已保存的场景 JSON。已渲染的 MP4 无法还原成原始图层。'}
          </p>
          <button type="button" className="se-primary" onClick={() => load(createNativeDocument(projectId))}>
            新建 Remotion 场景
          </button>
        </div>
      )}
      {assetPicker && (
        <div className="se-modal-backdrop">
          <section className="se-asset-dialog" role="dialog" aria-modal="true" aria-label="选择真实素材">
            <header>
              <div>
                <h2>
                  选择{expectedKind === 'image' ? '图片' : expectedKind === 'video' ? '视频' : '声音'}素材
                </h2>
                <p>绑定素材库文件，支持本机持久化。</p>
              </div>
              <button
                type="button"
                className="se-icon"
                aria-label="关闭素材选择"
                onClick={() => setAssetPicker(false)}
              >
                <X size={18} />
              </button>
            </header>
            <div className="se-asset-search">
              <input
                aria-label="搜索编辑素材"
                placeholder="搜索文件名"
                value={assetSearch}
                onChange={(e) => setAssetSearch(e.target.value)}
              />
              <button type="button" className="se-action" onClick={() => input.current?.click()}>
                <Upload size={13} />
                导入文件
              </button>
              <input
                ref={input}
                hidden
                type="file"
                accept={`${expectedKind}/*`}
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? [])
                  if (files.length)
                    void importFiles(files, () => {})
                      .then(async (imported) => {
                        setAssets(await listAssets())
                        if (imported[0]) await pickAsset(imported[0])
                      })
                      .catch((err) => setMessage(String(err)))
                  e.target.value = ''
                }}
              />
            </div>
            <div className="se-assets">
              {filteredAssets.length ? (
                filteredAssets.slice(0, 80).map((asset) => (
                  <button key={asset.id} type="button" onClick={() => void pickAsset(asset)}>
                    {asset.mediaType === 'image' && asset.sourceType === 'builtin' ? (
                      <img src={asset.filePath} alt="" />
                    ) : asset.mediaType === 'video' ? (
                      <Film size={25} />
                    ) : asset.mediaType === 'audio' ? (
                      <Music2 size={25} />
                    ) : (
                      <ImagePlus size={25} />
                    )}
                    <span>{asset.name}</span>
                    <small>
                      {asset.width && asset.height
                        ? `${asset.width} × ${asset.height}`
                        : asset.duration
                          ? `${asset.duration.toFixed(1)}s`
                          : asset.sourceType === 'imported'
                            ? '本机文件'
                            : '素材文件'}
                    </small>
                  </button>
                ))
              ) : (
                <p>还没有匹配的文件，可以导入自己的素材。</p>
              )}
            </div>
          </section>
        </div>
      )}
    </section>
  )
}
