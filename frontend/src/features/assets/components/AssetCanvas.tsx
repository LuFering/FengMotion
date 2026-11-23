import type * as React from 'react'
import { LoadingState } from '@/shared/components/fm/LoadingState'
import { ErrorState } from '@/shared/components/fm/ErrorState'
import { EmptyState } from '@/shared/components/fm/EmptyState'
import { assetUseBlock, assetFlag, assetFormatBadge, fullMeta, cardSpec, listSpec, licenseTone, mayHaveAlpha, reviewTone, type SortKey } from '@/features/assets/model/assetDisplay'
import {
  setAssetDragData,
  type PendingAsset,
  type AssetPurpose,
  type PendingRefCard,
  type PendingFxCard,
} from '@/features/assets/hooks/usePendingAssets'
import { setDragGhost, clearDragGhost } from '@/shared/pick-mode/dragGhost'
import {
  AssetImageThumb,
  AssetFontCardSurface,
  AssetTypedCardSurface,
  AssetVideoThumb,
} from '@/features/assets/components/AssetPreview'
import { Icon } from '@/features/assets/components/AssetIcon'
import {
  MEDIA_ICON,
  SOURCE_LABEL,
  LICENSE_LABEL,
  REVIEW_LABEL,
  type MyAsset,
  type MediaType,
} from '@/features/assets/model/myAssets'
import { formatDur, formatBytes } from '@/features/assets/services/assetApiService'
import type { MigrationReport } from '@/features/assets/services/assetMigration'
import type { NodeId } from '@/features/assets/model/assetTree'

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
  /** 当前分类名，用于项目空态文案 */
  scopeLabel: string
  onGridKeys: (e: React.KeyboardEvent) => void
  openDetail: (a: MyAsset) => void
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

/** 我的素材的主画布：旧版素材迁移提示，以及加载/出错/空状态与素材的网格或列表账本。 */
export function AssetCanvas({
  addToPending,
  assets,
  clearFilter,
  detailId,
  hoveredVideo,
  inputRef,
  legacyPending,
  loadError,
  loading,
  migrating,
  migration,
  migrationDone,
  node,
  scopeLabel,
  onGridKeys,
  openDetail,
  pending,
  pickMode,
  runMigration,
  selected,
  setHoveredVideo,
  setLoadVersion,
  sortKey,
  thumbs,
  toggleFav,
  toggleSelect,
  typeFilter,
  viewMode,
  visible,
}: AssetCanvasProps) {
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
            body="暂时无法读取素材库，请检查本地服务后重试。"
            onRetry={() => setLoadVersion((v) => v + 1)}
          />
        ) : visible.length === 0 ? (
          assets.length === 0 ? (
            <EmptyState
              icon="image"
              title="素材库还是空的"
              body="导入图片、视频、音频、字体或文档，留待下一次创作使用。也可以直接拖入文件。"
              action={{ label: '导入素材', onClick: () => inputRef.current?.click() }}
            />
          ) : node.startsWith('proj:') && typeFilter === 'all' ? (
            // 项目本身还没有素材：不是「筛选条件不对」，要告诉用户怎么把素材放进来
            <EmptyState
              icon="clapperboard"
              title={`「${scopeLabel}」还没有素材`}
              body="在这里导入的素材会归属到这个项目；也可以在全部素材里选中后「移至项目」。"
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
              const inPending = pending.has(a.id)
              const blocked = assetUseBlock(a)
              const isFav = a.tags.includes('★')
              return (
                <div
                  key={a.id}
                  className="mya-card"
                  data-media={a.mediaType}
                  data-alpha={mayHaveAlpha(a) || undefined}
                  onMouseEnter={() => {
                    if (a.mediaType === 'video') setHoveredVideo(a.id)
                  }}
                  onMouseLeave={() => setHoveredVideo((id) => (id === a.id ? null : id))}
                  onFocus={() => {
                    if (a.mediaType === 'video') setHoveredVideo(a.id)
                  }}
                  onBlur={(e) => {
                    if (!e.currentTarget.contains(e.relatedTarget)) {
                      setHoveredVideo((id) => (id === a.id ? null : id))
                    }
                  }}
                  data-on={detailId === a.id || undefined}
                  data-picked={selected.has(a.id) || undefined}
                  data-pending={inPending || undefined}
                  role="group"
                  aria-label={`${a.name}${selected.has(a.id) ? '，已选择' : ''}`}
                  tabIndex={0}
                  title={fullMeta(a)}
                  draggable={!blocked}
                  onDragStart={(e) => {
                    const ids = selected.has(a.id) && selected.size > 1 ? [...selected] : [a.id]
                    setAssetDragData(e.dataTransfer, ids)
                    const ghostEl = setDragGhost({
                      thumb: thumbs[a.id],
                      label: a.name,
                      count: ids.length,
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
                      if (pickMode) toggleSelect(a.id)
                      else openDetail(a)
                    }
                  }}
                >
                  <div className="mya-thumb">
                    {a.mediaType === 'video' ? (
                      <AssetVideoThumb
                        assetId={a.id}
                        poster={thumbs[a.id]}
                        active={hoveredVideo === a.id && !pickMode && !detailId}
                      />
                    ) : a.mediaType === 'font' ? (
                      <AssetFontCardSurface asset={a} />
                    ) : thumbs[a.id] ? (
                      <AssetImageThumb key={thumbs[a.id]} src={thumbs[a.id]} />
                    ) : a.mediaType === 'audio' || a.mediaType === 'doc' ? (
                      <AssetTypedCardSurface asset={a} />
                    ) : (
                      <span className="mya-thumb-ph">
                        <Icon name={MEDIA_ICON[a.mediaType]} />
                      </span>
                    )}

                    <label
                      className="mya-check"
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => e.stopPropagation()}
                    >
                      <input
                        type="checkbox"
                        checked={selected.has(a.id)}
                        onChange={() => toggleSelect(a.id)}
                        aria-label={`选择 ${a.name}`}
                      />
                    </label>
                    <button
                      type="button"
                      className="mya-star"
                      data-on={isFav || undefined}
                      aria-label={isFav ? `取消收藏 ${a.name}` : `收藏 ${a.name}`}
                      title={isFav ? '取消收藏' : '收藏'}
                      onClick={(e) => {
                        e.stopPropagation()
                        toggleFav(a)
                      }}
                    >
                      <Icon name="star" />
                    </button>
                    <button
                      type="button"
                      className="mya-pending-btn"
                      data-added={inPending || undefined}
                      aria-label={inPending ? `${a.name} 已在待发送` : `把 ${a.name} 加入待发送`}
                      title={blocked || (inPending ? '已在待发送' : '加入待发送')}
                      disabled={!!blocked || inPending}
                      onClick={(e) => {
                        e.stopPropagation()
                        addToPending([a.id])
                      }}
                    >
                      {inPending ? <Icon name="square-check" /> : <Icon name="plus" />}
                    </button>
                  </div>
                  {/* 海报式：文字压在画面底部渐变上（同特效库 .fxc-poster）。名称 / 格式与规格，异常时多一行状态签 */}
                  <div className="mya-card-body">
                    {/* 状态签只在有异常时出现，单独一行；没有异常时卡片只有名称与规格两行 */}
                    {flag && (
                      <span className="mya-flag" data-tone={flag.tone} title={flag.label}>
                        <i aria-hidden="true" />
                        {flag.label}
                      </span>
                    )}
                    <div className="mya-card-name">{a.name}</div>
                    <div className="mya-card-meta">
                      <span className="mya-fmt">{assetFormatBadge(a)}</span>
                      <span className="mya-card-spec">
                        {[
                          (a.mediaType === 'video' || a.mediaType === 'audio') && a.duration != null ? formatDur(a.duration) : null,
                          cardSpec(a),
                        ].filter(Boolean).join(' · ')}
                      </span>
                      {a.demo && <span className="mya-demo">演示</span>}
                      {a.refs.length > 0 && (
                        <span
                          className="mya-refs-badge"
                          title={`被引用 ${a.refs.length} 处：${a.refs.map((r) => r.label).join('、')}`}
                          aria-label={`被引用 ${a.refs.length} 处`}
                        >
                          <Icon name="link" />
                          {a.refs.length}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="mya-list" onKeyDown={onGridKeys}>
            <div className="mya-list-head">
              <span className="mya-col-check" />
              <span className="mya-col-name">名称</span>
              <span className="mya-col-dim">时长 / 尺寸</span>
              <span className="mya-col-size">大小</span>
              <span className="mya-col-src">来源</span>
              <span className="mya-col-lic">授权</span>
              <span className="mya-col-rev">审核</span>
              <span className="mya-col-refs">引用</span>
              <span className="mya-col-acts"><span className="mya-sr">操作</span></span>
            </div>
            {visible.map((a) => {
              const inPending = pending.has(a.id)
              const blocked = assetUseBlock(a)
              const isFav = a.tags.includes('★')
              return (
                <div
                  key={a.id}
                  className="mya-row"
                  data-on={detailId === a.id || undefined}
                  data-picked={selected.has(a.id) || undefined}
                  data-pending={inPending || undefined}
                  role="group"
                  aria-label={`${a.name}${selected.has(a.id) ? '，已选择' : ''}`}
                  tabIndex={0}
                  draggable={!blocked}
                  onDragStart={(e) => {
                    const ids = selected.has(a.id) && selected.size > 1 ? [...selected] : [a.id]
                    setAssetDragData(e.dataTransfer, ids)
                    const ghostEl = setDragGhost({
                      thumb: thumbs[a.id],
                      label: a.name,
                      count: ids.length,
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
                      if (pickMode) toggleSelect(a.id)
                      else openDetail(a)
                    }
                  }}
                >
                  <span
                    className="mya-col-check"
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => e.stopPropagation()}
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(a.id)}
                      onChange={() => toggleSelect(a.id)}
                      aria-label={`选择 ${a.name}`}
                    />
                  </span>
                  <span className="mya-col-name">
                    <span className="mya-row-thumb" data-media={a.mediaType} data-alpha={mayHaveAlpha(a) || undefined}>
                      {thumbs[a.id] ? (
                        <AssetImageThumb key={thumbs[a.id]} src={thumbs[a.id]} />
                      ) : (
                        <Icon name={MEDIA_ICON[a.mediaType]} />
                      )}
                    </span>
                    <span className="mya-row-text">
                      <span className="mya-row-name" title={a.name}>{a.name}</span>
                      <span className="mya-row-sub">
                        <span className="mya-fmt">{assetFormatBadge(a)}</span>
                        {a.demo && <span className="mya-demo">演示</span>}
                        {blocked && <span className="mya-row-note">{blocked}</span>}
                      </span>
                    </span>
                    {isFav && <Icon name="star" className="mya-row-star" />}
                  </span>
                  <span className="mya-col-dim num">{listSpec(a)}</span>
                  <span className="mya-col-size num">{formatBytes(a.sizeBytes)}</span>
                  <span className="mya-col-src">{SOURCE_LABEL[a.sourceType]}</span>
                  <span className="mya-col-lic">
                    <span className="mya-cell-state" data-tone={licenseTone(a.licenseStatus) ?? undefined}>
                      {LICENSE_LABEL[a.licenseStatus]}
                    </span>
                  </span>
                  <span className="mya-col-rev">
                    <span className="mya-cell-state" data-tone={reviewTone(a.reviewStatus) ?? undefined}>
                      {REVIEW_LABEL[a.reviewStatus]}
                    </span>
                  </span>
                  <span
                    className="mya-col-refs num"
                    title={a.refs.length > 0 ? a.refs.map((r) => r.label).join('、') : undefined}
                  >
                    {a.refs.length > 0 ? a.refs.length : '—'}
                  </span>
                  <span className="mya-col-acts" onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      className="mya-row-actbtn"
                      data-added={inPending || undefined}
                      title={blocked || (inPending ? '已在待发送' : '加入待发送')}
                      disabled={!!blocked || inPending}
                      aria-label={inPending ? `${a.name} 已在待发送` : `把 ${a.name} 加入待发送`}
                      onClick={() => addToPending([a.id])}
                    >
                      <Icon name={inPending ? 'square-check' : 'plus'} />
                    </button>
                    <button
                      type="button"
                      className="mya-row-actbtn"
                      data-on={isFav || undefined}
                      title={isFav ? '取消收藏' : '收藏'}
                      aria-label={isFav ? `取消收藏 ${a.name}` : `收藏 ${a.name}`}
                      onClick={() => toggleFav(a)}
                    >
                      <Icon name="star" />
                    </button>
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </main>
  )
}
