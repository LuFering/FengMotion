import type * as React from 'react'
import { MEDIA_LABEL, SOURCE_LABEL, LICENSE_LABEL, REVIEW_LABEL, type LicenseStatus, type ReviewStatus, type MyAsset } from '@/features/assets/model/myAssets'
import { Icon } from '@/features/assets/components/AssetIcon'
import { Preview } from '@/features/assets/components/AssetPreview'
import { formatBytes, formatDur } from '@/features/assets/services/assetApiService'
import type { PendingAsset, AssetPurpose, PendingRefCard, PendingFxCard } from '@/features/assets/hooks/usePendingAssets'

export interface AssetInspectorProps {
  addToPending: (ids: string[]) => number
  applyPatch: (id: string, patch: Partial<MyAsset>) => void
  copyPath: (a: MyAsset) => Promise<void>
  detail: MyAsset
  doDelete: (ids: string[]) => void
  pending: { items: PendingAsset[]; add: (assetIds: string[], purpose?: AssetPurpose) => number; addRef: (cards: PendingRefCard[]) => number; addFx: (cards: PendingFxCard[]) => number; remove: (assetId: string) => void; removeMany: (assetIds: string[]) => void; clear: () => void; patch: (assetId: string, next: Partial<Omit<PendingAsset, 'assetId' | 'addedAt'>>) => void; has: (assetId: string) => boolean; saveFailed: boolean; retrySave: () => void }
  setDetailId: React.Dispatch<React.SetStateAction<string | null>>
  setRenameText: React.Dispatch<React.SetStateAction<string>>
  setRenaming: React.Dispatch<React.SetStateAction<MyAsset | null>>
  setTagText: React.Dispatch<React.SetStateAction<string>>
  tagText: string
  thumbs: Record<string, string>
  toggleFav: (a: MyAsset) => void
}

/** 我的素材右侧的素材详情栏：预览、审核与加入待发送，文件信息、标签、授权与引用关系的查看和修改。 */
export function AssetInspector({ addToPending, applyPatch, copyPath, detail, doDelete, pending, setDetailId, setRenameText, setRenaming, setTagText, tagText, thumbs, toggleFav }: AssetInspectorProps) {
  return (
    <aside className="mya-inspector" aria-label="素材详情">
      <div className="mya-drawer-head">
        <div className="mya-drawer-title-wrap">
          <span className="mya-drawer-title" title={detail.name}>{detail.name}</span>
          <span className="mya-drawer-meta">{MEDIA_LABEL[detail.mediaType]} · {SOURCE_LABEL[detail.sourceType]}</span>
        </div>
        <button type="button" className="mya-iconbtn" onClick={() => setDetailId(null)} title="关闭详情" aria-label="关闭详情"><Icon name="x" /></button>
      </div>

      <div className="mya-drawer-body">
        <div className="mya-preview">
          <Preview asset={detail} poster={thumbs[detail.id]} />
        </div>

        {detail.reviewStatus !== 'approved' && (
          <div className="mya-review-acts">
            <button type="button" className="mya-review-pass"
                    onClick={() => applyPatch(detail.id, { reviewStatus: 'approved' })}>
              <Icon name="circle-check" />通过审核
            </button>
            <button type="button"
                    onClick={() => applyPatch(detail.id, { reviewStatus: 'needs_review' })}>
              <Icon name="undo-2" />退回复核
            </button>
          </div>
        )}

        {/* 「如何使用」排在管理动作之前：用户打开详情多半是为了决定
            这个素材要不要用于这次任务，重命名/删除是次要动作。 */}
        <div className="mya-actrow mya-actrow-use">
          <button type="button" className="mya-use-btn" data-added={pending.has(detail.id) || undefined}
                  onClick={() => addToPending([detail.id])}>
            <Icon name={pending.has(detail.id) ? 'square-check' : 'plus'} />
            {pending.has(detail.id) ? '已在待发送' : '加入待发送'}
          </button>
        </div>

        <div className="mya-actrow">
          <button type="button" onClick={() => { setRenaming(detail); setRenameText(detail.name) }}><Icon name="pencil" />重命名</button>
          <button type="button" onClick={() => toggleFav(detail)} data-on={detail.tags.includes('★') || undefined}><Icon name="star" />{detail.tags.includes('★') ? '已收藏' : '收藏'}</button>
          <button type="button" onClick={() => void copyPath(detail)}><Icon name="copy" />复制路径</button>
          <button type="button" className="mya-danger" onClick={() => doDelete([detail.id])}><Icon name="trash-2" />删除</button>
        </div>

        <div className="mya-sec">文件</div>
        <div className="mya-facts">
          <div className="mya-fact mya-fact-wide"><span>类型</span><b title={`${MEDIA_LABEL[detail.mediaType]} · ${detail.mimeType}`}>{MEDIA_LABEL[detail.mediaType]} · {detail.mimeType}</b></div>
          <div className="mya-fact"><span>大小</span><b className="mono">{formatBytes(detail.sizeBytes)}</b></div>
          {detail.width != null && <div className="mya-fact"><span>尺寸</span><b className="mono">{detail.width} × {detail.height}</b></div>}
          {detail.duration != null && <div className="mya-fact"><span>时长</span><b className="mono">{formatDur(detail.duration)}</b></div>}
          <div className="mya-fact"><span>最近使用</span><b className="mono">{detail.lastUsedAt ? new Date(detail.lastUsedAt).toLocaleDateString('zh-CN') : '—'}</b></div>
          <div className="mya-fact mya-fact-wide"><span>路径</span><b className="mono" title={detail.filePath}>{detail.filePath}</b></div>
        </div>

        <div className="mya-sec">标签</div>
        <div className="mya-tags">
          {detail.tags.filter((t) => t !== '★').map((t) => (
            <span key={t} className="mya-tag">{t}
              <button type="button" onClick={() => applyPatch(detail.id, { tags: detail.tags.filter((x) => x !== t) })} title="移除" aria-label={`移除标签 ${t}`}><Icon name="x" /></button>
            </span>
          ))}
          <input className="mya-tag-input" value={tagText} placeholder="+ 标签"
                 onChange={(e) => setTagText(e.target.value)}
                 onKeyDown={(e) => {
                   if (e.key === 'Enter' && tagText.trim()) {
                     applyPatch(detail.id, { tags: [...new Set([...detail.tags, tagText.trim()])] })
                     setTagText('')
                   }
                 }} />
        </div>

        <div className="mya-sec">来源与授权</div>
        <div className="mya-param">
          <span className="mya-plabel">授权</span>
          <select className="mya-select" value={detail.licenseStatus} aria-label="授权状态"
                  onChange={(e) => applyPatch(detail.id, { licenseStatus: e.target.value as LicenseStatus })}>
            {(Object.keys(LICENSE_LABEL) as LicenseStatus[]).map((k) => <option key={k} value={k}>{LICENSE_LABEL[k]}</option>)}
          </select>
        </div>
        <div className="mya-param">
          <span className="mya-plabel">审核</span>
          <select className="mya-select" value={detail.reviewStatus} aria-label="审核状态"
                  onChange={(e) => applyPatch(detail.id, { reviewStatus: e.target.value as ReviewStatus })}>
            {(Object.keys(REVIEW_LABEL) as ReviewStatus[]).map((k) => <option key={k} value={k}>{REVIEW_LABEL[k]}</option>)}
          </select>
        </div>
        {detail.licenseDetails && <p className="mya-detail-note">{detail.licenseDetails}</p>}

        <div className="mya-sec">引用关系</div>
        {detail.refs.length ? (
          <div className="mya-refs">
            {detail.refs.map((r, i) => (
              <div key={i} className="mya-ref">
                <Icon name={r.kind === 'project' ? 'folder-open' : r.kind === 'workflow' ? 'workflow' : 'play'} />
                <span>{r.label}</span>
                <em>{r.kind === 'project' ? '项目' : r.kind === 'workflow' ? '工作流' : '任务'}</em>
              </div>
            ))}
          </div>
        ) : <p className="mya-dim">未被任何项目或工作流引用。</p>}
      </div>
    </aside>
  )
}
