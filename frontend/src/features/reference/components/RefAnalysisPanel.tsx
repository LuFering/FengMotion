import type * as React from 'react'
import { StatusPill } from '@/features/reference/components/StatusPill'
import { formatClock, formatDuration, ANALYSIS_FIELDS, type AnalysisKey, type ReferenceSegment } from '@/features/reference/model/referenceLibrary'
import { Icon } from '@/features/reference/components/RefIcon'
import type { LocalSegment } from '@/features/reference/services/referenceApiService'
import type { AnalysisGate } from '@/features/reference/hooks/useAnalysisGate'

/** 来源三分（library.md §4.2.3）：实测 / 模型 / 人工，界面必须可区分 */
const SOURCE_LABEL: Record<string, string> = { measured: '实测', model: '模型', user: '人工' }

/* 六维：前五项沿用 ANALYSIS_FIELDS，第六项「可借鉴点」（analysis.reusable）。
   解释文字不再以 9px 小字挂在维度名下，放进 title。 */
const DIMS: Array<{ key: AnalysisKey; label: string; hint: string }> = [
  ...ANALYSIS_FIELDS.map(({ key, label, hint }) => ({ key, label, hint })),
  { key: 'reusable', label: '可借鉴点', hint: '可以借鉴什么，以及它的限制条件' },
]

export interface RefAnalysisPanelProps {
  addRefToPending: (segs: LocalSegment[]) => void
  /** 当前片段是否已在待发送 */
  added: boolean
  analyzeGate: AnalysisGate
  current: LocalSegment
  endDraft: string
  /** 是否已写入工作流取用清单 */
  inOutbox: boolean
  isFav: boolean
  observationDraft: string
  onAnalyze: () => void
  removeSegment: (segmentIdToRemove: string) => Promise<void>
  saveSegmentEdits: (patch: { observation?: string; suggestion?: string; startSec?: number; endSec?: number }) => Promise<void>
  segment: ReferenceSegment
  setEndDraft: React.Dispatch<React.SetStateAction<string>>
  setObservationDraft: React.Dispatch<React.SetStateAction<string>>
  setStartDraft: React.Dispatch<React.SetStateAction<string>>
  setSuggestionDraft: React.Dispatch<React.SetStateAction<string>>
  startDraft: string
  suggestionDraft: string
  toggleFavorite: (id: string) => void
  toggleReference: (seg: ReferenceSegment) => void
}

/**
 * 片段分析面板。从上到下：这是哪一段 → 拿去用（待发送 / 工作流 / 收藏）→ 分析 → 人工记录 → 范围 → 删除。
 * 片段级动作都收在这里；顶部工具栏只留片级动作。
 */
export function RefAnalysisPanel({ addRefToPending, added, analyzeGate, current, endDraft, inOutbox, isFav, observationDraft, onAnalyze, removeSegment, saveSegmentEdits, segment, setEndDraft, setObservationDraft, setStartDraft, setSuggestionDraft, startDraft, suggestionDraft, toggleFavorite, toggleReference }: RefAnalysisPanelProps) {
  const anyPending = DIMS.some((d) => current.analysis[d.key]?.pending)
  const reason = analyzeGate.reason.replace(/[。.]$/, '')
  return (
    <aside className="rfc-panel" aria-label="片段分析">
      <header className="rfc-panel-head">
        <div className="rfc-panel-titles">
          <h2>片段 {current.index + 1}</h2>
          <StatusPill status={current.status} />
        </div>
        <button
          type="button"
          className="rfc-iconbtn"
          aria-pressed={isFav}
          aria-label={isFav ? '取消收藏这个片段' : '收藏这个片段'}
          title={isFav ? '取消收藏' : '收藏'}
          onClick={() => toggleFavorite(current.id)}
        >
          <Icon name="star" />
        </button>
        <p className="rfc-panel-tc">
          {formatClock(current.start)} – {formatClock(current.end)} · {formatDuration(current.end - current.start)}
        </p>
      </header>

      {/* 主操作：交给创作对话。「用于工作流」写的是工作流编辑器读取的清单，两者独立。 */}
      <div className="rfc-panel-acts">
        <button type="button" className="rfc-btn primary" disabled={added} onClick={() => addRefToPending([current])}>
          <Icon name={added ? 'check' : 'plus'} /> {added ? '已在待发送' : '加入待发送'}
        </button>
        <button
          type="button"
          className={`rfc-btn${inOutbox ? ' is-done' : ''}`}
          aria-pressed={inOutbox}
          onClick={() => { if (segment) toggleReference(segment) }}
          title={inOutbox ? '从工作流取用清单移除' : '加入工作流取用清单，工作流编辑器里的「参考片检索」可以直接用'}
        >
          <Icon name={inOutbox ? 'check' : 'link'} /> {inOutbox ? '已用于工作流' : '用于工作流'}
        </button>
      </div>

      <section className="rfc-sec" aria-labelledby="rfc-sec-analysis">
        <div className="rfc-sec-head">
          <h3 id="rfc-sec-analysis">分析</h3>
          {anyPending && (
            <button type="button" className="rfc-analyze" disabled={!analyzeGate.enabled} onClick={onAnalyze}
                    title={analyzeGate.enabled ? '对这条参考片发起自动分析' : reason}>
              开始分析
            </button>
          )}
        </div>
        {/* 未接入的能力按目标形态画出来、置灰，并用一句人话说明原因（页面职责合同 §1.3） */}
        {anyPending && !analyzeGate.enabled && (
          <p className="rfc-sec-note">{reason}，可在下方手动记录。</p>
        )}
        {/* 六维全部待分析时不重复六行「待分析」，压成一行维度签 */}
        {DIMS.every((d) => !current.analysis[d.key] || current.analysis[d.key].pending) ? (
          <ul className="rfc-dims-pending" aria-label="待分析的维度">
            {DIMS.map((d) => <li key={d.key} title={d.hint}>{d.label}</li>)}
          </ul>
        ) : (
          <dl className="rfc-dims">
            {DIMS.map((d) => {
              const a = current.analysis[d.key]
              const pending = !a || a.pending
              const wide = !pending && a.value.length > 16
              return (
                <div key={d.key} className="rfc-dim" data-pending={pending || undefined} data-wide={wide || undefined}>
                  <dt title={d.hint}>{d.label}</dt>
                  <dd>
                    {pending ? <span className="pend">待分析</span> : <span className="rfc-dim-v">{a.value}</span>}
                    {!pending && a.source && (
                      <span className="rfc-src" data-src={a.source}>{SOURCE_LABEL[a.source] ?? a.source}</span>
                    )}
                  </dd>
                </div>
              )
            })}
          </dl>
        )}
      </section>

      {/* 观察与推断分区块（契约 §4.2 铁律）：观察、用法建议可编辑；模型推断只读，夹在中间并标「模型」 */}
      <section className="rfc-sec" aria-labelledby="rfc-sec-notes">
        <h3 id="rfc-sec-notes">人工记录</h3>
        <label className="rfc-manual-field">
          <span className="rfc-manual-k">观察</span>
          <textarea
            className="rfc-manual-input"
            value={observationDraft}
            placeholder="只写看得到的，例如：人物剪影居中，道路持续向后拉伸"
            onChange={(e) => setObservationDraft(e.target.value)}
            // 从事件读当前值：onBlur 里的 state 可能还是上一次渲染的快照。
            onBlur={(e) => void saveSegmentEdits({ observation: e.currentTarget.value })}
            rows={2}
          />
        </label>
        {current.inference && (
          <div className="rfc-manual-field">
            <span className="rfc-manual-k">推断 <i className="rfc-manual-tag">模型 · 只读</i></span>
            <p className="rfc-manual-infer">{current.inference}</p>
          </div>
        )}
        <label className="rfc-manual-field">
          <span className="rfc-manual-k">用法建议</span>
          <textarea
            className="rfc-manual-input"
            value={suggestionDraft}
            placeholder="这条创作怎么用，例如：借鉴居中构图，不直接用画面"
            onChange={(e) => setSuggestionDraft(e.target.value)}
            onBlur={(e) => void saveSegmentEdits({ suggestion: e.currentTarget.value })}
            rows={2}
          />
        </label>
      </section>

      <section className="rfc-sec" aria-labelledby="rfc-sec-range">
        <h3 id="rfc-sec-range">片段范围</h3>
        <div className="rfc-range-row">
          <label>
            起点
            <input
              type="number" step="0.1" min="0" inputMode="decimal"
              value={startDraft}
              onChange={(e) => setStartDraft(e.target.value)}
              onBlur={(e) => void saveSegmentEdits({ startSec: Number(e.currentTarget.value) })}
            />
            秒
          </label>
          <span className="rfc-range-dash" aria-hidden="true">–</span>
          <label>
            终点
            <input
              type="number" step="0.1" min="0" inputMode="decimal"
              value={endDraft}
              onChange={(e) => setEndDraft(e.target.value)}
              onBlur={(e) => void saveSegmentEdits({ endSec: Number(e.currentTarget.value) })}
            />
            秒
          </label>
        </div>
      </section>

      {current.tags.length > 0 && (
        <div className="rfc-tags">
          {current.tags.map((t) => <span key={t} className="rfc-tag">{t}</span>)}
        </div>
      )}

      <div className="rfc-panel-foot">
        <button type="button" className="rfc-manual-del" onClick={() => void removeSegment(current.id)}
                title="删除这个片段（不影响视频本身）">
          删除片段
        </button>
      </div>
    </aside>
  )
}
