import { useRef, useState } from 'react'
import { type MediaType, type MyAsset } from '@/features/assets/model/myAssets'
// 素材库数据源：服务端（原 IndexedDB 已由 assetApiService 替代）。
// 接口形状与旧 assetService 一致，视图逻辑不必改写。
import { type FolderRow } from '@/features/assets/services/assetApiService'
import { type MigrationReport } from '@/features/assets/services/assetMigration'
import { Icon } from '@/features/assets/components/AssetIcon'
import { type SortKey } from '@/features/assets/model/assetDisplay'
import { AssetInspector } from '@/features/assets/components/AssetInspector'
import { AssetCanvas } from '@/features/assets/components/AssetCanvas'
import { AssetsHeader } from '@/features/assets/components/AssetsHeader'
import { type NodeId, type TreeEntry, nodeLabel } from '@/features/assets/model/assetTree'
import { useAssetActions } from '@/features/assets/hooks/library/useAssetActions'
import { useAssetImport } from '@/features/assets/hooks/library/useAssetImport'
import { useAssetMigration } from '@/features/assets/hooks/library/useAssetMigration'
import { useAssetCollections } from '@/features/assets/hooks/library/useAssetCollections'
import { useAssetEscape } from '@/features/assets/hooks/library/useAssetEscape'
import { useAssetThumbs } from '@/features/assets/hooks/library/useAssetThumbs'
import { useAssetLoad } from '@/features/assets/hooks/library/useAssetLoad'
import { useAssetPendingPick } from '@/features/assets/hooks/library/useAssetPendingPick'
import { AssetsOrgPanel } from '@/features/assets/components/AssetsOrgPanel'

export function Assets({ projectName }: { projectName?: string } = {}) {
  const [assets, setAssets] = useState<MyAsset[]>([])
  const [folders, setFolders] = useState<FolderRow[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  /* 旧版素材在浏览器 IndexedDB 里。新版本读服务端，若不提示并迁移，
     老用户打开就会看到空库 —— 那是「文件丢了」的观感，必须在界面上给出口。 */
  const [legacyPending, setLegacyPending] = useState(false)
  const [migration, setMigration] = useState<MigrationReport | null>(null)
  const [migrating, setMigrating] = useState(false)
  const [migrationDone, setMigrationDone] = useState(0)
  const [loadVersion, setLoadVersion] = useState(0)
  const [node, setNode] = useState<NodeId>('all')
  const [typeFilter, setTypeFilter] = useState<MediaType | 'all'>('all')
  const [pop, setPop] = useState<'type' | 'sort' | null>(null)
  const [orgOpen, setOrgOpen] = useState(true)
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('recent')
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [detailId, setDetailId] = useState<string | null>(null)
  const [hoveredVideo, setHoveredVideo] = useState<string | null>(null)
  const [thumbs, setThumbs] = useState<Record<string, string>>({})
  const [renaming, setRenaming] = useState<MyAsset | null>(null)
  const [renameText, setRenameText] = useState('')
  const [tagText, setTagText] = useState('')
  /* 待发送：素材库是「挑素材」的地方，这里只负责把选中项交给那份全局清单。
     加入 ≠ 发送，也不改素材本身的任何字段。 */
  const { setPickMode, enterPick, pickMode, addToPending, pending, exitPick, confirmPick } = useAssetPendingPick({ selected, setDetailId, setSelected })

  const inputRef = useRef<HTMLInputElement>(null)

  const dragDepth = useRef(0)
  /* 本次拖拽是不是「在我们自己的界面里起手」的。
     见下面导入监听的注释 —— 这是唯一可靠的判据。 */
  const ownDrag = useRef(false)

  // ── 加载 ──
  useAssetLoad({ loadVersion, setAssets, setFolders, setLegacyPending, setLoadError, setLoading, setMigration })

  // ── 缩略图解析（内置图片直接用路径；视频懒截真实帧）──
  useAssetThumbs({ assets, setThumbs })

  // Esc 关闭检查器 / 浮层 / 重命名（输入框自己也会处理）
  useAssetEscape({ setDetailId, setPickMode, setPop, setRenaming, setSelected })

  const { visible, counts, projectList, tagList, detail } = useAssetCollections({ assets, detailId, node, projectName, search, sortKey, typeFilter })

  // ── 导入 ──
  /* 导入：不再弹「导入队列」面板（作者要求删掉）。但过程不能一声不响 ——
     逐个文件导入要读尺寸/时长/抽缩略图，十个文件可能等好几秒。
     所以用已有的全局 toast 汇报结果：成功入库 N 个，失败的指出名字。 */
  /**
   * 把旧版浏览器素材迁移到服务端。
   *
   * 界面只做两件事：显示真实进度、迁移完刷新。规则都在 assetMigration 里：
   * 逐条校验、失败不切换、旧库只读保留。
   */
  const { runMigration } = useAssetMigration({ migrating, setLegacyPending, setLoadVersion, setMigrating, setMigration, setMigrationDone })

  const { onPick } = useAssetImport({ dragDepth, ownDrag, setAssets })

  // ── 操作 ──
  const { clearFilter, addFolder, toggleFav, applyPatch, moveToFolder, exportList, doDelete, onGridKeys, openDetail, toggleSelect, copyPath, doRename } = useAssetActions({ assets, detailId, renameText, renaming, setAssets, setDetailId, setFolders, setNode, setRenaming, setSearch, setSelected, setTypeFilter, visible })

  // ── 渲染 ──
  const coreNodes: TreeEntry[] = [
    { id: 'all', label: '全部素材', icon: 'layout-grid', count: counts.all },
    { id: 'favorites', label: '收藏', icon: 'star', count: counts.favorites },
    { id: 'recent', label: '最近使用', icon: 'history', count: counts.recent },
  ]
  const projectNodes: TreeEntry[] = projectList.map((p) => ({
    id: `proj:${p.id}|${p.label}`, label: p.label, icon: 'clapperboard', count: p.count,
  }))
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
  const activeLabel = nodeLabel(node, folders)

  const renderNav = (t: TreeEntry) => (
    <button key={t.id} type="button" className="mya-org-row" data-on={node === t.id || undefined}
            aria-pressed={node === t.id}
            onClick={() => setNode(t.id)}>
      <Icon name={t.icon} />
      <span className="mya-org-label">{t.label}</span>
      <em>{t.count}</em>
    </button>
  )

  return (
    <div className="mya">
      <AssetsHeader
        activeLabel={activeLabel}
        assets={assets}
        clearFilter={clearFilter}
        counts={counts}
        enterPick={enterPick}
        inputRef={inputRef}
        node={node}
        orgOpen={orgOpen}
        pickMode={pickMode}
        pop={pop}
        search={search}
        setOrgOpen={setOrgOpen}
        setPop={setPop}
        setSearch={setSearch}
        setSortKey={setSortKey}
        setTypeFilter={setTypeFilter}
        setViewMode={setViewMode}
        sortKey={sortKey}
        typeFilter={typeFilter}
        viewMode={viewMode}
      />
      <input ref={inputRef} type="file" multiple hidden onChange={onPick} />

      <div className="mya-body">
        {orgOpen && (
          <AssetsOrgPanel
            addFolder={addFolder}
            coreNodes={coreNodes}
            counts={counts}
            folders={folders}
            node={node}
            projectNodes={projectNodes}
            renderNav={renderNav}
            setNode={setNode}
            setOrgOpen={setOrgOpen}
            smartNodes={smartNodes}
            sourceNodes={sourceNodes}
            tagList={tagList}
          />
        )}

        <div className="mya-main">
          {/* 搜索与「网格 / 列表 / 类型 / 排序」已并入页头，顶部不再叠两层空白。
              这条工具条只在选择模式或批量操作时出现，用来放临时的操作行。 */}
          {(pickMode || selected.size > 0) && (
            <div className="mya-toolbar">
              {pickMode ? (
                <div className="mya-toolbar-pick">
                  <Icon name="square-check" />
                  <b>选择素材</b>
                  <span>点卡片选中，选完点底部「确认加入待发送」</span>
                </div>
              ) : (
              <div className="mya-batch" role="region" aria-label="批量操作">
                <span className="mya-batch-n">已选 {selected.size} 项</span>
                {/* 加入待发送放在最前：多选之后最常做的是"这次就用这几个" */}
                <button type="button" className="mya-batch-pending"
                        onClick={() => { addToPending([...selected]); setSelected(new Set()) }}>
                  加入待发送
                </button>
                <button type="button" onClick={() => setSelected(new Set(visible.map((a) => a.id)))}>全选当前</button>
                <button type="button" onClick={() => setSelected(new Set())}>清除选择</button>
                <span className="mya-batch-sep" />
                <button type="button" onClick={() => { for (const a of assets) if (selected.has(a.id) && !a.tags.includes('★')) toggleFav(a) }}>收藏</button>
                <button type="button" onClick={() => { const t = window.prompt('给选中素材添加标签'); if (t?.trim()) { for (const a of assets) if (selected.has(a.id)) applyPatch(a.id, { tags: [...new Set([...a.tags, t.trim()])] }) } }}>加标签</button>
                <button type="button" onClick={() => { const f = window.prompt('移动到文件夹（输入名称，留空=移出）'); if (f === null) return; const target = f.trim() ? folders.find((x) => x.name === f.trim()) ?? null : null; if (f.trim() && !target) { window.alert('没有这个文件夹，先在组织栏新建'); return } moveToFolder([...selected], target?.id ?? null) }}>移动</button>
                <button type="button" onClick={() => exportList([...selected])}>导出清单</button>
                <button type="button" className="mya-danger" onClick={() => doDelete([...selected])}>删除</button>
              </div>
              )}
            </div>
          )}
          {pop && <div className="mya-popshade" onClick={() => setPop(null)} />}

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
            addToPending={addToPending}
            applyPatch={applyPatch}
            copyPath={copyPath}
            detail={detail}
            doDelete={doDelete}
            pending={pending}
            setDetailId={setDetailId}
            setRenameText={setRenameText}
            setRenaming={setRenaming}
            setTagText={setTagText}
            tagText={tagText}
            thumbs={thumbs}
            toggleFav={toggleFav}
          />
        )}
      </div>

      {/* 选择模式的确认条：浮在底部中央。整库进入可选中状态后，
          这里只做三件事 —— 报数、全选、确认。 */}
      {pickMode && (
        <div className="mya-pickbar" role="region" aria-label="选择素材">
          <span className="mya-pickbar-n">
            {selected.size > 0 ? `已选 ${selected.size} 项` : '点素材卡片选择'}
          </span>
          <button type="button" className="mya-pickbar-all"
                  onClick={() => setSelected(new Set(visible.map((a) => a.id)))}>
            全选当前 {visible.length} 项
          </button>
          <span className="mya-pickbar-sep" />
          <button type="button" onClick={exitPick}>取消</button>
          <button type="button" className="mya-primary" disabled={selected.size === 0}
                  onClick={confirmPick}>
            <Icon name="square-check" />
            确认加入待发送{selected.size > 0 ? `（${selected.size}）` : ''}
          </button>
        </div>
      )}

      {renaming && (
        <div className="mya-modal" onClick={() => setRenaming(null)}>
          <div className="mya-modal-card" onClick={(e) => e.stopPropagation()}>
            <h4>重命名</h4>
            <input value={renameText} autoFocus onChange={(e) => setRenameText(e.target.value)}
                   onKeyDown={(e) => { if (e.key === 'Enter') doRename(); if (e.key === 'Escape') setRenaming(null) }} />
            <div className="mya-modal-acts">
              <button type="button" onClick={() => setRenaming(null)}>取消</button>
              <button type="button" className="mya-primary" onClick={doRename}>确定</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
