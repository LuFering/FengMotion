import type * as React from 'react'
import { LoadingState } from '@/shared/components/fm/LoadingState'
import { ErrorState } from '@/shared/components/fm/ErrorState'
import { EmptyState } from '@/shared/components/fm/EmptyState'
import { assetFlag, fullMeta, cardSpec, listSpec, type SortKey } from '@/features/assets/model/assetDisplay'
import { setAssetDragData, type PendingAsset, type AssetPurpose, type PendingRefCard, type PendingFxCard } from '@/features/assets/hooks/usePendingAssets'
import { setDragGhost, clearDragGhost } from '@/shared/pick-mode/dragGhost'
import { AssetVideoThumb } from '@/features/assets/components/AssetPreview'
import { Icon } from '@/features/assets/components/AssetIcon'
import { MEDIA_ICON, MEDIA_LABEL, SOURCE_LABEL, LICENSE_LABEL, REVIEW_LABEL, type MyAsset, type MediaType } from '@/features/assets/model/myAssets'
import { formatDur, formatBytes } from '@/features/assets/services/assetApiService'
import type { MigrationReport } from '@/features/assets/services/assetMigration'
import type { NodeId } from '@/features/assets/Assets'

export interface AssetCanvasProps {
  addToPending: (ids: string[]) => number
  assets: MyAsset[]
  clearFilter: () => void
  detailId: string | null
  hoveredVideo: string | null
  inputRef: React.RefObject<HTMLInputElement | null>
  legacyPending: boolean
  loadError: boolean
  loading: boolean
  migrating: boolean
  migration: MigrationReport | null
  migrationDone: number
  node: NodeId
  onGridKeys: (e: React.KeyboardEvent) => void
  openDetail: (a: MyAsset) => void
  pending: { items: PendingAsset[]; add: (assetIds: string[], purpose?: AssetPurpose) => number; addRef: (cards: PendingRefCard[]) => number; addFx: (cards: PendingFxCard[]) => number; remove: (assetId: string) => void; removeMany: (assetIds: string[]) => void; clear: () => void; patch: (assetId: string, next: Partial<Omit<PendingAsset, 'assetId' | 'addedAt'>>) => void; has: (assetId: string) => boolean; saveFailed: boolean; retrySave: () => void }
  pickMode: boolean
  runMigration: () => Promise<void>
  selected: Set<string>
  setHoveredVideo: React.Dispatch<React.SetStateAction<string | null>>
  setLoadVersion: React.Dispatch<React.SetStateAction<number>>
  sortKey: SortKey
  thumbs: Record<string, string>
  toggleFav: (a: MyAsset) => void
  toggleSelect: (id: string) => void
  typeFilter: 'all' | MediaType
  viewMode: 'grid' | 'list'
  visible: MyAsset[]
}

/** 从 Assets.tsx 原样拆出的界面区块；props 与原处的变量同名。 */
export function AssetCanvas({ addToPending, assets, clearFilter, detailId, hoveredVideo, inputRef, legacyPending, loadError, loading, migrating, migration, migrationDone, node, onGridKeys, openDetail, pending, pickMode, runMigration, selected, setHoveredVideo, setLoadVersion, sortKey, thumbs, toggleFav, toggleSelect, typeFilter, viewMode, visible }: AssetCanvasProps) {
  return (
    <main className="mya-canvas">
      {legacyPending && (
        <div className="mya-migrate" role="status">
          <div className="mya-migrate-text">
            {migration?.phase === 'failed' ? (
              <>
                <strong>上次迁移未完成</strong>
                <span>
                  已有 {migration.migrated} 个迁移成功、{migration.failed} 个失败。
                  失败项仍保留在浏览器里，可以重试。
                </span>
              </>
            ) : (
              <>
                <strong>发现旧版素材</strong>
                <span>
                  旧版把素材存在浏览器里，新版存在素材库。迁移会把文件复制到素材库并保留名称、标签与授权；
                  原来的浏览器数据不会删除。
                </span>
              </>
            )}
          </div>
          <button
            type="button"
            className="mya-migrate-btn"
            onClick={() => void runMigration()}
            disabled={migrating}
          >
            {migrating ? `迁移中 ${migrationDone} / ${migration?.total ?? 0}` : '迁移到素材库'}
          </button>
        </div>
      )}
      <div className="mya-scroll">
        {loading ? (
          <LoadingState variant="grid" rows={8} />
        ) : loadError ? (
          <ErrorState
            body="素材索引读取失败，可能是本地存储暂时不可用。请重试。"
            onRetry={() => setLoadVersion((v) => v + 1)}
          />
        ) : visible.length === 0 ? (
          assets.length === 0 ? (
            <EmptyState
              icon="image"
              title="素材库还是空的"
              body={'把图片、视频、音频、字体拖进来，或点右上角「导入素材」。\n文件会复制进应用管理的素材库，删除原文件不影响使用。'}
              action={{ label: '导入素材', onClick: () => inputRef.current?.click() }}
            />
          ) : (
            <EmptyState
              icon="image"
              title="没有符合当前筛选的素材"
              body="换个分类，或清除搜索条件。"
              action={{ label: '清除筛选', onClick: clearFilter }}
            />
          )
        ) : viewMode === 'grid' ? (
          <div className="mya-grid" key={`${node}|${typeFilter}|${sortKey}`} onKeyDown={onGridKeys}>
            {visible.map((a) => {
              const flag = assetFlag(a)
              return (
                <div key={a.id} className="mya-card"
                     onMouseEnter={() => { if (a.mediaType === 'video') setHoveredVideo(a.id) }}
                     onMouseLeave={() => setHoveredVideo((id) => id === a.id ? null : id)}
                     onFocus={() => { if (a.mediaType === 'video') setHoveredVideo(a.id) }}
                     onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setHoveredVideo((id) => id === a.id ? null : id) }}
                     data-on={detailId === a.id || undefined}
                     data-picked={selected.has(a.id) || undefined}
                     data-pending={pending.has(a.id) || undefined}
                     role="option" aria-selected={detailId === a.id} tabIndex={0}
                     title={fullMeta(a)}
                     draggable
                     onDragStart={(e) => {
                       /* 多选时拖一个等于拖全部 —— 用户选了 4 个再拖，
                          预期是把这 4 个一起放进待发送。 */
                       const ids = selected.has(a.id) && selected.size > 1 ? [...selected] : [a.id]
                       setAssetDragData(e.dataTransfer, ids)
                       /* 拖影缩成一小块：默认拖影是整张卡片快照，
                          举在鼠标边会盖住落点，看不清要放到哪。 */
                       const ghostEl = setDragGhost({
                         thumb: thumbs[a.id], label: a.name, count: ids.length,
                       })
                       e.dataTransfer.setDragImage(ghostEl, 28, 28)
                     }}
                     onDragEnd={clearDragGhost}
                     data-pickmode={pickMode || undefined}
                     onClick={() => (pickMode ? toggleSelect(a.id) : openDetail(a))}
                     onKeyDown={(e) => {
                       if (e.target !== e.currentTarget) return
                       if (e.key === 'Enter' || e.key === ' ') {
                         e.preventDefault()
                         if (pickMode) toggleSelect(a.id); else openDetail(a)
                       }
                     }}>
                  <div className="mya-thumb">
                    {a.mediaType === 'video'
                      ? <AssetVideoThumb assetId={a.id} poster={thumbs[a.id]} active={hoveredVideo === a.id && !pickMode && !detailId} />
                      : thumbs[a.id]
                        ? <img src={thumbs[a.id]} alt="" loading="lazy" draggable={false} />
                        : <span className="mya-thumb-ph"><Icon name={MEDIA_ICON[a.mediaType]} /></span>}
                    <label className="mya-check" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={selected.has(a.id)} onChange={() => toggleSelect(a.id)}
                             aria-label={`选择 ${a.name}`} />
                    </label>
                    <button type="button" className="mya-star" data-on={a.tags.includes('★') || undefined}
                            aria-label={a.tags.includes('★') ? `取消收藏 ${a.name}` : `收藏 ${a.name}`}
                            onClick={(e) => { e.stopPropagation(); toggleFav(a) }}>
                      <Icon name="star" />
                    </button>
                    {/* 加入待发送：拖拽之外的常驻入口 —— 拖拽不能是唯一方式。
                        已加入的显示勾，点了不重复加（store 按 ID 去重）。 */}
                    <button type="button" className="mya-pending-btn"
                            data-added={pending.has(a.id) || undefined}
                            aria-label={pending.has(a.id) ? `${a.name} 已在待发送` : `把 ${a.name} 加入待发送`}
                            title={pending.has(a.id) ? '已在待发送' : '加入待发送'}
                            onClick={(e) => { e.stopPropagation(); addToPending([a.id]) }}>
                      {pending.has(a.id) ? <Icon name="square-check" /> : <Icon name="plus" />}
                    </button>
                  </div>
                  <div className="mya-card-head">
                    <span className="mya-media-kind"><Icon name={MEDIA_ICON[a.mediaType]} />{MEDIA_LABEL[a.mediaType]}</span>
                    {a.mediaType === 'video' && a.duration != null && <span className="mya-media-duration num">{formatDur(a.duration)}</span>}
                  </div>
                  <div className="mya-card-body">
                    <div className="mya-card-title-row">
                      <div className="mya-card-name">{a.name}</div>
                      {flag && <span className="mya-card-warning" data-tone={flag.tone} title={flag.label} aria-label={flag.label}><Icon name="info" /></span>}
                    </div>
                    <div className="mya-card-meta">
                      <span className="mya-card-spec">{a.mediaType === 'video'
                        ? [a.width != null ? `${a.width} × ${a.height}` : null, formatBytes(a.sizeBytes)].filter(Boolean).join(' · ')
                        : cardSpec(a)}</span>
                      {a.refs.length > 0 && <span className="mya-refs-badge" title={`${a.refs.length} 处引用`}><Icon name="link" />{a.refs.length}</span>}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="mya-list">
            <div className="mya-list-head">
              <span className="mya-col-check" />
              <span className="mya-col-name">名称</span>
              <span className="mya-col-type">类型</span>
              <span className="mya-col-dim">时长 / 尺寸</span>
              <span className="mya-col-size">大小</span>
              <span className="mya-col-src">来源</span>
              <span className="mya-col-refs">引用</span>
              <span className="mya-col-lic">授权</span>
              <span className="mya-col-rev">审核</span>
            </div>
            {visible.map((a) => (
              <div key={a.id} className="mya-row"
                   data-on={detailId === a.id || undefined}
                   data-picked={selected.has(a.id) || undefined}
                   data-pending={pending.has(a.id) || undefined}
                   role="option" aria-selected={detailId === a.id} tabIndex={0}
                   draggable
                   onDragStart={(e) => {
                     const ids = selected.has(a.id) && selected.size > 1 ? [...selected] : [a.id]
                     setAssetDragData(e.dataTransfer, ids)
                     const ghostEl = setDragGhost({
                       thumb: thumbs[a.id], label: a.name, count: ids.length,
                     })
                     e.dataTransfer.setDragImage(ghostEl, 28, 28)
                   }}
                   onDragEnd={clearDragGhost}
                   data-pickmode={pickMode || undefined}
                   onClick={() => (pickMode ? toggleSelect(a.id) : openDetail(a))}
                   onKeyDown={(e) => {
                     if (e.target !== e.currentTarget) return
                     if (e.key === 'Enter' || e.key === ' ') {
                       e.preventDefault()
                       if (pickMode) toggleSelect(a.id); else openDetail(a)
                     }
                   }}>
                <span className="mya-col-check" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                  <input type="checkbox" checked={selected.has(a.id)} onChange={() => toggleSelect(a.id)}
                         aria-label={`选择 ${a.name}`} />
                </span>
                <span className="mya-col-name">
                  <span className="mya-row-thumb">
                    {thumbs[a.id] ? <img src={thumbs[a.id]} alt="" loading="lazy" draggable={false} />
                                  : <Icon name={MEDIA_ICON[a.mediaType]} />}
                  </span>
                  <span className="mya-row-name" title={a.name}>{a.name}</span>
                  {a.tags.includes('★') && <Icon name="star" className="mya-row-star" />}
                </span>
                <span className="mya-col-type">{MEDIA_LABEL[a.mediaType]}</span>
                <span className="mya-col-dim mono">{listSpec(a)}</span>
                <span className="mya-col-size mono">{formatBytes(a.sizeBytes)}</span>
                <span className="mya-col-src">{SOURCE_LABEL[a.sourceType]}</span>
                <span className="mya-col-refs mono">{a.refs.length > 0 ? a.refs.length : '—'}</span>
                <span className="mya-col-lic"><span className="mya-status-pill" data-s={a.licenseStatus}>{LICENSE_LABEL[a.licenseStatus]}</span></span>
                <span className="mya-col-rev"><span className="mya-status-pill" data-s={a.reviewStatus}>{REVIEW_LABEL[a.reviewStatus]}</span></span>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  )
}
