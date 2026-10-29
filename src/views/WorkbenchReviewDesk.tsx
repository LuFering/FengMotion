import { useState } from 'react'
import { ArrowLeft, ArrowUpRight, Check, CheckCheck, ClipboardList, Download, FileText, GitCompareArrows, History, LocateFixed, MessageSquarePlus, Plus, RotateCcw, Search } from 'lucide-react'
import type { WorkbenchReview } from '@/hooks/useWorkbenchReview'
import type { StageVisual } from '@/data/stageVisual'
import type { ReviewOpinion } from '@/services/workbenchReviewService'
import { RequestSnapshot } from './WorkbenchReview'

export type ReviewDeskTab = 'opinions' | 'brief' | 'versions'
const date = (value: string) => new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
export function WorkbenchReviewDesk({ projectId, review, tab, onTab, visuals, viewedId, onView, onCompare, onLocate, onContinue, onClose, onDiscuss }: {
  projectId: string; review: WorkbenchReview; tab: ReviewDeskTab; onTab: (tab: ReviewDeskTab) => void
  visuals: StageVisual[]; viewedId?: string; onView: (visual: StageVisual) => void
  onCompare: (left: StageVisual, right: StageVisual) => void
  onLocate: (opinion: ReviewOpinion) => void; onContinue: (opinion: ReviewOpinion) => void
  onClose: () => void; onDiscuss: () => void
}) {
  const [filter, setFilter] = useState<'open' | 'resolved' | 'all'>('open')
  const [search, setSearch] = useState('')
  const [correction, setCorrection] = useState('')
  const [keep, setKeep] = useState(review.keepNotes)
  const [baseId, setBaseId] = useState('')
  const [compareId, setCompareId] = useState('')
  const open = review.opinions.filter((o) => o.status === 'open').length
  const visible = review.opinions.filter((o) => (filter === 'all' || o.status === filter) && `${o.request.prompt} ${o.request.references?.find((r) => r.role === 'target')?.label ?? ''}`.toLowerCase().includes(search.toLowerCase()))
  const newer = visuals.find((v) => v.id === compareId) ?? visuals[0]
  const older = visuals.find((v) => v.id === baseId) ?? visuals.find((v) => v.id !== newer?.id && v.file !== newer?.file && v.media === newer?.media)
  const comparable = Boolean(older && newer && older.id !== newer.id && older.file !== newer.file && older.media === newer.media)
  const exportReview = () => {
    const file = new Blob([JSON.stringify({ schema: 'fengmotion-local-review-v1', projectId, exportedAt: new Date().toISOString(), brief: review.brief, opinions: review.opinions }, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(file)
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'fengmotion-review.json'; anchor.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  return <aside className="fw-panel wb-review-desk" aria-label="制作审阅">
    <header className="wb-desk-header"><div><span className="wb-desk-eyebrow">PROJECT REVIEW</span><h2>制作审阅 <span>{open ? `${open} 待处理` : '持续记录'}</span></h2></div><button type="button" onClick={onClose} aria-label="返回工作台对话" title="返回对话"><ArrowLeft size={16}/></button></header>
    <div className="wb-desk-tabs" role="tablist" aria-label="制作审阅分类">{([['opinions', '修改意见', ClipboardList], ['brief', '制作要求', FileText], ['versions', '预览版本', History]] as const).map(([value, label, Icon]) => <button key={value} type="button" role="tab" aria-selected={tab === value} tabIndex={tab === value ? 0 : -1} onKeyDown={(event) => {
      const order: ReviewDeskTab[] = ['opinions', 'brief', 'versions']
      const index = order.indexOf(value)
      const next = event.key === 'ArrowRight' ? (index + 1) % 3 : event.key === 'ArrowLeft' ? (index + 2) % 3 : event.key === 'Home' ? 0 : event.key === 'End' ? 2 : -1
      if (next < 0) return
      event.preventDefault(); onTab(order[next]); (event.currentTarget.parentElement?.children[next] as HTMLButtonElement | undefined)?.focus()
    }} onClick={() => onTab(value)}><Icon size={13}/>{label}</button>)}</div>
    <div key={tab} className="wb-desk-scroll" role="tabpanel" aria-label={tab === 'opinions' ? '修改意见记录' : tab === 'brief' ? '制作要求记录' : '预览版本记录'}>
      {tab === 'opinions' ? <>
        <div className="wb-desk-section-heading"><div><h3>把每个问题跟进到底</h3><p>你标记的“已处理”独立于执行和检查结果。</p></div><button type="button" onClick={onDiscuss} aria-label="提出新的修改意见"><Plus size={16}/></button></div>
        {review.opinions.length > 0 && <><div className="wb-desk-filters">{([['open', `待处理 ${open}`], ['resolved', `已处理 ${review.opinions.length - open}`], ['all', '全部']] as const).map(([value, label]) => <button type="button" key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}</button>)}</div><label className="wb-desk-search"><Search size={13}/><input aria-label="搜索修改意见" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜索意见或画面名称"/></label></>}
        {!visible.length && <div className="wb-desk-empty"><ClipboardList size={28} strokeWidth={1.2}/><h3>{review.opinions.length ? '没有符合条件的意见' : '从一个具体问题开始'}</h3><p>{review.opinions.length ? '切换筛选或试试其他关键词。' : '在画面上引用时间或框选区域，再到对话里写下希望修改的内容。意见会保存在这里。'}</p>{!review.opinions.length && <button type="button" className="wb-desk-primary" onClick={onDiscuss}><MessageSquarePlus size={13}/>提出修改意见</button>}</div>}
        {visible.map((opinion, i) => { const target = opinion.request.references?.find((r) => r.role === 'target'); return <article className="wb-opinion" key={opinion.id} data-resolved={opinion.status === 'resolved'}><div className="wb-opinion-meta"><span>{opinion.status === 'resolved' ? <CheckCheck size={12}/> : <span className="wb-opinion-dot"/>}{opinion.status === 'resolved' ? '已处理 · 用户标记' : '待处理'}</span><time dateTime={opinion.createdAt}>{date(opinion.createdAt)}</time></div><p className="wb-opinion-text">{opinion.request.prompt}</p><button type="button" className="wb-opinion-target" onClick={() => onLocate(opinion)}><LocateFixed size={12}/><span>{target?.label ?? '整个项目'}</span><ArrowUpRight size={11}/></button><details open={i === 0 && filter !== 'all'} className="wb-opinion-detail"><summary>原始意见与保留条件</summary><RequestSnapshot request={opinion.request}/>{opinion.request.creativeBrief?.keepNotes && <p>特别保留：{opinion.request.creativeBrief.keepNotes}</p>}</details>{opinion.status === 'resolved' && <p className="wb-opinion-resolved">{opinion.reviewedVisualId ? `处理时查看：${visuals.find((v) => v.id === opinion.reviewedVisualId)?.name ?? '历史预览'}` : '未绑定检查结果'} · {opinion.resolvedAt ? date(opinion.resolvedAt) : ''}</p>}<div className="wb-opinion-actions"><button type="button" onClick={() => onContinue(opinion)}><MessageSquarePlus size={12}/>继续调整</button>{opinion.status === 'open' ? <button type="button" onClick={() => review.resolve(opinion.id, viewedId)}><Check size={12}/>标记已处理</button> : <button type="button" onClick={() => review.reopen(opinion.id)}><RotateCcw size={12}/>重新打开</button>}</div></article> })}
      </> : tab === 'brief' ? <>
        <div className="wb-desk-section-heading"><div><h3>让每一轮修改延续你的想法</h3><p>原始需求与后续纠正会随新的意见一起记录。</p></div></div>
        <details className="wb-original-brief" open><summary>原始需求 <span>原文保留</span></summary><p>{review.brief.original || '还没有原始需求，可以先补充这次创作的目标。'}</p></details>
        <section className="wb-desk-section"><div className="wb-desk-label"><h3>后续纠正</h3><span>{review.corrections.length} 条</span></div>{review.corrections.length ? <ol className="wb-correction-list">{review.corrections.map((item, index) => <li key={item.id}><span>{String(index + 1).padStart(2, '0')}</span><div><p>{item.text}</p><time>{date(item.createdAt)}</time>{index === review.corrections.length - 1 && <small>最新补充</small>}</div></li>)}</ol> : <p className="wb-desk-caption">例如：地址改放中间，结尾只留店名。后来的纠正按时间保留，不覆盖原话。</p>}
        <form onSubmit={(e) => { e.preventDefault(); if (!correction.trim()) return; review.addCorrection(correction); setCorrection('') }}><label className="wb-desk-input-label" htmlFor="wb-correction">补充或纠正制作要求</label><textarea id="wb-correction" rows={3} maxLength={8000} value={correction} onChange={(e) => setCorrection(e.target.value)} placeholder="这次需要纠正或明确什么？"/><button className="wb-desk-primary" type="submit" disabled={!correction.trim()}><Plus size={13}/>保存补充</button></form></section>
        <section className="wb-desk-section"><div className="wb-desk-label"><h3>始终保留</h3><span>随下一条意见发送</span></div><label className="wb-desk-input-label" htmlFor="wb-keep">满意的部分与不可改动的内容</label><textarea id="wb-keep" rows={3} maxLength={8000} value={keep} onChange={(e) => setKeep(e.target.value)} placeholder="例如：背景不要动，店名和 Logo 保持原样。"/><button type="button" className="wb-desk-secondary" onClick={() => review.setKeepNotes(keep)} disabled={keep === review.keepNotes}><Check size={13}/>{keep === review.keepNotes ? keep ? '已保存保留要求' : '暂无特别保留要求' : '保存保留要求'}</button></section>
      </> : <>
        <div className="wb-desk-section-heading"><div><h3>看实际画面，再作判断</h3><p>只显示本次项目的真实产物，不生成替代版本。</p></div></div>
        {visuals.length > 0 ? <><section className="wb-compare-picker"><div className="wb-desk-label"><h3><GitCompareArrows size={14}/>同步对比</h3></div><label>对照画面<select aria-label="对照预览" value={older?.id ?? ''} onChange={(e) => setBaseId(e.target.value)}>{!older && <option value="">暂无另一份同类预览</option>}{visuals.map((v) => <option value={v.id} key={v.id}>{v.name} · {date(v.createdAt)}</option>)}</select></label><label>本轮画面<select aria-label="本轮预览" value={newer?.id ?? ''} onChange={(e) => setCompareId(e.target.value)}>{visuals.map((v) => <option value={v.id} key={v.id}>{v.name} · {date(v.createdAt)}</option>)}</select></label><button type="button" className="wb-desk-primary" disabled={!comparable} onClick={() => older && newer && onCompare(older, newer)}><GitCompareArrows size={13}/>打开同步对比</button>{!comparable && <p className="wb-desk-caption">需要两份不同文件的同类画面，才能保留真实的对照。</p>}</section><div className="wb-version-list">{visuals.map((v, i) => <button type="button" className="wb-version" key={v.id} aria-pressed={v.id === viewedId} onClick={() => onView(v)}><span className="wb-version-number">{String(visuals.length - i).padStart(2, '0')}</span><span><b>{v.tierLabel}{i === 0 && <small>最新产出</small>}</b><strong>{v.name}</strong><time>{date(v.createdAt)} · {v.origin==='editor'?'编辑版本':'工作流'} v{v.revision}{v.stale ? ' · 已过期' : ''}</time></span><ArrowUpRight size={14}/></button>)}</div></> : <div className="wb-desk-empty"><History size={28} strokeWidth={1.2}/><h3>还没有预览版本</h3><p>真实测试帧、试片或整片返回后会出现在这里。演示日志不会被当作视频版本。</p></div>}
      </>}
    </div>
    <footer className="wb-desk-footer"><span role="status">{review.saved ? '保存在此浏览器 · 未同步云端' : '保存失败 · 仅本次页面有效，请导出备份'}</span><button type="button" onClick={exportReview} aria-label="导出审阅记录" title="导出审阅记录"><Download size={14}/></button></footer>
  </aside>
}
