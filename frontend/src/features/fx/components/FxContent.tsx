import type * as React from 'react'
import { EmptyState } from '@/shared/components/fm/EmptyState'
import { originalSceneLoader } from '@/features/fx/components/fxOriginalRegistry'
import { setAssetDragData } from '@/features/assets/hooks/usePendingAssets'
import { setDragGhost, clearDragGhost } from '@/shared/pick-mode/dragGhost'
import { SilentVideoPreview } from '@/shared/components/SilentVideoPreview'
import { FxPreviewBoundary, FxOriginalWavesPreview } from '@/features/fx/components/FxPreview'
import { Suspense } from 'react'
import { PickCheck } from '@/shared/pick-mode/PickModeUI'
import { UiIcon, SemIcons } from '@/shared/icons/UiIcon'
import { Star01 } from '@untitledui/icons'
import { categoryLabel, execLabel } from '@/features/fx/model/fxFilters'
import type { FxTechnique } from '@/features/fx/model/fxTechniques'
import type { FxLibState, Scope } from '@/features/fx/FxLibrary'
import type { PickMode } from '@/shared/pick-mode/usePickMode'

export interface FxContentProps {
  activeCount: number
  addFxToPending: (list: FxTechnique[]) => void
  catalogError: string | null
  catalogLoading: boolean
  drawerOpen: boolean
  focusedPreviewId: string | null
  fxInPending: (id: string) => boolean
  hoveredPreviewId: string | null
  lib: FxLibState
  openDrawer: (id: string) => void
  originalPosters: Record<string, { file: string; frame: number; frameSource: string; checksum: string }>
  pick: PickMode
  query: string
  resetAll: () => void
  scope: Scope
  setFocusedPreviewId: React.Dispatch<React.SetStateAction<string | null>>
  setHoveredPreviewId: React.Dispatch<React.SetStateAction<string | null>>
  setScope: React.Dispatch<React.SetStateAction<Scope>>
  sorted: FxTechnique[]
  stashFxCard: (t: FxTechnique) => void
  toggleFavorite: (id: string) => void
  uniformExec: boolean
  visible: FxTechnique[]
  workflowFor: FxTechnique | null
}

/** 从 FxLibrary.tsx 原样拆出的界面区块；props 与原处的变量同名。 */
export function FxContent({ activeCount, addFxToPending, catalogError, catalogLoading, drawerOpen, focusedPreviewId, fxInPending, hoveredPreviewId, lib, openDrawer, originalPosters, pick, query, resetAll, scope, setFocusedPreviewId, setHoveredPreviewId, setScope, sorted, stashFxCard, toggleFavorite, uniformExec, visible, workflowFor }: FxContentProps) {
  return (
    <div className="fx-content">
      {catalogLoading ? (
        /* 加载中与「没有技法」必须分开：技法目录来自服务端，
           还没读到时显示「空的」会让用户以为库是空的。 */
        <EmptyState icon="loader" title="正在读取技法库" body="从本地服务读取技法目录…" />
      ) : catalogError ? (
        <EmptyState
          icon="alert-triangle"
          title="技法库读取失败"
          body={catalogError}
        />
      ) : visible.length === 0 ? (
        scope === 'favorites' && !query && activeCount === 0 ? (
          <EmptyState
            icon="star"
            title="还没有收藏的技法"
            body="在卡片或详情里点星标，常用的技法会收进这里。"
            action={{ label: '去看全部技法', onClick: () => setScope('all') }}
          />
        ) : scope === 'recent' && !query && activeCount === 0 ? (
          <EmptyState
            icon="film"
            title="还没有最近使用"
            body="打开任意技法的详情，它就会出现在这里。"
            action={{ label: '去看全部技法', onClick: () => setScope('all') }}
          />
        ) : (
          <EmptyState
            icon="search"
            title="没有匹配的技法"
            body="换个词，或清除分类 / 状态 / 输入 / 实现 / 复杂度筛选。"
            action={{ label: '清除搜索与筛选', onClick: resetAll }}
          />
        )
      ) : (
        <div className="fx-grid">
          {sorted.map((t) => {
            const fav = lib.favorites.includes(t.id)
            const hasOriginal = Boolean(originalSceneLoader(t.sourceProject, t.sourcePath))
            const previewActive = !drawerOpen && !workflowFor && (focusedPreviewId ?? hoveredPreviewId) === t.id
            const originalPoster = hasOriginal && t.sourcePath ? originalPosters[t.sourcePath] : undefined
            const poster = originalPoster && /^[a-f0-9]{20}\.jpg$/.test(originalPoster.file)
              ? `${import.meta.env.BASE_URL}fx-original-posters/${originalPoster.file}?v=${encodeURIComponent(originalPoster.checksum || '')}` : t.previewImage
            return (
              <article
                key={t.id}
                className="fxc fxc-poster"
                data-fx-id={t.id}
                data-original={hasOriginal || undefined}
                data-preview-active={(previewActive && (hasOriginal || Boolean(t.previewVideo))) || undefined}
                data-added={fxInPending(t.id) || undefined}
                data-pickmode={pick.active || undefined}
                data-picked={(pick.active && pick.has(t.id)) || undefined}
                onPointerEnter={(event) => { if (event.pointerType === 'mouse') setHoveredPreviewId(t.id) }}
                onPointerLeave={() => setHoveredPreviewId((id) => id === t.id ? null : id)}
                onFocusCapture={() => setFocusedPreviewId(t.id)}
                onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocusedPreviewId((id) => id === t.id ? null : id) }}
                draggable={!pick.active}
                onDragStart={(e) => {
                  /* 与素材库/参考片库同一套：同一个 DataTransfer 类型，
                     待发送那边不用改就能接住；拖动时把整卡快照换成 56px 小块，
                     否则卡片举在鼠标边会盖住落点。 */
                  stashFxCard(t)
                  setAssetDragData(e.dataTransfer, [t.id])
                  const ghostEl = setDragGhost({
                    thumb: t.previewImage,
                    label: t.name,
                    count: 1,
                  })
                  e.dataTransfer.setDragImage(ghostEl, 28, 28)
                }}
                onDragEnd={clearDragGhost}
              >
                <div className="fxc-media" data-original-preview={hasOriginal || undefined}>
                  <SilentVideoPreview src={t.previewVideo} poster={poster}
                    active={previewActive}
                    mountOnlyWhenActive showFailure label={`${t.name} 动态预览`} />
                  {hasOriginal && previewActive && t.sourcePath && t.sourceProject && (
                    <FxPreviewBoundary>
                      <Suspense fallback={<span className="fxc-media-empty">正在加载…</span>}>
                        <FxOriginalWavesPreview sourceProject={t.sourceProject} sourcePath={t.sourcePath} playing={previewActive} />
                      </Suspense>
                    </FxPreviewBoundary>
                  )}
                  {!poster && !t.previewVideo && !previewActive && (
                    <span className="fxc-media-empty"><span>暂无预览</span></span>
                  )}
                  {pick.active && <PickCheck checked={pick.has(t.id)} />}
                  {t.previewVideo && <span className="fxc-preview-label"><UiIcon icon={SemIcons.play} size="xs" aria-hidden="true" />动态预览</span>}
                  {/* 加入待发送：与素材库/参考片库同一位置、同一规格 */}
                  {!pick.active && <button
                    type="button"
                    className="fxc-add"
                    data-added={fxInPending(t.id) || undefined}
                    aria-label={fxInPending(t.id) ? `${t.name} 已在待发送` : `把 ${t.name} 加入待发送`}
                    title={fxInPending(t.id) ? '已在待发送' : '加入待发送'}
                    onClick={(e) => { e.stopPropagation(); addFxToPending([t]) }}
                  >
                    {fxInPending(t.id) ? <UiIcon icon={SemIcons.check} size="sm" /> : <UiIcon icon={SemIcons.plus} size="sm" />}
                  </button>}
                  <button
                    type="button"
                    className="fxc-fav"
                    data-on={fav ? '' : undefined}
                    aria-pressed={fav}
                    aria-label={fav ? `取消收藏 ${t.name}` : `收藏 ${t.name}`}
                    onClick={() => toggleFavorite(t.id)}
                  >
                    <UiIcon icon={Star01} size="sm" fill={fav ? 'currentColor' : 'none'} />
                  </button>
                </div>
                {/* 覆盖层只负责"点开详情"。它是 <button> 且铺满整卡，
                    从它上面起手拖拽时，浏览器会把"这个按钮"当成拖拽源，
                    卡片上的 onDragStart 永远不触发 —— 拖拽因而失效。
                    关掉它自身的可拖性，让拖拽落到父级 article 上。 */}
                <button type="button" className="fxc-hit" draggable={false}
                        aria-label={pick.active ? `${pick.has(t.id) ? '取消选择' : '选择'} ${t.name}` : `查看技法：${t.name}`}
                        onClick={() => { if (pick.active) pick.toggle(t.id); else openDrawer(t.id) }} />
                <div className="fxc-body">
                  <span className="fxc-category">{categoryLabel(t.category)}</span>
                  <h3 className="fxc-title">{t.name}</h3>
                  <p className="fxc-intent">{t.intent}</p>
                  <div className="fxc-meta">
                    {!uniformExec && <span>{execLabel(t.execType)}</span>}
                    {t.inputLabels.length > 0 && <span className="fxc-inputs">{t.inputLabels.join(' / ')}</span>}
                  </div>
                </div>
              </article>
            )
          })}
        </div>
      )}
    </div>
  )
}
