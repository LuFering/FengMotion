import type * as React from 'react'
import { Icon } from '@/features/assets/components/AssetIcon'
import { tagColor, type TreeEntry, type NodeId } from '@/features/assets/model/assetTree'
import { formatBytes, type FolderRow } from '@/features/assets/services/assetApiService'
import { useAssetActions } from '@/features/assets/hooks/library/useAssetActions'
import { useAssetCollections } from '@/features/assets/hooks/library/useAssetCollections'

export interface AssetsOrgPanelProps {
  addFolder: ReturnType<typeof useAssetActions>['addFolder']
  coreNodes: TreeEntry[]
  counts: ReturnType<typeof useAssetCollections>['counts']
  folders: FolderRow[]
  node: NodeId
  projectNodes: TreeEntry[]
  renderNav: (t: TreeEntry) => React.JSX.Element
  setNode: React.Dispatch<React.SetStateAction<NodeId>>
  setOrgOpen: React.Dispatch<React.SetStateAction<boolean>>
  smartNodes: TreeEntry[]
  sourceNodes: TreeEntry[]
  tagList: ReturnType<typeof useAssetCollections>['tagList']
}

/** 从 Assets.tsx 原样拆出的界面区块；props 与原处的变量同名。 */
export function AssetsOrgPanel({ addFolder, coreNodes, counts, folders, node, projectNodes, renderNav, setNode, setOrgOpen, smartNodes, sourceNodes, tagList }: AssetsOrgPanelProps) {
  return (
    <aside className="mya-org" aria-label="素材组织">
      <div className="mya-org-head">
        <span>组织</span>
        <button type="button" className="mya-org-toggle" onClick={() => setOrgOpen(false)}
                title="收起组织栏" aria-label="收起组织栏">
          <Icon name="panel-left-close" />
        </button>
      </div>
      <div className="mya-org-scroll">
        <div className="mya-org-sec">库</div>
        {coreNodes.map(renderNav)}
        <div className="mya-org-sec">来源</div>
        {sourceNodes.map(renderNav)}
        {projectNodes.length > 0 && (
          <>
            <div className="mya-org-sec">项目</div>
            {projectNodes.map(renderNav)}
          </>
        )}
        <div className="mya-org-sec">智能文件夹</div>
        {smartNodes.map(renderNav)}
        <div className="mya-org-sec">文件夹</div>
        {folders.map((f) => renderNav({ id: `folder:${f.id}`, label: f.name, icon: 'folder-open', count: counts.folder(f.id) }))}
        <button type="button" className="mya-org-add" onClick={addFolder}>
          <Icon name="folder-plus" /><span>新建文件夹</span>
        </button>
        {tagList.length > 0 && (
          <>
            <div className="mya-org-sec">标签</div>
            {tagList.map(([t, c]) => (
              <button key={t} type="button" className="mya-org-row" data-on={node === `tag:${t}` || undefined}
                      aria-pressed={node === `tag:${t}`}
                      onClick={() => setNode(`tag:${t}`)}>
                <span className="mya-tagdot" style={{ background: tagColor(t) }} />
                <span className="mya-org-label">{t}</span>
                <em>{c}</em>
              </button>
            ))}
          </>
        )}
      </div>
      <div className="mya-org-foot">
        <Icon name="cylinder" />
        <span className="mono">{formatBytes(counts.totalBytes)}</span>
        <span>· 素材库 {counts.all} 项</span>
      </div>
    </aside>
  )
}
