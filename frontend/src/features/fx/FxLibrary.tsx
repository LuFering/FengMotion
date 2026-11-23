import '@/features/fx/styles/technique/page-chrome.css'
import { useEffect, useRef, useState } from 'react'
import { UiIcon, SemIcons } from '@/shared/icons/UiIcon'
import { Clock, Star01 } from '@untitledui/icons'
import { type FxCategory, type FxExecType, type FxImpl, type FxInputKind, type FxTechnique } from '@/features/fx/model/fxTechniques'
import { listTechniques } from '@/features/fx/services/fxApiService'
import { STAGE_LABEL, type ProjectSummary } from '@/features/project/model/projects'
import { usePendingAssets } from '@/features/assets/hooks/usePendingAssets'
import { usePickMode } from '@/shared/pick-mode/usePickMode'
import { PickBar, PickButton } from '@/shared/pick-mode/PickModeUI'
import { Dialog, DialogContent, DialogTitle } from '@/shared/ui/dialog'
import { CapabilityImportDialog } from '@/features/fx/components/CapabilityImportDialog'
import { FxDetailDialog } from '@/features/fx/components/FxDetailDialog'
import { groupByCategory } from '@/features/fx/model/fxDisplay'
import { FxContent } from '@/features/fx/components/FxContent'
import { FxMetaBar } from '@/features/fx/components/FxMetaBar'
import { type SortKey, type Scope, type FxLibState, EMPTY_TECHNIQUES, loadLibState } from '@/features/fx/model/fxLibraryStore'
import { useFxRecipeActions } from '@/features/fx/hooks/useFxRecipeActions'
import { useFxShortcuts } from '@/features/fx/hooks/useFxShortcuts'
import { useFxDrawer } from '@/features/fx/hooks/useFxDrawer'
import { useFilterReset } from '@/features/fx/hooks/useFilterReset'
import { useFxFilteredList } from '@/features/fx/hooks/useFxFilteredList'
import { useSemanticSearch } from '@/features/fx/hooks/useSemanticSearch'
import { useFxFavorites } from '@/features/fx/hooks/useFxFavorites'
import { useFxCatalogLoad } from '@/features/fx/hooks/useFxCatalogLoad'
import { useFxPending } from '@/features/fx/hooks/useFxPending'
import { useOriginalPosters } from '@/features/fx/hooks/useOriginalPosters'

export interface FxLibraryProps {
  /** 「用于工作流」的目标项目：来自 GET /projects（App 的 useProjects），不读演示常量 PROJECTS（契约 §7） */
  projects?: { list: ProjectSummary[]; loading: boolean; error: string | null }
}

export function FxLibrary({ projects }: FxLibraryProps = {}) {
  const [query, setQuery] = useState('')
  const [sourceFilter, setSourceFilter] = useState('')
  const [scope, setScope] = useState<Scope>('all')
  const [cat, setCat] = useState<FxCategory | 'all'>('all')
  const [exec, setExec] = useState<FxExecType | 'all'>('all')
  const [inputKind, setInputKind] = useState<FxInputKind | 'all'>('all')
  const [impl, setImpl] = useState<FxImpl | 'all'>('all')
  const [maxComplexity, setMaxComplexity] = useState(5)
  const [previewKind, setPreviewKind] = useState<'all' | 'motion' | 'still'>('all')
  const [sort, setSort] = useState<SortKey>('cat')
  const [filtersOpen, setFiltersOpen] = useState(false)
  /* 「从 GitHub 导入技能」弹窗。入口是页头的一个按钮，不常驻任何内容。 */
  const [importOpen, setImportOpen] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [playingId, setPlayingId] = useState<string | null>(null)
  const [hoveredPreviewId, setHoveredPreviewId] = useState<string | null>(null)
  const [focusedPreviewId, setFocusedPreviewId] = useState<string | null>(null)
  const [originalPosters, setOriginalPosters] = useState<Record<string, { file: string; frame: number; frameSource: string; checksum: string }>>({})
  useOriginalPosters({ setOriginalPosters })
  const pick = usePickMode()
  const pendingStore = usePendingAssets()
  const fxInPending = (id: string) => pendingStore.has(id)

  /* 特效 → 待发送条目。特效不是文件，带过去的是「做法」本身：
     分类、用途、实现方式、复杂度。这些正是 AI 照着复现所需的最小信息。
     只丢一个名字过去，等于让 AI 重新猜一遍。 */
  const { addFxToPending, stashFxCard } = useFxPending({ pendingStore })
  const [copied, setCopied] = useState<'idle' | 'ok' | 'fail'>('idle')
  const [workflowFor, setWorkflowFor] = useState<FxTechnique | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [lib, setLib] = useState<FxLibState>(loadLibState)
  /* 技法目录与用户状态都来自服务端（原先是静态常量 + localStorage）。
     分开两个 state：目录加载失败时，界面仍可以显示「读取失败」而不是把
     收藏也一起清空。 */
  const [techniques, setTechniques] = useState<FxTechnique[]>(EMPTY_TECHNIQUES)
  const [catalogError, setCatalogError] = useState<string | null>(null)
  const [catalogLoading, setCatalogLoading] = useState(true)
  /* 语义检索给出的候选排序。null 表示「还没查过或查询为空」，
     此时沿用原本的目录顺序；空数组表示「查过但没有语义命中」。 */
  const [semanticOrder, setSemanticOrder] = useState<string[] | null>(null)
  /* 检索状态：只有 degraded 为 true 时才需要在界面上说明「这是字面匹配」。 */
  const [semanticNote, setSemanticNote] = useState<{ degraded: boolean; reason?: string } | null>(null)

  const searchRef = useRef<HTMLInputElement>(null)
  const modalRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const copyTimer = useRef<number | null>(null)
  const toastTimer = useRef<number | null>(null)

  /* 首次加载：拉技法目录与用户状态。
     旧版收藏存在 localStorage，先批量推到服务端再清空本地标记 ——
     用户收藏过的技法不该因为换存储而消失。 */
  useFxCatalogLoad({ setCatalogError, setCatalogLoading, setLib, setTechniques })

  function showToast(msg: string) {
    setToast(msg)
    if (toastTimer.current) window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), 2600)
  }

  /**
   * 切换收藏。
   *
   * 以服务端返回为准而不是本地取反：多开窗口时，另一边可能已经改过。
   * 失败时不假装成功 —— 界面保持原状并提示。
   */
  const { pushRecent, toggleFavorite } = useFxFavorites({ lib, setLib, showToast })

  /* 语义检索：查询变化后延迟发起，避免每敲一个字都打一次接口。
     结果只用来排序，不做过滤 —— 过滤仍由下面的分面逻辑负责，
     否则「搜索一次就丢掉了分类/复杂度等筛选」会让人莫名其妙。 */
  useSemanticSearch({ query, setSemanticNote, setSemanticOrder })

  /** 只应用搜索：分类/范围的计数不受其它分面影响，避免数字塌陷 */
  const { current, searched, counts, activeCount, sources, visible, sorted, uniformExec } = useFxFilteredList({ cat, exec, impl, inputKind, lib, maxComplexity, previewKind, query, scope, selectedId, semanticOrder, sort, sourceFilter, techniques })

  const playing = current !== null && playingId === current.id
  /* 墙的实际顺序：按分类且未限定分类时分段，详情的上一条/下一条也走这个顺序 */
  const groups = sort === 'cat' && cat === 'all' ? groupByCategory(sorted) : null
  const wall = groups ? groups.flatMap((g) => g.items) : sorted
  const { clearFilters, resetAll } = useFilterReset({ setCat, setExec, setImpl, setInputKind, setMaxComplexity, setPreviewKind, setQuery, setScope, setSourceFilter })

  const { openDrawer, closeDrawer } = useFxDrawer({ closeRef, drawerOpen, pushRecent, selectedId, setDrawerOpen, setSelectedId })

  useEffect(() => {
    return () => {
      if (copyTimer.current) window.clearTimeout(copyTimer.current)
      if (toastTimer.current) window.clearTimeout(toastTimer.current)
    }
  }, [])

  /** / 聚焦搜索；Esc 清搜索。抽屉打开时交给抽屉自己的键盘处理 */
  useFxShortcuts({ drawerOpen, filtersOpen, query, searchRef, setFiltersOpen, setQuery })

  const { copyRecipe, recordWorkflowIntent } = useFxRecipeActions({ copyTimer, current, setCopied, setWorkflowFor, showToast, workflowFor })

  const ALL_SCOPES: Array<{ id: Scope; label: string; count: number; icon: React.ReactNode }> = [
    { id: 'all', label: '全部', count: searched.length, icon: null },
    { id: 'featured', label: '精选', count: counts.featured, icon: null },
    { id: 'favorites', label: '收藏', count: counts.favorites, icon: <UiIcon icon={Star01} size="xs" aria-hidden="true" /> },
    { id: 'recent', label: '最近使用', count: counts.recent, icon: <UiIcon icon={Clock} size="xs" aria-hidden="true" /> },
  ]
  /* 「精选」为 0 时只会通向空页，未选中就不显示；收藏/最近有空态引导，保留。 */
  const SCOPES = ALL_SCOPES.filter((s) => s.id !== 'featured' || s.count > 0 || scope === 'featured')

  return (
    <div className="fxlib">
      <CapabilityImportDialog open={importOpen} onOpenChange={setImportOpen} onImported={() => {
        void listTechniques().then((list) => { setTechniques(list); setCatalogError(null) })
          .catch(() => setCatalogError('刷新技法库失败'))
      }} />
      <section className="fx-panel" aria-label="特效库" inert={drawerOpen || workflowFor ? true : undefined}>
        <div className="fx-cmd">
          <div className="fx-heading-group"><h1 className="fx-cmd-title">特效库</h1></div>
          {!pick.active && <PickButton onClick={pick.enter} label="特效" />}
          {/* 入口：粘贴 GitHub 仓库地址，识别其中的技能后导入。 */}
          <button type="button" className="fx-toolbtn" onClick={() => setImportOpen(true)}>导入来源</button>
        </div>

        {/* 去 AI 味：整行图例删除——组件不再解释自己；能力与复杂度直接写进卡片元信息行 */}
        <FxMetaBar
          SCOPES={SCOPES}
          activeCount={activeCount}
          cat={cat}
          clearFilters={clearFilters}
          counts={counts}
          exec={exec}
          filtersOpen={filtersOpen}
          impl={impl}
          inputKind={inputKind}
          maxComplexity={maxComplexity}
          previewKind={previewKind}
          query={query}
          scope={scope}
          searchRef={searchRef}
          searched={searched}
          semanticNote={semanticNote}
          setCat={setCat}
          setExec={setExec}
          setFiltersOpen={setFiltersOpen}
          setImpl={setImpl}
          setInputKind={setInputKind}
          setMaxComplexity={setMaxComplexity}
          setPreviewKind={setPreviewKind}
          setQuery={setQuery}
          setScope={setScope}
          setSort={setSort}
          setSourceFilter={setSourceFilter}
          sort={sort}
          sourceFilter={sourceFilter}
          sources={sources}
          visible={visible}
        />

        <FxContent
          activeCount={activeCount}
          addFxToPending={addFxToPending}
          catalogError={catalogError}
          catalogLoading={catalogLoading}
          drawerOpen={drawerOpen}
          focusedPreviewId={focusedPreviewId}
          groups={groups}
          scrollKey={[scope, cat, sourceFilter, sort, query.trim(), exec, impl, inputKind, maxComplexity, previewKind].join('|')}
          fxInPending={fxInPending}
          hoveredPreviewId={hoveredPreviewId}
          lib={lib}
          openDrawer={openDrawer}
          originalPosters={originalPosters}
          pick={pick}
          query={query}
          resetAll={resetAll}
          scope={scope}
          setFocusedPreviewId={setFocusedPreviewId}
          setHoveredPreviewId={setHoveredPreviewId}
          setScope={setScope}
          sorted={sorted}
          stashFxCard={stashFxCard}
          toggleFavorite={toggleFavorite}
          uniformExec={uniformExec}
          visible={visible}
          workflowFor={workflowFor}
        />

        {pick.active && (
          <PickBar
            count={pick.selected.size}
            total={sorted.length}
            noun="个特效"
            onSelectAll={() => pick.selectAll(sorted.map((x) => x.id))}
            onCancel={pick.exit}
            onConfirm={() => pick.confirm((ids) => {
              const list = ids.map((id) => techniques.find((x) => x.id === id)).filter((x): x is FxTechnique => !!x)
              addFxToPending(list)
            })}
          />
        )}
      </section>

      {/* ── 详情弹窗：预览 → 用途 → 实现方法 → 参数 → 调用方式 ──
          用项目统一的 Dialog（radix）而不是自绘抽屉：遮罩、焦点陷阱、
          Esc 关闭、滚动锁定都由组件负责，样式与「导入来源」等弹窗一致。 */}
      <Dialog open={drawerOpen && !!current} onOpenChange={(o) => { if (!o) closeDrawer() }}>
        <FxDetailDialog
          addFxToPending={addFxToPending}
          fxInPending={fxInPending}
          wall={wall}
          closeDrawer={closeDrawer}
          closeRef={closeRef}
          copied={copied}
          copyRecipe={copyRecipe}
          current={current}
          lib={lib}
          modalRef={modalRef}
          openDrawer={openDrawer}
          originalPosters={originalPosters}
          playing={playing}
          setPlayingId={setPlayingId}
          setWorkflowFor={setWorkflowFor}
          techniques={techniques}
          toggleFavorite={toggleFavorite}
        />
      </Dialog>

      {/* ── 用于工作流：目标选择（调用链未接入，只记意向） ── */}
      {/* 原先是自绘弹窗，JSX 类名（fx-scrim-center / fx-dialog-item…）在样式表里不存在，
          弹窗成了页面里的普通块，把墙挤窄；列表还读演示常量 PROJECTS。
          现在走共享 Dialog（遮罩、焦点、Esc 与详情一致），项目来自 GET /projects。 */}
      <Dialog open={!!workflowFor} onOpenChange={(o) => { if (!o) setWorkflowFor(null) }}>
        <DialogContent className="fx-wf" showCloseButton={false} aria-describedby="fx-wf-note">
          {workflowFor && (
            <>
              <div className="fx-wf-head">
                <DialogTitle className="fx-wf-title">用于工作流</DialogTitle>
                <p className="fx-wf-sub">把「{workflowFor.name}」记入哪个项目</p>
                <button type="button" className="fx-wf-close" onClick={() => setWorkflowFor(null)} aria-label="关闭" title="关闭（Esc）">
                  <UiIcon icon={SemIcons.close} size="sm" aria-hidden="true" />
                </button>
              </div>
              <p id="fx-wf-note" className="fx-wf-note">
                <UiIcon icon={SemIcons.info} size="xs" aria-hidden="true" />
                调用链未接入，只记入本地意向清单，不会执行。
              </p>
              {projects?.loading ? (
                <p className="fx-wf-empty" role="status">正在读取项目…</p>
              ) : projects?.error ? (
                <p className="fx-wf-empty" role="alert">项目读取失败：{projects.error}</p>
              ) : !projects || projects.list.length === 0 ? (
                <p className="fx-wf-empty">还没有项目，先在首页新建一个。</p>
              ) : (
                <ul className="fx-wf-list">
                  {projects.list.map((p) => (
                    <li key={p.id}>
                      <button type="button" className="fx-wf-item" onClick={() => recordWorkflowIntent(p.id, p.name)}>
                        <span className="fx-wf-mark" aria-hidden="true">{p.name.trim().slice(0, 1).toUpperCase() || '·'}</span>
                        <span className="fx-wf-name">{p.name}</span>
                        <span className="fx-wf-stage">{STAGE_LABEL[p.stage] ?? ''}</span>
                        <UiIcon icon={SemIcons.expand} size="xs" aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>

      {toast && (
        <div className="fx-toast" role="status">
          {toast}
        </div>
      )}
    </div>
  )
}
