import type * as React from 'react'
import { UiIcon, SemIcons } from '@/shared/icons/UiIcon'
import { ChevronLeftDouble, Grid01, DotsGrid, Folder } from '@untitledui/icons'
import { NodeMark } from '@/features/workflow/components/WorkflowNodes'
import { NODE_COPY, type FmNode } from '@/features/workflow/model/editorNodes'
import { STRUCTURED_STAGES, GATE_DEFS, PF_NODE_DEFS, pfDefaultParams, ARTIFACT_KINDS } from '@/features/workflow/model/workflowTemplates'
import { REFERENCE_SEGMENTS, REFERENCE_VIDEOS } from '@/features/reference/model/referenceLibrary'
import { useEditorArtifacts } from '@/features/workflow/hooks/editor/useEditorArtifacts'
import { useGraphEditing } from '@/features/workflow/hooks/editor/useGraphEditing'
import { useEditorHistory } from '@/features/workflow/hooks/editor/useEditorHistory'
import type { EditorInnerProps } from '@/features/workflow/WorkflowEditor'

export interface EditorBuildPanelProps {
  activeStage: number | null
  addFxIntent: ReturnType<typeof useEditorArtifacts>['addFxIntent']
  addNode: ReturnType<typeof useGraphEditing>['addNode']
  addRefSegment: ReturnType<typeof useEditorArtifacts>['addRefSegment']
  focusStage: (index: number | null) => void
  fxIntents: ReturnType<typeof useEditorHistory>['fxIntents']
  isStructured: boolean
  leftTab: 'nodes' | 'pending' | 'stages'
  nodeQuery: string
  nodes: FmNode[]
  panelOpen: boolean
  refConsumed: ReturnType<typeof useEditorHistory>['refConsumed']
  refIds: ReturnType<typeof useEditorHistory>['refIds']
  setLeftTab: React.Dispatch<React.SetStateAction<'nodes' | 'pending' | 'stages'>>
  setNodeQuery: React.Dispatch<React.SetStateAction<string>>
  setPanelOpen: React.Dispatch<React.SetStateAction<boolean>>
  targetForRefs: boolean
  workflowId: EditorInnerProps['workflowId']
}

/** 工作流编辑器左侧构建栏：流程大纲或制作阶段导航、可拖入画布的节点库，以及特效库与参考片库送来的待接入资源；侧栏收起时隐藏。 */
/** 节点库分组顺序与 PF_NODE_DEFS 的 group 一致 */
const LIB_GROUPS = ['输入', '制作循环', '交付']

export function EditorBuildPanel({ activeStage, addFxIntent, addNode, addRefSegment, focusStage, fxIntents, isStructured, leftTab, nodeQuery, nodes, panelOpen, refConsumed, refIds, setLeftTab, setNodeQuery, setPanelOpen, targetForRefs, workflowId }: EditorBuildPanelProps) {
  return (
    <aside className="wfe-left" aria-label="构建栏" hidden={!panelOpen}>
      {/* 页签就是标题：节点库 / 阶段（分阶段工作流）/ 资源；收起按钮在右侧 */}
      <div className="wfe-panel-title">
        <div className="wfe-tabs" role="tablist" aria-label="侧栏">
          {isStructured && <button type="button" role="tab" aria-selected={leftTab === 'stages'} data-on={leftTab === 'stages' ? '' : undefined} onClick={() => setLeftTab('stages')}>阶段</button>}
          <button type="button" role="tab" aria-selected={leftTab === 'nodes'} data-on={leftTab === 'nodes' ? '' : undefined} onClick={() => setLeftTab('nodes')}>
            节点库
          </button>
          <button type="button" role="tab" aria-selected={leftTab === 'pending'} data-on={leftTab === 'pending' ? '' : undefined} onClick={() => setLeftTab('pending')}>
            资源
            {(fxIntents.length + refIds.length) > 0 && <em className="num">{fxIntents.length + refIds.length}</em>}
          </button>
        </div>
        <button type="button" aria-label="收起侧栏" title="收起侧栏" onClick={() => setPanelOpen(false)}><UiIcon icon={ChevronLeftDouble} size="md" /></button>
      </div>
      {leftTab === 'stages' ? (
        <div className="wfe-stage-nav">
          <div className="wfe-outline-label">制作阶段 <span>8</span></div><button type="button" className="wfe-stage-overview" data-on={activeStage === null || undefined} onClick={() => focusStage(null)}><UiIcon icon={Grid01} size="sm" /> 全流程概览</button>
          {STRUCTURED_STAGES.map((stage) => {
            const lane = nodes.find((n) => n.type === 'lane' && Number(n.data.params.stage) === stage.index)
            const children = nodes.filter((n) => n.parentId === lane?.id && n.data.defType === 'artifact')
            const present = children.filter((n) => String(n.data.params.status ?? 'missing') !== 'missing').length
            const gateEntry = Object.entries(GATE_DEFS).find(([, gate]) => gate.afterStage === stage.index)
            const gateNode = gateEntry ? nodes.find((n) => n.data.defType === 'gate' && n.data.params.gate === gateEntry[0]) : undefined
            return <button type="button" key={stage.index} className="wfe-stage-nav-item" data-active={activeStage === stage.index || undefined} onClick={() => focusStage(stage.index)}><span className="wfe-stage-index">{String(stage.index + 1).padStart(2, '0')}</span><span className="wfe-stage-copy"><b>{stage.label}</b><small>{present}/{children.length} 项产物{gateNode ? ` · ${gateNode.data.gateEval?.decision === 'confirmed' && !gateNode.data.gateEval?.stale ? '已确认' : '待确认'}` : ''}</small></span><span aria-hidden="true">↗</span></button>
          })}

        </div>
      ) : leftTab === 'nodes' ? (
        <div className="wfe-nodelist">

          <label className="wfe-library-search"><UiIcon icon={SemIcons.search} size="sm" /><input value={nodeQuery} onChange={(e) => setNodeQuery(e.target.value)} placeholder="搜索节点" aria-label="搜索节点库" /></label>
          {!isStructured && nodeQuery.trim() && !PF_NODE_DEFS.some((d) => `${d.label} ${d.description} ${NODE_COPY[d.type]?.title ?? ''}`.toLowerCase().includes(nodeQuery.trim().toLowerCase())) && <p className="wfe-search-empty">没有匹配节点，试试其他关键词。</p>}
          {!isStructured && LIB_GROUPS.map((group) => {
            const q = nodeQuery.trim().toLowerCase()
            const defs = PF_NODE_DEFS.filter((d) => d.group === group && `${d.label} ${d.description} ${NODE_COPY[d.type]?.title ?? ''}`.toLowerCase().includes(q))
            if (!defs.length) return null
            return (
              <section key={group} className="wfe-libgroup">
                <h4>{group}</h4>
                {defs.map((d) => {
                  const count = nodes.filter((n) => n.data.defType === d.type).length
                  return (
                    <button key={d.type} type="button" className="wfe-nodeitem" draggable onDragStart={(e) => { e.dataTransfer.setData('application/fengmotion-node', JSON.stringify({ type: d.type, params: pfDefaultParams(d.type) })); e.dataTransfer.effectAllowed = 'copy' }} onClick={() => addNode(d.type, pfDefaultParams(d.type))} title="拖到画布，或点击添加">
                      <NodeMark type={d.type}/>
                      <span className="wfe-nodeitem-copy"><b>{NODE_COPY[d.type]?.title ?? d.label}{count > 0 && <em title={`画布上已有 ${count} 个`}>{count}</em>}</b><small>{NODE_COPY[d.type]?.description ?? d.description}</small></span>
                      <UiIcon icon={DotsGrid} size="sm" className="wfe-nodeitem-grip" />
                    </button>
                  )
                })}
              </section>
            )
          })}
          {isStructured && (
            <>
              {STRUCTURED_STAGES.map((s) => (
                <div key={s.index} className="wfe-stagegroup">
                  <h4>阶段 {s.index} · {s.label}</h4>
                  {ARTIFACT_KINDS.filter((k) => k.stage === s.index && `${k.label} ${k.filename}`.toLowerCase().includes(nodeQuery.trim().toLowerCase())).map((k) => (
                    <button
                      key={k.kind}
                      type="button"
                      className="wfe-nodeitem" draggable
                      onDragStart={(e) => { e.dataTransfer.setData('application/fengmotion-node', JSON.stringify({ type: 'artifact', params: { kind: k.kind, status: 'missing', version: '', summary: '', fixture: false } })); e.dataTransfer.effectAllowed = 'copy' }}
                      onClick={() => addNode('artifact', { kind: k.kind, status: 'missing', version: '', summary: '', fixture: false })}
                      title="拖到画布，或点击添加为自由节点"
                    >
                      <span className="wfe-nodeitem-top"><b>{k.label}</b><UiIcon icon={SemIcons.plus} size="xs" /></span>
                      <span>{k.filename}</span>
                    </button>
                  ))}
                </div>
              ))}
              <h4 className="wfe-stagegroup-title">检查点</h4>
              {Object.entries(GATE_DEFS).filter(([, def]) => `${def.label} ${def.question}`.toLowerCase().includes(nodeQuery.trim().toLowerCase())).map(([g, def]) => (
                <button
                  key={g}
                  type="button"
                  className="wfe-nodeitem" draggable
                  onDragStart={(e) => { e.dataTransfer.setData('application/fengmotion-node', JSON.stringify({ type: 'gate', params: { gate: g, decision: 'not-started', recommendation: '', validFor: [], notApproved: [], source: 'live' } })); e.dataTransfer.effectAllowed = 'copy' }}
                  onClick={() => addNode('gate', { gate: g, decision: 'not-started', recommendation: '', validFor: [], notApproved: [], source: 'live' })}
                  title="点击添加到画布"
                >
                  <span className="wfe-nodeitem-top"><b>{def.label}</b><UiIcon icon={SemIcons.plus} size="xs" /></span>
                  <span>{def.question}</span>
                </button>
              ))}
              <p className="wfe-hint">从这里新增的产物是自由节点；阶段泳道由模板骨架提供。Gate 的确认在检查器里对具体产物版本做出，运行不会代确认。</p>
            </>
          )}

        </div>
      ) : (
        <div className="wfe-pending">
          <div className="wfe-resource-links">{([['knowledge', '特效库'], ['reference', '参考片库']] as const).map(([id, label]) => <button type="button" className="wfe-btn sm" key={id} onClick={() => window.postMessage({ type: 'fm-nav', id }, '*')}><UiIcon icon={Folder} size="sm" />{label}</button>)}</div>
          <h3>技法意向 <em className="num">{fxIntents.length}</em></h3>
          {fxIntents.length === 0 && <p className="wfe-hint">暂无。在特效库点「用于工作流」后，意向会出现在这里。</p>}
          {fxIntents.map((it, i) => {
            const added = it.status === 'added' && it.workflowId === workflowId
            return (
              <div key={`${it.techniqueId}-${i}`} className="wfe-pend">
                <b>{it.techniqueName}</b>
                <span>意向目标：{it.projectName}</span>
                <button type="button" className="wfe-btn sm" disabled={added || isStructured} onClick={() => addFxIntent(it)}>
                  {added ? '已加入本工作流（待保存）' : isStructured ? '分阶段评估暂不接入技法检索' : '加入能力检索'}
                </button>
              </div>
            )
          })}
          <h3>参考结论 <em className="num">{refIds.length}</em></h3>
          {refIds.length === 0 && <p className="wfe-hint">暂无。在参考片库点「用作参考」后，片段结论会出现在这里。</p>}
          {refIds.map((id) => {
            const seg = REFERENCE_SEGMENTS.find((s) => s.id === id)
            const film = seg ? REFERENCE_VIDEOS.find((v) => v.id === seg.videoId) : null
            const attached = refConsumed[id] === workflowId
            return (
              <div key={id} className="wfe-pend">
                <b>{film ? `${film.title} · 片段 ${(seg?.index ?? 0) + 1}` : id}</b>
                <span>{seg?.observation ?? '来源片段不存在'}</span>
                <button type="button" className="wfe-btn sm" disabled={attached || !targetForRefs} onClick={() => addRefSegment(id)}>
                  {attached
                    ? '已接入本工作流（待保存）'
                    : !targetForRefs
                      ? isStructured ? '画布上暂无参考记录节点' : '画布上暂无参考与素材节点'
                      : isStructured ? '记入参考记录' : '加入参考与素材'}
                </button>
              </div>
            )
          })}
        </div>
      )}
    </aside>
  )
}
