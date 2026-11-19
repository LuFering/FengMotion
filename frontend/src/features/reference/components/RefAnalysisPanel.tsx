import type * as React from 'react'
import { StatusPill } from '@/features/reference/components/StatusPill'
import { formatTimecode, ANALYSIS_FIELDS, type ReferenceSegment } from '@/features/reference/model/referenceLibrary'
import { Icon } from '@/features/reference/components/RefIcon'
import type { LocalSegment } from '@/features/reference/services/referenceApiService'

export interface RefAnalysisPanelProps {
  current: LocalSegment
  endDraft: string
  inOutbox: boolean
  observationDraft: string
  removeSegment: (segmentIdToRemove: string) => Promise<void>
  reusable: boolean
  saveSegmentEdits: (patch: { observation?: string; suggestion?: string; startSec?: number; endSec?: number }) => Promise<void>
  segment: ReferenceSegment
  setEndDraft: React.Dispatch<React.SetStateAction<string>>
  setObservationDraft: React.Dispatch<React.SetStateAction<string>>
  setStartDraft: React.Dispatch<React.SetStateAction<string>>
  setSuggestionDraft: React.Dispatch<React.SetStateAction<string>>
  startDraft: string
  suggestionDraft: string
  toggleReference: (seg: ReferenceSegment) => void
}

/** 参考片库右侧的片段分析面板：各项分析值与来源、可复用结论、人工观察与建议、起止时间调整和删除。 */
export function RefAnalysisPanel({ current, endDraft, inOutbox, observationDraft, removeSegment, reusable, saveSegmentEdits, segment, setEndDraft, setObservationDraft, setStartDraft, setSuggestionDraft, startDraft, suggestionDraft, toggleReference }: RefAnalysisPanelProps) {
  return (
    <aside className="rfc-panel" aria-label="片段分析">
      <div className="rfc-panel-head">
        <h2>片段 {current.index + 1}</h2>
        <StatusPill status={current.status} />
        <span className="rfc-panel-tc num">
          {formatTimecode(current.start)} – {formatTimecode(current.end)} · {current.end - current.start}s
        </span>
      </div>
      <div className="rfc-panel-acts">
        <button type="button" className={`rfc-btn primary${inOutbox ? ' is-done' : ''}`} onClick={() => { if (segment) toggleReference(segment) }}>
          <Icon name={inOutbox ? 'check' : 'link'} /> {inOutbox ? '已加入参考' : '用作参考'}
        </button>
      </div>
      {/* 不再按「画面 / 时间」分组：总共五项，分两段只是平白多一层打断。
          全部平铺，用户从上往下一眼扫完。 */}
      <div className="rfc-fgroup">
        {ANALYSIS_FIELDS.map((f) => {
            const a = current.analysis[f.key]
            /* 每项只回答两件事：值是什么、这个值哪来的。
               右侧那枚小徽标区分「实测」（后端量出来的：切点/亮度/运动量）
               和「模型」（视觉模型判断的）—— 用户该知道哪些数字可追溯。 */
            return (
              <div key={f.key} className="rfc-field" data-pending={a.pending || undefined}>
                <span className="rfc-field-k">
                  {f.label}
                  <i className="rfc-field-hint">{f.hint}</i>
                </span>
                {a.pending
                  ? <span className="rfc-field-v pend">待分析</span>
                  : <span className="rfc-field-v">{a.value}</span>}
                {!a.pending && (
                  <span className="rfc-src" data-src={a.source}>
                    {a.source === 'measured' ? '实测' : '模型'}
                  </span>
                )}
              </div>
            )
        })}
      </div>
      {/* 结论：这条片段到底能不能用。放在所有依据之后、单独一块，
          因为用户看完前五项后只想知道这一个答案。 */}
      <div className="rfc-verdict" data-tone={reusable ? 'ok' : 'no'}>
        <span className="rfc-verdict-k">可复用</span>
        <span className="rfc-verdict-v">
          {current.analysis.reusable.pending ? '待分析' : current.analysis.reusable.value}
        </span>
      </div>
      {/* 人工记录与模型推断分开呈现（契约 §4.2 铁律）：
          观察是「你看得到的」，推断是模型给的。混在一起用户会把推断当事实。
          观察与建议可编辑并写回服务端；推断只读 —— 允许手改推断
          等于把人的猜测伪装成模型结论。 */}
      <div className="rfc-manual">
        <label className="rfc-manual-field">
          <span className="rfc-manual-k">你看到的画面（观察）</span>
          <textarea
            className="rfc-manual-input"
            value={observationDraft}
            placeholder="例如：人物剪影居中，背景道路持续向后拉伸"
            onChange={(e) => setObservationDraft(e.target.value)}
            // 从事件读当前值：onBlur 里的 state 可能还是上一次渲染的快照。
            onBlur={(e) => void saveSegmentEdits({ observation: e.currentTarget.value })}
            rows={2}
          />
        </label>
        <label className="rfc-manual-field">
          <span className="rfc-manual-k">建议怎么用（建议）</span>
          <textarea
            className="rfc-manual-input"
            value={suggestionDraft}
            placeholder="例如：可借鉴居中构图，但不要直接使用这画面"
            onChange={(e) => setSuggestionDraft(e.target.value)}
            onBlur={(e) => void saveSegmentEdits({ suggestion: e.currentTarget.value })}
            rows={2}
          />
        </label>
        {current.inference && (
          <div className="rfc-manual-field">
            <span className="rfc-manual-k">
              模型推断 <i className="rfc-manual-tag">只读</i>
            </span>
            <p className="rfc-manual-infer">{current.inference}</p>
          </div>
        )}
      </div>

      {/* 起止时间可调：动作可能只有半秒，也可能持续十秒 ——
          固定 3 秒只是快捷方式，不是完整的人工切片。 */}
      <div className="rfc-range-edit">
        <span className="rfc-manual-k">片段范围</span>
        <label>
          起点
          <input
            type="number" step="0.1" min="0"
            value={startDraft}
            onChange={(e) => setStartDraft(e.target.value)}
            onBlur={(e) => void saveSegmentEdits({ startSec: Number(e.currentTarget.value) })}
          />
        </label>
        <label>
          终点
          <input
            type="number" step="0.1" min="0"
            value={endDraft}
            onChange={(e) => setEndDraft(e.target.value)}
            onBlur={(e) => void saveSegmentEdits({ endSec: Number(e.currentTarget.value) })}
          />
        </label>
        <button
          type="button"
          className="rfc-manual-del"
          onClick={() => void removeSegment(current.id)}
          title="删除这个片段（不影响视频本身）"
        >删除片段</button>
      </div>

      {current.tags.length > 0 && (
        <div className="rfc-tags">
          {current.tags.map((t) => (
            <span key={t} className="rfc-tag">{t}</span>
          ))}
        </div>
      )}
    </aside>
  )
}
