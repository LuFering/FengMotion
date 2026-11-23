import type * as React from 'react'
import { EmptyState } from '@/shared/components/fm/EmptyState'
import { LoadingState } from '@/shared/components/fm/LoadingState'
import { originalSceneLoader } from '@/features/fx/components/fxOriginalRegistry'
import { setAssetDragData } from '@/features/assets/hooks/usePendingAssets'
import { setDragGhost, clearDragGhost } from '@/shared/pick-mode/dragGhost'
import { SilentVideoPreview } from '@/shared/components/SilentVideoPreview'
import { FxPreviewBoundary, FxOriginalWavesPreview } from '@/features/fx/components/FxPreview'
import { Suspense, useEffect, useRef } from 'react'
import { PickCheck } from '@/shared/pick-mode/PickModeUI'
import { UiIcon, SemIcons } from '@/shared/icons/UiIcon'
import { Star01 } from '@untitledui/icons'
import { categoryLabel, execLabel } from '@/features/fx/model/fxFilters'
import { sourceCategory } from '@/features/fx/model/fxDisplay'
import { resolvePoster } from '@/features/fx/components/fxPoster'
import type { FxGroup } from '@/features/fx/model/fxDisplay'
import type { FxTechnique } from '@/features/fx/model/fxTechniques'
import type { FxLibState, Scope } from '@/features/fx/model/fxLibraryStore'
import type { PickMode } from '@/shared/pick-mode/usePickMode'

export interface FxContentProps {
  activeCount: number
  addFxToPending: (list: FxTechnique[]) => void
  catalogError: string | null
  catalogLoading: boolean
  drawerOpen: boolean
  focusedPreviewId: string | null
  /** 范围、分类、来源、排序、搜索任一变化时换值：列表回到顶部，不停在上一份结果的中段 */
  scrollKey: string
  /** 「按分类」时的分段；null 表示不分组，直接用 sorted */
  groups: FxGroup[] | null
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

/** 技法库的主内容区：读取中/失败/空状态，以及技法卡片网格（悬停预览、收藏、加入待发送、拖拽与多选）。 */
export function FxContent({ activeCount, addFxToPending, catalogError, catalogLoading, drawerOpen, focusedPreviewId, groups, scrollKey, fxInPending, hoveredPreviewId, lib, openDrawer, originalPosters, pick, query, resetAll, scope, setFocusedPreviewId, setHoveredPreviewId, setScope, sorted, stashFxCard, toggleFavorite, uniformExec, visible, workflowFor }: FxContentProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  useEffect(() => { scrollRef.current?.scrollTo({ top: 0 }) }, [scrollKey])
  return (
    <div className="fx-content" ref={scrollRef}>
      {catalogLoading ? (
        /* 加载中与「没有技法」必须分开：技法目录来自服务端，
           还没读到时显示「空的」会让用户以为库是空的。 */
        <div className="fx-loading"><LoadingState rows={10} /></div>
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
            body="换个关键词，或清除筛选条件。"
            action={{ label: '清除搜索与筛选', onClick: resetAll }}
          />
        )
      ) : (
        groups ? (
          /* 按分类分段：段标题吸顶，滚到哪一段一眼可见（契约 §6） */
          <div className="fx-groups">
            {groups.map((g) => (
              <section key={g.id} className="fx-group" aria-label={`${g.label}，${g.items.length} 项`}>
                <h2 className="fx-group-head">{g.label}<em>{g.items.length}</em></h2>
                <div className="fx-grid">{g.items.map(renderCard)}</div>
              </section>
            ))}
          </div>
        ) : (
          <div className="fx-grid">{sorted.map(renderCard)}</div>
        )
      )}
    </div>
  )

  /* 函数声明会提升，放在 return 之后只是为了让上面的结构先读到 */
  function renderCard(t: FxTechnique) {
            const fav = lib.favorites.includes(t.id)
            const hasOriginal = Boolean(originalSceneLoader(t.sourceProject, t.sourcePath))
            const previewActive = !drawerOpen && !workflowFor && (focusedPreviewId ?? hoveredPreviewId) === t.id
            const poster = resolvePoster(t, originalPosters)
            const subCategory = sourceCategory(t)
            const intent = t.intent?.trim()
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
                    thumb: poster,
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
                  {/* 首行：中文分类 · 来源分类（来源分类与中文相同或为空时不写）。
                      分组模式下段标题已写了分类，来源分类（ThemeAnimations…）同一段里几乎都一样，
                      不再占一行，只留在详情技术细节里（打磨方案 §3.9） */}
                  {groups ? null : (
                    <span className="fxc-category">
                      {categoryLabel(t.category)}
                      {subCategory && <span className="fxc-subcat">· {subCategory}</span>}
                    </span>
                  )}
                  <h3 className="fxc-title" title={t.name}>{t.name}</h3>
                  {/* 来源没给用途就不显示这一行，不补默认文案 */}
                  {intent && <p className="fxc-intent">{intent}</p>}
                  {(!uniformExec || t.inputLabels.length > 0) && (
                    <div className="fxc-meta">
                      {!uniformExec && <span>{execLabel(t.execType)}</span>}
                      {t.inputLabels.length > 0 && <span className="fxc-inputs">{t.inputLabels.join(' / ')}</span>}
                    </div>
                  )}
                </div>
              </article>
            )
  }
}
