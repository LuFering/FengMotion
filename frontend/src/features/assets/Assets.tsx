import { useRef, useState } from 'react'
import { type MediaType, type MyAsset } from '@/features/assets/model/myAssets'
import { type FolderRow } from '@/features/assets/services/assetApiService'
import { type MigrationReport } from '@/features/assets/services/assetMigration'
import { Icon } from '@/features/assets/components/AssetIcon'
import { type SortKey } from '@/features/assets/model/assetDisplay'
import { AssetInspector } from '@/features/assets/components/AssetInspector'
import { AssetCanvas } from '@/features/assets/components/AssetCanvas'
import { AssetsToolbar } from '@/features/assets/components/AssetsToolbar'
import './styles/myassets/library.css'
import './styles/myassets/library-polish.css'
import { AssetsHeader } from '@/features/assets/components/AssetsHeader'
import { type NodeId, type ProjectOption, type TreeEntry, nodeLabel } from '@/features/assets/model/assetTree'
import { useAssetActions } from '@/features/assets/hooks/useAssetActions'
import { useAssetImport } from '@/features/assets/hooks/useAssetImport'
import { useAssetMigration } from '@/features/assets/hooks/useAssetMigration'
import { useAssetCollections } from '@/features/assets/hooks/useAssetCollections'
import { useAssetEscape } from '@/features/assets/hooks/useAssetEscape'
import { useAssetThumbs } from '@/features/assets/hooks/useAssetThumbs'
import { useAssetLoad } from '@/features/assets/hooks/useAssetLoad'
import { useAssetPendingPick } from '@/features/assets/hooks/useAssetPendingPick'
import { AssetsOrgPanel } from '@/features/assets/components/AssetsOrgPanel'

const NO_PROJECTS: ProjectOption[] = []

/**
 * @param projects         项目列表（来自项目接口），用于「项目」分组与移至项目
 * @param currentProjectId 从项目里打开时的当前项目；默认就停在这个项目的分类上
 */
export function Assets({ projects = NO_PROJECTS, currentProjectId = null }: {
  projects?: ProjectOption[]
  currentProjectId?: string | null
} = {}) {
  const [assets, setAssets] = useState<MyAsset[]>([])
  const [folders, setFolders] = useState<FolderRow[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [legacyPending, setLegacyPending] = useState(false)
  const [migration, setMigration] = useState<MigrationReport | null>(null)
  const [migrating, setMigrating] = useState(false)
  const [migrationDone, setMigrationDone] = useState(0)
  const [loadVersion, setLoadVersion] = useState(0)
  const [node, setNode] = useState<NodeId>(() => (currentProjectId ? `proj:${currentProjectId}` : 'all'))
  const [typeFilter, setTypeFilter] = useState<MediaType | 'all'>('all')
  const [pop, setPop] = useState<'type' | 'sort' | null>(null)
  const [orgOpen, setOrgOpen] = useState(() => window.innerWidth > 1100)
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('recent')
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [detailId, setDetailId] = useState<string | null>(null)
  const [hoveredVideo, setHoveredVideo] = useState<string | null>(null)
  const [thumbs, setThumbs] = useState<Record<string, string>>({})
  const [renaming, setRenaming] = useState<MyAsset | null>(null)
  const [tagText, setTagText] = useState('')
  const [dockPop, setDockPop] = useState<'folder' | 'project' | 'tag' | 'delete' | null>(null)
  const [dockTagText, setDockTagText] = useState('')

  const { setPickMode, enterPick, pickMode, addToPending, pending, exitPick, confirmPick } =
    useAssetPendingPick({ assets, selected, setDetailId, setSelected })

  const inputRef = useRef<HTMLInputElement>(null)
  const dragDepth = useRef(0)
  const ownDrag = useRef(false)

  useAssetLoad({
    loadVersion,
    setAssets,
    setFolders,
    setLegacyPending,
    setLoadError,
    setLoading,
    setMigration,
  })

  useAssetThumbs({ assets, setThumbs })

  useAssetEscape({ detailId, dockPop, setDockPop, setDetailId, setPickMode, setPop, setRenaming, setSelected })

  const { visible, counts, typeCounts, projectList, tagList, detail } = useAssetCollections({
    assets,
    detailId,
    node,
    projects,
    search,
    sortKey,
    typeFilter,
  })

  const { runMigration } = useAssetMigration({
    migrating,
    setLegacyPending,
    setLoadVersion,
    setMigrating,
    setMigration,
    setMigrationDone,
  })

  const { onPick, importing, importState, retryImport, dismissImport } = useAssetImport({ dragDepth, ownDrag, setAssets, folderId: node.startsWith('folder:') ? node.slice(7) : null, projectId: node.startsWith('proj:') ? node.slice(5) : null })

  const {
    clearFilter,
    createNewFolder,
    renameExistingFolder,
    removeExistingFolder,
    toggleFav,
    applyPatch,
    moveToFolder,
    moveToProject,
    batchAddTag,
    sendToReference,
    exportList,
    doDelete,
    onGridKeys,
    openDetail,
    toggleSelect,
    copyPath,
    doRename,
  } = useAssetActions({
    assets,
    detailId,
    renameText: '',
    renaming,
    setAssets,
    setDetailId,
    setFolders,
    setNode,
    setRenaming,
    setSearch,
    setSelected,
    setTypeFilter,
    visible,
  })

  const coreNodes: TreeEntry[] = [
    { id: 'all', label: '全部素材', icon: 'layout-grid', count: counts.all },
    { id: 'favorites', label: '收藏', icon: 'star', count: counts.favorites },
    { id: 'recent', label: '最近使用', icon: 'history', count: counts.recent },
  ]
  // 项目分组：先「未归属」，再各项目；当前项目排最前并标「当前」
  const projectNodes: TreeEntry[] = [
    { id: 'unassigned', label: '未归属', icon: 'layers', count: counts.unassigned },
    ...[...projectList]
      .sort((x, y) => (x.id === currentProjectId ? -1 : y.id === currentProjectId ? 1 : 0))
      .map((p): TreeEntry => ({
        id: `proj:${p.id}`,
        label: p.label,
        icon: 'clapperboard',
        count: p.count,
        badge: p.id === currentProjectId ? '当前' : undefined,
      })),
  ]
  const sourceNodes: TreeEntry[] = [
    { id: 'imported', label: '导入素材', icon: 'download', count: counts.imported },
    { id: 'generated', label: '生成结果', icon: 'sparkles', count: counts.generated },
    { id: 'builtin', label: '内置素材', icon: 'box', count: counts.builtin },
  ]
  const smartNodes: TreeEntry[] = [
    { id: 'review:pending', label: '待审核', icon: 'loader-circle', count: counts.pending },
    { id: 'review:needs_review', label: '需复核', icon: 'circle-alert', count: counts.needsReview },
    { id: 'license:unknown', label: '授权未知', icon: 'circle-help', count: counts.licenseUnknown },
    { id: 'license:restricted', label: '限制使用', icon: 'lock-keyhole', count: counts.restricted },
    { id: 'refs:none', label: '未被引用', icon: 'link', count: counts.refsNone },
  ]
  const activeLabel = nodeLabel(node, folders, projects)
  const countsState = loading ? 'loading' : loadError ? assets.length ? 'stale' : 'unknown' : 'ready'

  const renderNav = (t: TreeEntry) => (
    <button
      key={t.id}
      type="button"
      className="mya-org-row"
      data-on={node === t.id || undefined}
      aria-pressed={node === t.id}
      onClick={() => setNode(t.id)}
    >
      <Icon name={t.icon} />
      <span className="mya-org-label">{t.label}</span>
      {t.badge && <i className="mya-org-badge">{t.badge}</i>}
      <em>{countsState === 'loading' || countsState === 'unknown' ? '—' : t.count}</em>
    </button>
  )

  const allVisibleSelected =
    visible.length > 0 && visible.every((a) => selected.has(a.id))
  const selectedIds = [...selected]
  const selectedRefAssets = assets.filter((a) => selected.has(a.id) && a.refs.length > 0)

  const closeDock = () => {
    setDockPop(null)
    setDockTagText('')
    if (pickMode) exitPick()
    else setSelected(new Set())
  }

  return (
    <div className="mya mya-library" data-selecting={pickMode || selected.size > 0 || undefined}>
      <AssetsHeader inputRef={inputRef} search={search} setSearch={setSearch} importing={importing} />
      <input ref={inputRef} type="file" multiple hidden disabled={importing} onChange={onPick} />

      <div className="mya-body">
        {orgOpen && (
          <AssetsOrgPanel
            coreNodes={coreNodes}
            countsState={countsState}
            counts={counts}
            createNewFolder={createNewFolder}
            folders={folders}
            node={node}
            projectNodes={projectNodes}
            removeExistingFolder={removeExistingFolder}
            renameExistingFolder={renameExistingFolder}
            renderNav={renderNav}
            setNode={setNode}
            setOrgOpen={setOrgOpen}
            smartNodes={smartNodes}
            sourceNodes={sourceNodes}
            tagList={tagList}
          />
        )}

        <div className="mya-main">
          <AssetsToolbar activeLabel={activeLabel} visibleCount={visible.length} typeCounts={typeCounts}
            typeFilter={typeFilter} setTypeFilter={setTypeFilter} sortKey={sortKey} setSortKey={setSortKey}
            viewMode={viewMode} setViewMode={setViewMode} orgOpen={orgOpen} toggleOrg={() => setOrgOpen(true)}
            pickMode={pickMode} togglePick={pickMode ? exitPick : enterPick}
            hasFilter={node !== 'all' || typeFilter !== 'all' || !!search.trim()} clearFilter={clearFilter} countsState={countsState} />
          {importState && <div className="mya-import-status" role="status" data-error={importState.failed.length > 0 || undefined}>
            <Icon name={importing ? 'loader-circle' : importState.failed.length ? 'circle-alert' : 'check'} />
            <div><strong>{importing ? `正在导入 ${importState.index} / ${importState.total}` : `已入库 ${importState.done} 项${importState.failed.length ? ` · ${importState.failed.length} 项失败` : ''}`}</strong>
              {importing ? <span>{importState.name}</span> : importState.failed.length > 0 && <span>{importState.failed.map(f => `${f.name}：${f.error}`).join('；')}</span>}
            </div>
            {!importing && importState.failed.length > 0 && <button className="mya-toolbtn" onClick={retryImport}>重试失败项</button>}
            {!importing && <button className="mya-iconbtn" aria-label="关闭导入结果" onClick={dismissImport}><Icon name="x" /></button>}
          </div>}
          {(pop || dockPop) && (
            <div
              className="mya-popshade"
              onClick={() => {
                setPop(null)
                setDockPop(null)
              }}
            />
          )}

          <AssetCanvas
            addToPending={addToPending}
            assets={assets}
            clearFilter={clearFilter}
            detailId={detailId}
            hoveredVideo={hoveredVideo}
            inputRef={inputRef}
            legacyPending={legacyPending}
            loadError={loadError}
            loading={loading}
            migrating={migrating}
            migration={migration}
            migrationDone={migrationDone}
            node={node}
            scopeLabel={activeLabel}
            onGridKeys={onGridKeys}
            openDetail={openDetail}
            pending={pending}
            pickMode={pickMode}
            runMigration={runMigration}
            selected={selected}
            setHoveredVideo={setHoveredVideo}
            setLoadVersion={setLoadVersion}
            sortKey={sortKey}
            thumbs={thumbs}
            toggleFav={toggleFav}
            toggleSelect={toggleSelect}
            typeFilter={typeFilter}
            viewMode={viewMode}
            visible={visible}
          />
        </div>

        {detail && (
          <AssetInspector
            key={detail.id}
            addToPending={addToPending}
            applyPatch={applyPatch}
            copyPath={copyPath}
            detail={detail}
            doDelete={doDelete}
            doRename={doRename}
            folders={folders}
            moveToFolder={moveToFolder}
            projects={projects}
            moveToProject={moveToProject}
            pending={pending}
            sendToReference={sendToReference}
            setDetailId={(value) => { setDetailId(value); setTagText('') }}
            setTagText={setTagText}
            tagText={tagText}
            thumbs={thumbs}
            toggleFav={toggleFav}
          />
        )}
      </div>

      {/* 底部统一浮动操作坞：选择素材模式与多选批量操作合一，不顶开画布 */}
      {(pickMode || selected.size > 0) && (
        <div className="mya-pickbar" role="region" aria-label="已选素材操作">
          <span className="mya-pickbar-n">
            {selected.size > 0 ? `已选 ${selected.size} 项` : '点击卡片选择素材'}
          </span>
          <button
            type="button"
            className="mya-pickbar-all"
            onClick={() =>
              setSelected(
                allVisibleSelected ? new Set() : new Set(visible.map((a) => a.id)),
              )
            }
          >
            {allVisibleSelected ? '取消全选' : `全选当前 (${visible.length})`}
          </button>

          {selected.size > 0 && (
            <>
              <span className="mya-pickbar-sep" />
              <div className="mya-dock-wrap">
                <button
                  type="button"
                  data-on={dockPop === 'folder' || undefined}
                  onClick={() => setDockPop(dockPop === 'folder' ? null : 'folder')}
                >
                  <Icon name="folder-open" />
                  <span>移至文件夹</span>
                  <Icon name="chevron-up" />
                </button>
                {dockPop === 'folder' && (
                  <div className="mya-dock-pop" role="group" aria-label="选择目标文件夹">
                    <button
                      type="button"
                      className="mya-poprow"
                      onClick={() => {
                        moveToFolder(selectedIds, null)
                        setDockPop(null)
                      }}
                    >
                      <Icon name="layers" />
                      <span>未分类</span>
                    </button>
                    {folders.map((f) => (
                      <button
                        key={f.id}
                        type="button"
                        className="mya-poprow"
                        onClick={() => {
                          moveToFolder(selectedIds, f.id, f.name)
                          setDockPop(null)
                        }}
                      >
                        <Icon name="folder-open" />
                        <span>{f.name}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="mya-dock-wrap">
                <button
                  type="button"
                  data-on={dockPop === 'project' || undefined}
                  onClick={() => setDockPop(dockPop === 'project' ? null : 'project')}
                >
                  <Icon name="clapperboard" />
                  <span>移至项目</span>
                  <Icon name="chevron-up" />
                </button>
                {dockPop === 'project' && (
                  <div className="mya-dock-pop" role="group" aria-label="选择目标项目">
                    <button
                      type="button"
                      className="mya-poprow"
                      onClick={() => {
                        moveToProject(selectedIds, null)
                        setDockPop(null)
                      }}
                    >
                      <Icon name="layers" />
                      <span>未归属</span>
                    </button>
                    {projects.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        className="mya-poprow"
                        onClick={() => {
                          moveToProject(selectedIds, p.id, p.name)
                          setDockPop(null)
                        }}
                      >
                        <Icon name="clapperboard" />
                        <span>{p.name}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="mya-dock-wrap">
                <button
                  type="button"
                  data-on={dockPop === 'tag' || undefined}
                  onClick={() => setDockPop(dockPop === 'tag' ? null : 'tag')}
                >
                  <Icon name="plus" />
                  <span>标签</span>
                </button>
                {dockPop === 'tag' && (
                  <div className="mya-dock-pop mya-dock-tag-pop">
                    <input
                      value={dockTagText}
                      autoFocus
                      placeholder="输入标签，回车添加"
                      aria-label="批量添加标签"
                      onChange={(e) => setDockTagText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && dockTagText.trim()) {
                          batchAddTag(selectedIds, dockTagText)
                          setDockTagText('')
                          setDockPop(null)
                        }
                        if (e.key === 'Escape') setDockPop(null)
                      }}
                    />
                    <button
                      type="button"
                      className="mya-primary"
                      disabled={!dockTagText.trim()}
                      onClick={() => {
                        batchAddTag(selectedIds, dockTagText)
                        setDockTagText('')
                        setDockPop(null)
                      }}
                    >
                      添加
                    </button>
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={() => {
                  for (const a of assets) {
                    if (selected.has(a.id) && !a.tags.includes('★')) toggleFav(a)
                  }
                }}
              >
                <Icon name="star" />
                <span>收藏</span>
              </button>
              <button type="button" onClick={() => exportList(selectedIds)}>
                <Icon name="download" />
                <span>导出清单</span>
              </button>

              <div className="mya-dock-wrap">
                <button
                  type="button"
                  className="mya-danger"
                  data-on={dockPop === 'delete' || undefined}
                  onClick={() => setDockPop(dockPop === 'delete' ? null : 'delete')}
                >
                  <Icon name="trash-2" />
                  <span>删除</span>
                </button>
                {dockPop === 'delete' && (
                  <div className="mya-dock-pop mya-dock-del-pop" role="alert">
                    {selectedRefAssets.length > 0 ? (
                      <p>
                        其中 {selectedRefAssets.length} 项仍被引用（如「{selectedRefAssets[0].name}」），服务端会保留被引用项，仅删除未引用项。
                      </p>
                    ) : (
                      <p>永久删除已选的 {selected.size} 项素材？此操作不可恢复。</p>
                    )}
                    <div className="mya-dock-del-acts">
                      <button type="button" onClick={() => setDockPop(null)}>
                        取消
                      </button>
                      <button
                        type="button"
                        className="mya-danger-fill"
                        onClick={() => {
                          setDockPop(null)
                          doDelete(selectedIds, true)
                        }}
                      >
                        确认删除
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}

          <span className="mya-pickbar-sep" />
          <button type="button" onClick={closeDock}>
            取消
          </button>
          <button
            type="button"
            className="mya-primary"
            disabled={selected.size === 0}
            onClick={() => {
              if (pickMode) {
                confirmPick()
              } else {
                addToPending(selectedIds)
                // 保留未加入项，避免达到上限时把选择一并清空。

              }
              setDockPop(null)
            }}
          >
            <Icon name="square-check" />
            <span>加入待发送{selected.size > 0 ? `（${selected.size}）` : ''}</span>
          </button>
        </div>
      )}
    </div>
  )
}
