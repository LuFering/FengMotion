import { useState, type JSX, type ReactNode } from 'react'
import type * as React from 'react'
import { Icon } from '@/features/assets/components/AssetIcon'
import { tagColor, type TreeEntry, type NodeId } from '@/features/assets/model/assetTree'
import { formatBytes, type FolderRow } from '@/features/assets/services/assetApiService'
import { useAssetCollections } from '@/features/assets/hooks/useAssetCollections'

export interface AssetsOrgPanelProps {
  countsState: 'loading' | 'unknown' | 'stale' | 'ready'
  coreNodes: TreeEntry[]
  counts: ReturnType<typeof useAssetCollections>['counts']
  createNewFolder: (name: string) => Promise<FolderRow | null>
  folders: FolderRow[]
  node: NodeId
  projectNodes: TreeEntry[]
  removeExistingFolder: (folderId: string) => Promise<boolean>
  renameExistingFolder: (folderId: string, name: string) => Promise<boolean>
  renderNav: (t: TreeEntry) => JSX.Element
  setNode: React.Dispatch<React.SetStateAction<NodeId>>
  setOrgOpen: React.Dispatch<React.SetStateAction<boolean>>
  smartNodes: TreeEntry[]
  sourceNodes: TreeEntry[]
  tagList: ReturnType<typeof useAssetCollections>['tagList']
}

function Group({ title, children, active }: { title: string; children: ReactNode; active?: boolean }) {
  const [expanded, setExpanded] = useState<boolean | null>(null)
  const open = expanded ?? active ?? false
  return <section className="mya-org-group">
    <button type="button" className="mya-group-toggle" aria-expanded={!!open} onClick={() => setExpanded(!open)}>
      <span>{title}</span><Icon name={open ? 'chevron-down' : 'chevron-right'} />
    </button>
    {open && <div>{children}</div>}
  </section>
}

/** 我的素材左侧组织栏：按库、来源、项目、待处理状态、文件夹（支持内联新建/改名/删除）和标签分组的导航。 */
export function AssetsOrgPanel({
  coreNodes,
  countsState,
  counts,
  createNewFolder,
  folders,
  node,
  projectNodes,
  removeExistingFolder,
  renameExistingFolder,
  renderNav,
  setNode,
  setOrgOpen,
  smartNodes,
  sourceNodes,
  tagList,
}: AssetsOrgPanelProps) {
  const unknownCount = countsState === 'loading' || countsState === 'unknown'
  const [busy, setBusy] = useState(false)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  const submitCreate = async () => {
    const trimmed = newName.trim()
    if (!trimmed) {
      setCreating(false)
      return
    }
    if (busy) return
    setBusy(true)
    const created = await createNewFolder(trimmed)
    setBusy(false)
    if (created) {
      setNewName('')
      setCreating(false)
      setNode(`folder:${created.id}`)
    }
  }

  const submitRename = async (folderId: string) => {
    const trimmed = editName.trim()
    if (!trimmed) {
      setEditingId(null)
      return
    }
    if (busy) return
    setBusy(true)
    const ok = await renameExistingFolder(folderId, trimmed)
    setBusy(false)
    if (ok) setEditingId(null)
  }

  return (
    <aside className="mya-org" aria-label="素材组织">
      <div className="mya-org-head">
        <span>分类</span>
        <button
          type="button"
          className="mya-org-toggle"
          onClick={() => setOrgOpen(false)}
          title="收起素材分类"
          aria-label="收起素材分类"
        >
          <Icon name="panel-left-close" />
        </button>
      </div>
      <div className="mya-org-scroll">
        {coreNodes.map(renderNav)}

        <div className="mya-org-sec">项目</div>
        {projectNodes.map(renderNav)}

        <div className="mya-org-sec">文件夹</div>
        {folders.map((f) => {
          const folderNodeId: NodeId = `folder:${f.id}`
          const count = counts.folder(f.id)
          if (editingId === f.id) {
            return (
              <fieldset disabled={busy} key={f.id} className="mya-folder-inline">
                <input
                  value={editName}
                  autoFocus
                  aria-label="文件夹新名称"
                  onChange={(e) => setEditName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void submitRename(f.id)
                    if (e.key === 'Escape') setEditingId(null)
                  }}
                />
                <button type="button" onClick={() => void submitRename(f.id)} title="保存" aria-label="保存文件夹名称">
                  <Icon name="check" />
                </button>
                <button type="button" onClick={() => setEditingId(null)} title="取消" aria-label="取消重命名">
                  <Icon name="x" />
                </button>
              </fieldset>
            )
          }
          if (confirmDeleteId === f.id) {
            return (
              <div key={f.id} className="mya-folder-confirm" role="alert">
                <span title={`删除「${f.name}」后，其中 ${count} 项素材将移回根目录`}>
                  删除「{f.name}」？{count} 项素材将移至未分类。
                </span>
                <button
                  type="button"
                  className="mya-danger"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true)
                    const ok = await removeExistingFolder(f.id)
                    setBusy(false)
                    if (ok) setConfirmDeleteId(null)
                  }}
                >
                  删除
                </button>
                <button type="button" onClick={() => setConfirmDeleteId(null)}>
                  取消
                </button>
              </div>
            )
          }
          return (
            <div
              key={f.id}
              className="mya-folder-item"
              data-on={node === folderNodeId || undefined}
            >
              <button
                type="button"
                className="mya-org-row"
                data-on={node === folderNodeId || undefined}
                aria-pressed={node === folderNodeId}
                onClick={() => setNode(folderNodeId)}
              >
                <Icon name="folder-open" />
                <span className="mya-org-label">{f.name}</span>
                <em>{unknownCount ? '—' : count}</em>
              </button>
              <span className="mya-folder-acts">
                <button
                  type="button"
                  title="重命名文件夹"
                  aria-label={`重命名文件夹 ${f.name}`}
                  onClick={(e) => {
                    e.stopPropagation()
                    setEditingId(f.id)
                    setEditName(f.name)
                    setConfirmDeleteId(null)
                  }}
                >
                  <Icon name="pencil" />
                </button>
                <button
                  type="button"
                  title="删除文件夹（素材移回根目录）"
                  aria-label={`删除文件夹 ${f.name}`}
                  onClick={(e) => {
                    e.stopPropagation()
                    setConfirmDeleteId(f.id)
                    setEditingId(null)
                  }}
                >
                  <Icon name="trash-2" />
                </button>
              </span>
            </div>
          )
        })}

        {creating ? (
          <fieldset disabled={busy} className="mya-folder-inline">
            <input
              value={newName}
              autoFocus
              placeholder="文件夹名称"
              aria-label="新建文件夹名称"
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void submitCreate()
                if (e.key === 'Escape') {
                  setCreating(false)
                  setNewName('')
                }
              }}
            />
            <button type="button" onClick={() => void submitCreate()} title="创建" aria-label="确认创建文件夹">
              <Icon name="check" />
            </button>
            <button
              type="button"
              onClick={() => {
                setCreating(false)
                setNewName('')
              }}
              title="取消"
              aria-label="取消新建文件夹"
            >
              <Icon name="x" />
            </button>
          </fieldset>
        ) : (
          <button
            type="button"
            className="mya-org-add"
            onClick={() => {
              setCreating(true)
              setNewName('')
            }}
          >
            <Icon name="folder-plus" />
            <span>新建文件夹</span>
          </button>
        )}

        <Group title="来源" active={['imported', 'generated', 'builtin'].includes(node)}>{sourceNodes.map(renderNav)}</Group>

        <Group title="授权与审核" active={node.startsWith('review:') || node.startsWith('license:') || node === 'refs:none'}>
        {smartNodes.map((t) => (
          <button
            key={t.id}
            type="button"
            className="mya-org-row"
            data-on={node === t.id || undefined}
            data-zero={t.count === 0 || undefined}
            aria-pressed={node === t.id}
            onClick={() => setNode(t.id)}
          >
            <Icon name={t.icon} />
            <span className="mya-org-label">{t.label}</span>
            <em>{unknownCount ? '—' : t.count}</em>
          </button>
        ))}
        </Group>
        {tagList.length > 0 && (
          <Group title="标签" active={node.startsWith('tag:')}>
            {tagList.map(([t, c]) => (
              <button
                key={t}
                type="button"
                className="mya-org-row"
                data-on={node === `tag:${t}` || undefined}
                aria-pressed={node === `tag:${t}`}
                onClick={() => setNode(`tag:${t}`)}
              >
                <span className="mya-tagdot" style={{ background: tagColor(t) }} />
                <span className="mya-org-label">{t}</span>
                <em>{unknownCount ? '—' : c}</em>
              </button>
            ))}
          </Group>
        )}
      </div>
      <div className="mya-org-foot">
        <Icon name="cylinder" />
        {unknownCount ? <span>{countsState === 'loading' ? '正在读取素材库' : '素材数量未知'}</span> : <><span>{counts.all} 项</span><span>· {formatBytes(counts.totalBytes)}{countsState === 'stale' ? ' · 未更新' : ''}</span></>}
      </div>
    </aside>
  )
}
