import { useEffect, useState } from 'react'
import { getFileURL, getThumbURL } from '@/services/assetService'
import { MEDIA_LABEL, type MediaType } from '@/data/myAssets'
import type { AgentReference } from '@/services/studioApi'
import type { MonitorVisualKind } from '@/data/monitorVisual'

/** 监看区的问题：工作流返工（未关联场景）或场景缺素材（带真实场景与时间）。 */
export interface MonitorProblem {
  id: string
  title: string
  meta: string
  /** 场景名 + 时间，或「未关联场景」。 */
  location: string
  locatable: boolean
  /** 可定位时的问题目标（内容单元引用）；未关联场景的问题没有。 */
  sceneRef?: AgentReference
}

/** 监看区的大画面候选项：当前预览 / 参考素材 / 方向样稿 / 试片 —— 类型按数据来源标，不混叫。 */
export interface MonitorVisualItem {
  id: string
  name: string
  kind: MonitorVisualKind
  mediaType: MediaType
  thumb?: string
  filePath?: string
  assetId?: string
  license?: string
  sourceLabel?: string
}

function Thumb({ item }: { item: MonitorVisualItem }) {
  const [url, setUrl] = useState<string | null>(item.thumb ?? null)
  useEffect(() => {
    if (url || !item.assetId) return
    let on = true
    void getThumbURL(item.assetId).then((u) => { if (on && u) setUrl(u) })
    return () => { on = false }
  }, [item.assetId, url])
  if (!url) {
    return (
      <div className="fw-mon-thumb-file">
        <span>{MEDIA_LABEL[item.mediaType] ?? item.mediaType}</span>
      </div>
    )
  }
  return <img src={url} alt={item.name} loading="lazy" />
}

/** 缩略入口：一行横向缩略图，切画面只换大画面，不在下方再铺一摞区块。 */
export function MonitorThumbRail({ items, selectedId, onSelect }:
  { items: MonitorVisualItem[]; selectedId: string | null; onSelect: (item: MonitorVisualItem) => void }) {
  if (items.length === 0) return null
  return (
    <div className="fw-mon-thumbs" role="listbox" aria-label="画面">
      {items.map((item) => (
        <button type="button" className="fw-mon-thumb" key={item.id}
                aria-label={item.name} title={item.name}
                aria-selected={selectedId === item.id}
                onClick={() => onSelect(item)}>
          <Thumb item={item} />
        </button>
      ))}
    </div>
  )
}

/** 问题：收起时只露标题；点标题才展开详情与动作，不默认铺开。 */
export function MonitorProblemsCollapsed({ problems, expandedId, onToggle, onLocate, onAskFix }:
  { problems: MonitorProblem[]; expandedId: string | null
    onToggle: (id: string) => void; onLocate: (p: MonitorProblem) => void; onAskFix: (p: MonitorProblem) => void }) {
  if (problems.length === 0) return null
  const expanded = problems.find((p) => p.id === expandedId) ?? null
  return (
    <div className="fw-mon-problems">
      <div className="fw-mon-problem-row">
        <span className="fw-mon-problem-label">问题</span>
        {problems.map((p) => (
          <button type="button" className="fw-mon-problem-btn" key={p.id}
                  aria-expanded={expandedId === p.id}
                  onClick={() => onToggle(p.id)}>
            <span className="fm-dot" data-s="failed" />
            {p.title}
          </button>
        ))}
      </div>
      {expanded && (
        <div className="fw-mon-problem-detail">
          <span className="fw-mon-problem-meta">{expanded.meta} · {expanded.location}</span>
          <span className="spacer" />
          {expanded.locatable && <button type="button" className="fw-mon-btn" onClick={() => onLocate(expanded)}>定位 ›</button>}
          <button type="button" className="fw-mon-btn strong" onClick={() => onAskFix(expanded)}>让 AI 修改 ›</button>
        </div>
      )}
    </div>
  )
}

/** 交付事实：最终文件、输出规格、审片、检查 —— 四项各认各的数据，不拿 Gate 确认冒充交付。
    调用方只在有最终文件时才渲染，创作初期不常驻。 */
export function MonitorDelivery({ finalFile, specs, review, checks }:
  { finalFile: string; specs: string; review: string; checks: string }) {
  return (
    <div className="fw-mon-delivery">
      <span><span className="fw-mon-fact-label">最终文件</span>{finalFile}</span>
      <span><span className="fw-mon-fact-label">输出规格</span>{specs}</span>
      <span><span className="fw-mon-fact-label">审片</span>{review}</span>
      <span><span className="fw-mon-fact-label">检查</span>{checks}</span>
    </div>
  )
}

/** 无画面：只留四个字，不贴需求原文、不写使用说明。原文在对话与项目资料里。 */
export function MonitorEmpty() {
  return (
    <div className="fw-mon-empty">
      <div className="fw-mon-empty-title">暂无预览</div>
    </div>
  )
}

/** 大画面预览：只放画面本身。名字、类型、返回、向 AI 说这个都在上方工具条里，不再重复一栏。 */
export function MonitorMediaPreview({ item }:
  { item: MonitorVisualItem }) {
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let on = true
    const p = item.assetId
      ? getFileURL(item.assetId)
      : Promise.resolve(item.filePath ?? item.thumb ?? null)
    void p.then((u) => { if (on) setUrl(u ?? item.thumb ?? null) }).catch(() => { if (on) setFailed(true) })
    return () => { on = false }
  }, [item])
  return (
    <div className="fw-mon-preview">
      {failed || (url === null && item.mediaType !== 'image' && !item.filePath && !item.assetId) ? (
        <div className="fw-mon-empty-sub">该文件暂无法预览。</div>
      ) : url === null ? (
        <div className="fw-mon-empty-sub">正在取文件…</div>
      ) : item.mediaType === 'video' ? (
        <video className="fw-mon-preview-media" src={url} controls playsInline />
      ) : item.mediaType === 'image' ? (
        <img className="fw-mon-preview-media" src={url} alt={item.name} />
      ) : (
        <div className="fw-mon-empty-sub">
          {MEDIA_LABEL[item.mediaType] ?? item.mediaType}文件不支持在这里预览：{item.name}
        </div>
      )}
    </div>
  )
}
