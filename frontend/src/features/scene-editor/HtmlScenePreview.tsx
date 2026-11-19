import { useEffect, useRef, useState } from 'react'
import type { HtmlElementInfo, SceneDocument } from './types'
import { resolveDocument } from './service'
export function HtmlScenePreview({
  document,
  time,
  selected,
  onSelect,
  onElements,
}: {
  document: SceneDocument
  time: number
  selected: string | null
  onSelect: (id: string) => void
  onElements: (items: HtmlElementInfo[]) => void
}) {
  const frame = useRef<HTMLIFrameElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const host = useRef<HTMLDivElement>(null)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')
  const [resolved, setResolved] = useState(document)
  useEffect(() => {
    let active = true
    void resolveDocument(document)
      .then((doc) => active && setResolved(doc))
      .catch((err) => setError(String(err)))
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
    const receive = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || event.data?.channel !== 'feng-editor') return
      if (event.data.type === 'ready') {
        onElements(event.data.elements)
        setReady(true)
      } else if (event.data.type === 'select') onSelect(event.data.id)
      else if (event.data.type === 'error') setError(event.data.message)
    }
    window.addEventListener('message', receive)
    return () => window.removeEventListener('message', receive)
  }, [onSelect, onElements])
  useEffect(() => {
    if (!ready) return
    frame.current?.contentWindow?.postMessage(
      {
        channel: 'feng-editor',
        type: 'update',
        time,
        duration: document.durationSeconds,
        patches: resolved.patches,
        selected,
      },
      location.origin,
    )
  }, [document, time, selected, ready, resolved])
  const scale = Math.min(size.width / document.width, size.height / document.height) || 0
  return (
    <div className="se-html-host" ref={host}>
      {error ? (
        <div className="se-message" role="alert">
          {error}
        </div>
      ) : (
        <>
          <iframe
            ref={frame}
            title={`源场景：${document.name}`}
            src={`./${document.source!.file}`}
            sandbox="allow-scripts allow-same-origin"
            style={{
              width: document.width,
              height: document.height,
              transform: `scale(${scale})`,
              left: (size.width - document.width * scale) / 2,
              top: (size.height - document.height * scale) / 2,
            }}
            onLoad={() => {
              try {
                const doc = frame.current?.contentDocument
                if (!doc) throw Error()
                const script = doc.createElement('script')
                script.src = new URL('./editor-engine/html-bridge.js', window.location.href).href
                script.onerror = () => setError('编辑桥接加载失败，请重新打开场景。')
                doc.body.append(script)
              } catch {
                setError('无法连接源场景。')
              }
            }}
          />
          {!ready && <div className="se-loading">正在加载真实源工程…</div>}
        </>
      )}
    </div>
  )
}
