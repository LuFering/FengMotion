import { useEffect, useState } from 'react'
import { getFileURL, getThumbURL } from '@/services/assetService'
import { MEDIA_LABEL, type MediaType } from '@/data/myAssets'
import type { AgentReference } from '@/services/studioApi'
import { VISUAL_KIND_LABEL, type MonitorVisualKind } from '@/data/monitorVisual'

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

/** 监看区能点开看大的视觉项：参考素材 / 方向样稿 / 试片 —— 类型按数据来源标，不混叫。 */
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
      <div className="fw-mon-tile-file">
        <span>{MEDIA_LABEL[item.mediaType] ?? item.mediaType}</span>
      </div>
    )
  }
  return <img src={url} alt={item.name} loading="lazy" />
}

/** 任务进行中：一条瘦状态行，不抢画面。 */
export function MonitorTaskLine({ label, state, onViewTask }:
  { label: string; state: string; onViewTask: () => void }) {
  return (
    <div className="fw-mon-taskline">
      <span className="fm-dot" data-s="running" />
      <span>正在制作：{label} · {state}</span>
      <span className="fw-mon-note">新预览生成后才替换当前画面</span>
      <span className="spacer" />
      <button type="button" className="fw-mon-btn" onClick={onViewTask}>查看执行 ›</button>
    </div>
  )
}

/** 问题区：每行 = 问题 + 位置 + 两个动作。定位只给真实场景，改对话带问题与目标。 */
export function MonitorProblems({ problems, onLocate, onAskFix }:
  { problems: MonitorProblem[]; onLocate: (p: MonitorProblem) => void; onAskFix: (p: MonitorProblem) => void }) {
  if (problems.length === 0) return null
  return (
    <section className="fw-mon-sec">
      <div className="fw-mon-sec-title">问题 · {problems.length}</div>
      {problems.map((p) => (
        <div className="fw-mon-prob" key={p.id}>
          <div className="fw-mon-prob-main">
            <span className="fm-dot" data-s="failed" />
            <span className="fw-mon-prob-title">{p.title}</span>
            <span className="spacer" />
            {p.locatable && <button type="button" className="fw-mon-btn" onClick={() => onLocate(p)}>定位 ›</button>}
            <button type="button" className="fw-mon-btn strong" onClick={() => onAskFix(p)}>让 AI 修改 ›</button>
          </div>
          <div className="fw-mon-prob-meta">{p.meta} · {p.location}</div>
        </div>
      ))}
    </section>
  )
}

function GalleryGroup({ title, items, onSelect }:
  { title: string; items: MonitorVisualItem[]; onSelect: (item: MonitorVisualItem) => void }) {
  if (items.length === 0) return null
  return (
    <div className="fw-mon-gallery-group">
      <div className="fw-mon-sec-title">{title} · {items.length}</div>
      <div className="fw-mon-gallery">
        {items.map((item) => (
          <button type="button" className="fw-mon-tile" key={item.id}
                  onClick={() => onSelect(item)} title={item.name}>
            <span className="fw-mon-tile-media"><Thumb item={item} /></span>
            <span className="fw-mon-tile-name truncate">{item.name}</span>
            <span className="fw-mon-tile-meta">
              {MEDIA_LABEL[item.mediaType] ?? item.mediaType}
              {item.sourceLabel ? ` · ${item.sourceLabel}` : ''}
              {item.license ? ` · ${item.license}` : ''}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

/** 视觉资料：参考素材永远叫参考素材；方向样稿与试片只在真实数据存在时才出现。 */
export function MonitorGallery({ refs, samples, testfilms, onSelect }:
  { refs: MonitorVisualItem[]; samples: MonitorVisualItem[]; testfilms: MonitorVisualItem[]; onSelect: (item: MonitorVisualItem) => void }) {
  if (refs.length === 0 && samples.length === 0 && testfilms.length === 0) return null
  return (
    <section className="fw-mon-sec">
      <GalleryGroup title="参考素材" items={refs} onSelect={onSelect} />
      <GalleryGroup title="方向样稿" items={samples} onSelect={onSelect} />
      <GalleryGroup title="试片" items={testfilms} onSelect={onSelect} />
      <div className="fw-mon-note">点一张图或一段片，在上方大画面里看。</div>
    </section>
  )
}

/** 交付事实：最终文件、输出规格、审片、检查 —— 四项各认各的数据，不拿 Gate 确认冒充交付。 */
export function MonitorDelivery({ finalFile, specs, review, checks, note }:
  { finalFile: string; specs: string; review: string; checks: string; note?: string }) {
  return (
    <section className="fw-mon-sec">
      <div className="fw-mon-sec-title">交付</div>
      <div className="fw-mon-facts">
        <span><span className="fw-mon-fact-label">最终文件</span>{finalFile}</span>
        <span><span className="fw-mon-fact-label">输出规格</span>{specs}</span>
        <span><span className="fw-mon-fact-label">审片</span>{review}</span>
        <span><span className="fw-mon-fact-label">检查</span>{checks}</span>
      </div>
      {note && <div className="fw-mon-note">{note}</div>}
    </section>
  )
}

/** 无画面：只说现状，不放任何视频。创作需求有就贴原文，没有就一句话。 */
export function MonitorEmpty({ promptText }: { promptText: string }) {
  return (
    <div className="fw-mon-empty">
      <div className="fw-mon-empty-title">还没有可播放的预览</div>
      {promptText
        ? <p className="fw-mon-empty-prompt">{promptText}</p>
        : <p className="fw-mon-empty-sub">在对话里说清这条片要做什么，生成后画面会在这里出现。</p>}
    </div>
  )
}

/** 大画面预览：点画廊进来的参考 / 样稿 / 试片。文件走素材服务现取，取不到就明说，不贴默认图。 */
export function MonitorMediaPreview({ item, onBack, onAsk }:
  { item: MonitorVisualItem; onBack: () => void; onAsk: (item: MonitorVisualItem) => void }) {
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
      <div className="fw-mon-preview-bar">
        <button type="button" className="fw-mon-btn" onClick={onBack}>‹ 返回监看</button>
        <span className="spacer" />
        <span className="fw-mon-note">
          {VISUAL_KIND_LABEL[item.kind]}
          {item.sourceLabel ? ` · ${item.sourceLabel}` : ''}
          {item.license ? ` · ${item.license}` : ''}
        </span>
        <button type="button" className="fw-mon-btn strong" onClick={() => onAsk(item)}>向 AI 说这个 ›</button>
      </div>
    </div>
  )
}
