import { useCallback, useEffect, useRef, useState } from 'react'
import { UiIcon, SemIcons } from '@/shared/icons/UiIcon'
import { createNativeDocument, documentFromSource, makeLayer } from './document'
import { download, importDocument, loadManifest, readDocuments, saveDocument } from './service'
import { renderScene, type EditorRenderRecord } from './render'
import { getFileURL, initLibrary, listAssets } from '@/features/assets/services/assetApiService'
import type { MyAsset } from '@/features/assets/model/myAssets'
import type {
  EditorLayer,
  EditorManifest,
  ElementPatch,
  HtmlElementInfo,
  LayerKind,
  SceneDocument,
} from './types'
import './scene-editor.css'
import { SceneConsolePanel } from '@/features/scene-editor/components/SceneConsolePanel'
import { SceneAssetDialog } from '@/features/scene-editor/components/SceneAssetDialog'
import { SceneMain } from '@/features/scene-editor/components/SceneMain'

function stampEdit(doc: SceneDocument): SceneDocument {
  return { ...doc, updatedAt: new Date().toISOString() }
}

export function SceneEditorWorkspace({
  projectId,
  initialSceneId,
  initialDocumentId,
  initialNotice,
  onClose,
  onRendered,
  consoleHeader,
}: {
  projectId: string
  initialSceneId: string
  initialDocumentId?: string | null
  /** 进入编辑前需要用户知道的前提（例如文档与画面无法确认一致）。
      它必须显示在编辑器里 —— 监看区的提示在切换后立刻消失，用户看不到。 */
  initialNotice?: string
  onClose: () => void
  onRendered: (record: EditorRenderRecord) => void
  /** 工作台的控制台标题与页签：编辑态左栏要和普通工作台长得一样。 */
  consoleHeader?: React.ReactNode
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
  /* 轨道手柄拖动状态：记录正在改哪条图层的哪一端，以及轨道条的屏幕范围。 */
  const trackDrag = useRef<{ id: string; edge: 'start' | 'end'; trackLeft: number; trackWidth: number } | null>(null)
  /* JSON 就地编辑：官方 Studio 可以按 JSON 直接改 props，这里保留同一入口。
     编辑中的文本单独存，只有解析成功才写回文档，避免打一半字就把场景改坏。 */
  const [jsonOpen, setJsonOpen] = useState(false)
  const [jsonDraft, setJsonDraft] = useState('')
  const [jsonError, setJsonError] = useState('')
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
        /* 工作台带着「已确认的文档」进来时，只认这一份：
           找不到就如实说找不到，绝不回退到「上次编辑的文档」——
           否则用户看着 v3 的画面，打开的却是另一份内容。 */
        if (initialDocumentId) {
          const confirmed = saved.find((d) => d.id === initialDocumentId)
          if (confirmed) {
            current.current = confirmed
            setDocument(confirmed)
            setTime(Math.min(1.8, confirmed.durationSeconds * 0.5))
            /* 需要用户知道的前提留在编辑器里，而不是监看区那条一闪就没的提示。 */
            if (initialNotice) setMessage(initialNotice)
          } else {
            setMessage('该画面对应的场景文档已不存在，未打开任何其他文档。')
          }
          return
        }
        const last = localStorage.getItem(`fengmotion:editor-last:${projectId}`)
        const first =
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
            <SceneConsolePanel
              abort={abort}
              add={add}
              busy={busy}
              change={change}
              changeLayer={changeLayer}
              changePatch={changePatch}
              consoleHeader={consoleHeader}
              current={current}
              document={document}
              exportMedia={exportMedia}
              historyMove={historyMove}
              historySizes={historySizes}
              jsonDraft={jsonDraft}
              jsonError={jsonError}
              jsonOpen={jsonOpen}
              manifest={manifest}
              openAssets={openAssets}
              persist={persist}
              progress={progress}
              savedAt={savedAt}
              selected={selected}
              selectedElement={selectedElement}
              selectedLayer={selectedLayer}
              setJsonDraft={setJsonDraft}
              setJsonError={setJsonError}
              setJsonOpen={setJsonOpen}
              setMessage={setMessage}
              setSelected={setSelected}
              setTime={setTime}
              time={time}
            />
            <SceneMain
              busy={busy}
              change={change}
              changeLayer={changeLayer}
              checkpoint={checkpoint}
              current={current}
              document={document}
              elements={elements}
              endPlayback={endPlayback}
              importInput={importInput}
              load={load}
              locals={locals}
              nativeDocs={nativeDocs}
              onClose={onClose}
              persist={persist}
              playing={playing}
              projectId={projectId}
              selected={selected}
              setElements={setElements}
              setPlaying={setPlaying}
              setSelected={setSelected}
              setTime={setTime}
              sourceDocs={sourceDocs}
              time={time}
              trackDrag={trackDrag}
            />
          </div>
          {message && (
            <div className="se-notice" role="status">
              <span>{message}</span>
              <button type="button" aria-label="关闭编辑提示" onClick={() => setMessage('')}>
                <UiIcon icon={SemIcons.close} size="sm" />
              </button>
            </div>
          )}
          {rendered && (
            <details className="se-render-result">
              <summary>
                查看刚导出的视频 · {rendered.name}
                <UiIcon icon={SemIcons.collapse} size="xs" />
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
          <UiIcon icon={SemIcons.film} size="xl" />
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
          <SceneAssetDialog
            assetSearch={assetSearch}
            expectedKind={expectedKind}
            filteredAssets={filteredAssets}
            input={input}
            pickAsset={pickAsset}
            setAssetPicker={setAssetPicker}
            setAssetSearch={setAssetSearch}
            setAssets={setAssets}
            setMessage={setMessage}
          />
        </div>
      )}
    </section>
  )
}
