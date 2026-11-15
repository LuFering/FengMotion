import { useEffect, useState } from 'react'
import { studioHttpApi } from '@/services/api'

type HistoryItem = {
  id: string
  createdAt: string
  suggestion: {
    name: string; purpose: string; category: string; tags: string[]; modelId: string; promptVersion: string
    evidence: { sourcePath: string; sourceText: string; contentHash: string; parserVersion: string }
  }
}

/** 模型建议及其源码快照与来源事实分别呈现。 */
export function FxSemanticHistory({ techniqueId }: { techniqueId: string }) {
  const [history, setHistory] = useState<HistoryItem[] | null>(null)
  const [error, setError] = useState(false)
  useEffect(() => {
    let active = true
    void studioHttpApi().http.request<HistoryItem[]>('GET', `/fx-techniques/${encodeURIComponent(techniqueId)}/semantic-suggestions`)
      .then((response) => { if (active) setHistory(response.data) })
      .catch(() => { if (active) setError(true) })
    return () => { active = false }
  }, [techniqueId])
  if (error) return <section className="fx-dsec"><h3 className="fx-label">模型建议</h3><p>建议历史读取失败</p></section>
  if (!history?.length) return null
  return <section className="fx-dsec">
    <h3 className="fx-label">模型建议</h3>
    {history.map(({ id, createdAt, suggestion: s }) => <div key={id}>
      <p><b>{s.name}</b> · {s.category}</p>
      <p>{s.purpose}</p>
      {s.tags.length > 0 && <p>{s.tags.join('、')}</p>}
      <p className="fx-attribution">生成于 {new Date(createdAt).toLocaleString()} · 模型 {s.modelId} · 提示词 {s.promptVersion} · 解析器 {s.evidence.parserVersion}</p>
      <details><summary>查看来源证据</summary>
        <p className="fx-attribution">{s.evidence.sourcePath} · SHA-256 {s.evidence.contentHash}</p>
        <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 300, overflow: 'auto' }}>{s.evidence.sourceText}</pre>
      </details>
    </div>)}
  </section>
}
