import { useEffect, useRef, useState } from 'react'
import type * as React from 'react'
import {
  LICENSE_LABEL,
  PROCESSING_LABEL,
  REF_KIND_ICON,
  REF_KIND_LABEL,
  REVIEW_LABEL,
  REVIEW_TRANSITIONS,
  SOURCE_LABEL,
  type LicenseStatus,
  type MyAsset,
} from '@/features/assets/model/myAssets'
import { assetFormatBadge, assetUseBlock, detailSpec, formatAssetDate, mayHaveAlpha } from '@/features/assets/model/assetDisplay'
import { Icon } from '@/features/assets/components/AssetIcon'
import type { ProjectOption } from '@/features/assets/model/assetTree'
import { Preview } from '@/features/assets/components/AssetPreview'
import { formatBytes, formatDur, type FolderRow } from '@/features/assets/services/assetApiService'
import {
  PURPOSE_LABEL,
  type PendingAsset,
  type AssetPurpose,
  type PendingRefCard,
  type PendingFxCard,
} from '@/features/assets/hooks/usePendingAssets'

const PURPOSES: AssetPurpose[] = ['unspecified', 'visual', 'reference', 'audio', 'information']

export interface AssetInspectorProps {
  addToPending: (ids: string[]) => number
  applyPatch: (id: string, patch: Partial<MyAsset>) => void
  copyPath: (a: MyAsset) => Promise<void>
  detail: MyAsset
  doDelete: (ids: string[], skipConfirm?: boolean) => void
  doRename: (target?: MyAsset, nextName?: string) => void
  folders: FolderRow[]
  moveToFolder: (ids: string[], folderId: string | null, folderName?: string) => void
  projects: ProjectOption[]
  moveToProject: (ids: string[], projectId: string | null, projectName?: string) => void
  pending: {
    items: PendingAsset[]
    add: (assetIds: string[], purpose?: AssetPurpose) => number
    addRef: (cards: PendingRefCard[]) => number
    addFx: (cards: PendingFxCard[]) => number
    remove: (assetId: string) => void
    removeMany: (assetIds: string[]) => void
    clear: () => void
    patch: (assetId: string, next: Partial<Omit<PendingAsset, 'assetId' | 'addedAt'>>) => void
    has: (assetId: string) => boolean
    saveFailed: boolean
    retrySave: () => void
  }
  sendToReference: (a: MyAsset) => Promise<void>
  setDetailId: React.Dispatch<React.SetStateAction<string | null>>
  setTagText: React.Dispatch<React.SetStateAction<string>>
  tagText: string
  thumbs: Record<string, string>
  toggleFav: (a: MyAsset) => void
}

/** 我的素材右侧详情检查器：预览、待发送与用途设定、原地重命名、文件与归属属性表、标签、授权与五态审核流转、引用关系。 */
export function AssetInspector({
  addToPending,
  applyPatch,
  copyPath,
  detail,
  doDelete,
  doRename,
  folders,
  moveToFolder,
  projects,
  moveToProject,
  pending,
  sendToReference,
  setDetailId,
  setTagText,
  tagText,
  thumbs,
  toggleFav,
}: AssetInspectorProps) {
  const closeRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [narrow, setNarrow] = useState(() => window.matchMedia('(max-width: 1200px)').matches)
  useEffect(() => {
    const media = window.matchMedia('(max-width: 1200px)')
    const change = () => setNarrow(media.matches)
    media.addEventListener('change', change)
    return () => media.removeEventListener('change', change)
  }, [])
  useEffect(() => {
    if (!narrow || !dialogRef.current) return
    const previous = document.activeElement as HTMLElement | null
    const dialog = dialogRef.current
    dialog.showModal()
    closeRef.current?.focus()
    return () => {
      dialog.close()
      if (previous?.isConnected) previous.focus()
    }
  }, [narrow])
  const Panel = narrow ? 'dialog' : 'aside'
  const [editingName, setEditingName] = useState(false)
  const [nameDraft, setNameDraft] = useState(detail.name)
  const [licenseNoteDraft, setLicenseNoteDraft] = useState(detail.licenseDetails ?? '')
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const moreRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!menuOpen) return
    const close = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [menuOpen])

  const blocked = assetUseBlock(detail)
  const inPending = pending.has(detail.id)
  const pendingEntry = pending.items.find((x) => x.assetId === detail.id)
  const isFav = detail.tags.includes('★')
  const inRefLibrary = detail.refs.some((r) => r.kind === 'reference')
  const transitions = REVIEW_TRANSITIONS[detail.reviewStatus] ?? []
  const notReadyForApprove = Boolean(detail.processingStatus && detail.processingStatus !== 'ready')

  const cancelName = (e: React.KeyboardEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setNameDraft(detail.name)
    setEditingName(false)
  }

  const commitName = () => {
    const trimmed = nameDraft.trim()
    if (trimmed && trimmed !== detail.name) {
      doRename(detail, trimmed)
    } else {
      setNameDraft(detail.name)
    }
    setEditingName(false)
  }

  const commitLicenseNote = () => {
    const trimmed = licenseNoteDraft.trim()
    const current = (detail.licenseDetails ?? '').trim()
    if (trimmed !== current) {
      applyPatch(detail.id, { licenseDetails: trimmed })
    }
  }

  return (
    <Panel className="mya-inspector" aria-label="素材详情" ref={narrow ? dialogRef : undefined}
      onCancel={e => { e.preventDefault(); e.stopPropagation(); setDetailId(null) }}
      onKeyDown={narrow ? (e: React.KeyboardEvent<HTMLElement>) => {
        // 原生 modal 不会把 Tab 限在框内（Chromium 会把焦点交给浏览器界面）；这里首尾循环
        if (e.key !== 'Tab') return
        const items = [...e.currentTarget.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, video[controls], audio[controls], [tabindex]:not([tabindex="-1"])',
        )].filter((el) => el.tagName === 'SUMMARY'
          // 收起的 details 内容不可聚焦，但 Chromium 里 offsetParent 仍非空，要单独排除
          || (el.offsetParent !== null && !el.closest('details:not([open])')))
        if (items.length === 0) return
        const first = items[0]
        const last = items[items.length - 1]
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
      } : undefined}>
      <div className="mya-drawer-head">
        <div className="mya-drawer-title-wrap">
          {editingName ? (
            <div className="mya-title-edit">
              <input
                className="mya-title-input"
                value={nameDraft}
                autoFocus
                aria-label="素材名称"
                onChange={(e) => setNameDraft(e.target.value)}
                onBlur={commitName}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.currentTarget.blur()
                  if (e.key === 'Escape') cancelName(e)
                }}
              />
            </div>
          ) : (
            <button
              type="button"
              className="mya-drawer-title-btn"
              title="点击重命名"
              onClick={() => {
                setNameDraft(detail.name)
                setEditingName(true)
              }}
            >
              <span className="mya-drawer-title">{detail.name}</span>
              <Icon name="pencil" />
            </button>
          )}
          <span className="mya-drawer-meta">
            {detailSpec(detail)}
            {detail.demo ? ' · 演示' : ''}
          </span>
        </div>
        <button
          type="button"
          className="mya-iconbtn"
          onClick={() => setDetailId(null)}
          title="关闭详情 (Esc)"
          aria-label="关闭详情"
          ref={closeRef}
        >
          <Icon name="x" />
        </button>
      </div>

      <div className="mya-drawer-body">
        <div className="mya-preview" data-media={detail.mediaType} data-alpha={mayHaveAlpha(detail) || undefined}>
          <Preview asset={detail} poster={thumbs[detail.id]} />
        </div>

        {/* 操作行：加入待发送是唯一实心按钮；收藏常驻；其余管理动作收进「更多」 */}
        <div className="mya-use-row">
          {inPending ? (
            <div className="mya-use-status" role="status">
              <Icon name="square-check" />
              <span>已在待发送</span>
              <button type="button" className="mya-use-remove" onClick={() => pending.remove(detail.id)}>
                移出
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="mya-use-primary"
              disabled={!!blocked}
              onClick={() => addToPending([detail.id])}
            >
              <Icon name="plus" />
              <span>{blocked || '加入待发送'}</span>
            </button>
          )}
          <button
            type="button"
            className="mya-sqbtn"
            data-on={isFav || undefined}
            aria-pressed={isFav}
            aria-label={isFav ? '取消收藏' : '收藏'}
            title={isFav ? '取消收藏' : '收藏'}
            onClick={() => toggleFav(detail)}
          >
            <Icon name="star" />
          </button>
          <div
            className="mya-more"
            ref={menuRef}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && menuOpen) {
                e.preventDefault()
                e.stopPropagation()
                setMenuOpen(false)
                moreRef.current?.focus()
              }
            }}
          >
            <button
              type="button"
              ref={moreRef}
              className="mya-sqbtn"
              data-on={menuOpen || undefined}
              aria-label="更多操作"
              title="更多操作"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((v) => !v)}
            >
              <Icon name="ellipsis" />
            </button>
            {menuOpen && (
              <div className="mya-menu" role="menu" aria-label="更多操作">
                <button
                  type="button"
                  role="menuitem"
                  autoFocus
                  onClick={() => {
                    setMenuOpen(false)
                    setNameDraft(detail.name)
                    setEditingName(true)
                  }}
                >
                  <Icon name="pencil" />
                  <span>重命名</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false)
                    void copyPath(detail)
                  }}
                >
                  <Icon name="copy" />
                  <span>复制文件地址</span>
                </button>
                {detail.mediaType === 'video' && (
                  <button
                    type="button"
                    role="menuitem"
                    disabled={inRefLibrary || !!blocked}
                    title={inRefLibrary ? '该视频已登记到参考片库' : '登记到参考片库，之后可做切片与镜头分析'}
                    onClick={() => {
                      setMenuOpen(false)
                      void sendToReference(detail)
                    }}
                  >
                    <Icon name="camera" />
                    <span>{inRefLibrary ? '已在参考片库' : '加入参考片库'}</span>
                  </button>
                )}
                <span className="mya-menu-sep" role="separator" />
                <button
                  type="button"
                  role="menuitem"
                  className="mya-menu-danger"
                  onClick={() => {
                    setMenuOpen(false)
                    setConfirmingDelete(true)
                  }}
                >
                  <Icon name="trash-2" />
                  <span>删除</span>
                </button>
              </div>
            )}
          </div>
        </div>
        {inPending && (
          <label className="mya-use-purpose">
            <span>用途</span>
            <select
              className="mya-kv-select"
              value={pendingEntry?.purpose ?? 'unspecified'}
              aria-label="待发送素材用途"
              onChange={(e) => pending.patch(detail.id, { purpose: e.target.value as AssetPurpose })}
            >
              {PURPOSES.map((p) => (
                <option key={p} value={p}>
                  {PURPOSE_LABEL[p]}
                </option>
              ))}
            </select>
          </label>
        )}

        {confirmingDelete && (
          <div className="mya-delete-confirm" role="alert">
            {detail.refs.length > 0 ? (
              <>
                <p>
                  正被 <b>{detail.refs.map((r) => r.label).join('、')}</b> 引用，需先解除引用才能删除。
                </p>
                <div className="mya-delete-confirm-acts">
                  <button type="button" onClick={() => setConfirmingDelete(false)}>
                    知道了
                  </button>
                </div>
              </>
            ) : (
              <>
                <p>从素材库永久移除「{detail.name}」？此操作不可恢复。</p>
                <div className="mya-delete-confirm-acts">
                  <button type="button" onClick={() => setConfirmingDelete(false)}>
                    取消
                  </button>
                  <button
                    type="button"
                    className="mya-danger-fill"
                    onClick={() => doDelete([detail.id], true)}
                  >
                    确认删除
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        <div className="mya-sec">信息</div>
        <dl className="mya-kv-list">
          <div className="mya-kv-row">
            <dt>项目</dt>
            <dd>
              <select
                className="mya-kv-select"
                value={detail.projectId ?? ''}
                aria-label="归属项目"
                onChange={(e) => {
                  const nextId = e.target.value || null
                  moveToProject([detail.id], nextId, projects.find((p) => p.id === nextId)?.name)
                }}
              >
                <option value="">未归属</option>
                {/* 归属的项目已归档或不在列表里：如实标出，不悄悄显示成「未归属」 */}
                {detail.projectId && !projects.some((p) => p.id === detail.projectId) && (
                  <option value={detail.projectId}>项目不可用</option>
                )}
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </dd>
          </div>
          <div className="mya-kv-row">
            <dt>文件夹</dt>
            <dd>
              <select
                className="mya-kv-select"
                value={detail.folderId ?? ''}
                aria-label="所属文件夹"
                onChange={(e) => {
                  const nextId = e.target.value || null
                  const folderName = folders.find((f) => f.id === nextId)?.name
                  moveToFolder([detail.id], nextId, folderName)
                }}
              >
                <option value="">未分类</option>
                {folders.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </dd>
          </div>
          <div className="mya-kv-row">
            <dt>来源</dt>
            <dd>{SOURCE_LABEL[detail.sourceType]}</dd>
          </div>
          <div className="mya-kv-row">
            <dt>格式</dt>
            <dd title={detail.mimeType}>{assetFormatBadge(detail)}</dd>
          </div>
          <div className="mya-kv-row">
            <dt>尺寸</dt>
            <dd className="num">
              {detail.width != null && detail.height != null ? `${detail.width} × ${detail.height}` : '—'}
            </dd>
          </div>
          {(detail.mediaType === 'video' || detail.mediaType === 'audio') && (
            <div className="mya-kv-row">
              <dt>时长</dt>
              <dd className="num">{detail.duration != null ? formatDur(detail.duration) : '—'}</dd>
            </div>
          )}
          <div className="mya-kv-row">
            <dt>大小</dt>
            <dd className="num">{formatBytes(detail.sizeBytes)}</dd>
          </div>
          <div className="mya-kv-row">
            <dt>添加时间</dt>
            <dd className="num">{formatAssetDate(detail.createdAt)}</dd>
          </div>
          <div className="mya-kv-row">
            <dt>最近使用</dt>
            <dd className="num">{formatAssetDate(detail.lastUsedAt)}</dd>
          </div>
        </dl>

        <div className="mya-sec">标签</div>
        <div className="mya-tags" key={detail.id}>
          {detail.tags
            .filter((t) => t !== '★')
            .map((t) => (
              <span key={t} className="mya-tag">
                {t}
                <button
                  type="button"
                  onClick={() =>
                    applyPatch(detail.id, { tags: detail.tags.filter((x) => x !== t) })
                  }
                  title="移除"
                  aria-label={`移除标签 ${t}`}
                >
                  <Icon name="x" />
                </button>
              </span>
            ))}
          <input
            className="mya-tag-input"
            value={tagText}
            placeholder="+ 添加标签"
            aria-label="添加标签"
            onChange={(e) => setTagText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && tagText.trim()) {
                applyPatch(detail.id, { tags: [...new Set([...detail.tags, tagText.trim()])] })
                setTagText('')
              }
            }}
          />
        </div>

        <details className="mya-inspector-section" open={blocked ? true : undefined}>
        <summary>授权与审核 <span>{LICENSE_LABEL[detail.licenseStatus]} · {REVIEW_LABEL[detail.reviewStatus]}</span></summary>
        <div className="mya-compliance">
          {detail.processingStatus && detail.processingStatus !== 'ready' && (
            <div className="mya-compliance-row">
              <span className="mya-plabel">处理</span>
              <span className="mya-status-pill" data-s={detail.processingStatus}>
                <i className="mya-status-dot" />
                {PROCESSING_LABEL[detail.processingStatus]}
              </span>
              {detail.processingError && (
                <span className="mya-processing-err">{detail.processingError}</span>
              )}
            </div>
          )}

          <div className="mya-compliance-row">
            <span className="mya-plabel">授权</span>
            <select
              className="mya-kv-select"
              value={detail.licenseStatus}
              aria-label="授权状态"
              onChange={(e) =>
                applyPatch(detail.id, { licenseStatus: e.target.value as LicenseStatus })
              }
            >
              {(Object.keys(LICENSE_LABEL) as LicenseStatus[]).map((k) => (
                <option key={k} value={k}>
                  {LICENSE_LABEL[k]}
                </option>
              ))}
            </select>
          </div>
          <input
            className="mya-license-input"
            type="text"
            value={licenseNoteDraft}
            placeholder="补充来源或署名要求，回车保存"
            aria-label="授权说明"
            onChange={(e) => setLicenseNoteDraft(e.target.value)}
            onBlur={commitLicenseNote}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.currentTarget.blur()
              }
            }}
          />

          <div className="mya-compliance-row mya-review-row">
            <span className="mya-plabel">审核</span>
            <span className="mya-status-pill" data-s={detail.reviewStatus}>
              <i className="mya-status-dot" />
              {REVIEW_LABEL[detail.reviewStatus]}
            </span>
            <div className="mya-review-transitions">
              {transitions.map((action) => {
                const blocked = Boolean(action.requiresReady && notReadyForApprove)
                return (
                  <button
                    key={action.to}
                    type="button"
                    className="mya-transition-btn"
                    data-tone={action.tone ?? 'neutral'}
                    disabled={blocked}
                    title={
                      blocked
                        ? '素材处理完成（已就绪）后才能通过审核'
                        : `将审核状态转为「${REVIEW_LABEL[action.to]}」`
                    }
                    onClick={() => applyPatch(detail.id, { reviewStatus: action.to })}
                  >
                    <Icon name={action.icon} />
                    <span>{action.label}</span>
                  </button>
                )
              })}
            </div>
          </div>
        </div>

        </details>
        <div className="mya-sec">使用位置</div>
        {detail.refs.length > 0 ? (
          <div className="mya-refs">
            {detail.refs.map((r, i) => (
              <div key={`${r.kind}-${r.id}-${i}`} className="mya-ref">
                <Icon name={REF_KIND_ICON[r.kind] ?? 'link'} />
                <span title={r.label}>{r.label}</span>
                <em>{REF_KIND_LABEL[r.kind] ?? r.kind}</em>
              </div>
            ))}
          </div>
        ) : (
          <p className="mya-dim">尚未被项目、工作流或参考片引用。</p>
        )}
      </div>
    </Panel>
  )
}
