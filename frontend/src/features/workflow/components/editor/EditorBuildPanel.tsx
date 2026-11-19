import type * as React from 'react'
import { UiIcon, SemIcons } from '@/shared/icons/UiIcon'
import { Dataflow04, Menu01, Grid01, DotsGrid, Folder } from '@untitledui/icons'
import { NodeMark } from '@/features/workflow/components/WorkflowNodes'
import { NODE_COPY, type FmNode } from '@/features/workflow/model/editorNodes'
import { defForNode, STRUCTURED_STAGES, GATE_DEFS, PF_NODE_DEFS, pfDefaultParams, ARTIFACT_KINDS } from '@/features/workflow/model/workflowTemplates'
import { REFERENCE_SEGMENTS, REFERENCE_VIDEOS } from '@/features/reference/model/referenceLibrary'
import { useEditorArtifacts } from '@/features/workflow/hooks/editor/useEditorArtifacts'
import { useGraphEditing } from '@/features/workflow/hooks/editor/useGraphEditing'
import { useEditorHistory } from '@/features/workflow/hooks/editor/useEditorHistory'
import type { WorkflowDef } from '@/features/workflow/services/workflowService'
import type { EditorInnerProps } from '@/features/workflow/WorkflowEditor'

export interface EditorBuildPanelProps {
  activeStage: number | null
  addFxIntent: ReturnType<typeof useEditorArtifacts>['addFxIntent']
  addNode: ReturnType<typeof useGraphEditing>['addNode']
  addRefSegment: ReturnType<typeof useEditorArtifacts>['addRefSegment']
  focusRequest: React.RefObject<string | null>
  focusStage: (index: number | null) => void
  fxIntents: ReturnType<typeof useEditorHistory>['fxIntents']
  isStructured: boolean
  leftTab: 'nodes' | 'pending' | 'outline' | 'stages'
  nodeQuery: string
  nodes: FmNode[]
  panelOpen: boolean
  refConsumed: ReturnType<typeof useEditorHistory>['refConsumed']
  refIds: ReturnType<typeof useEditorHistory>['refIds']
  setLeftTab: React.Dispatch<React.SetStateAction<'nodes' | 'pending' | 'outline' | 'stages'>>
  setNodeQuery: React.Dispatch<React.SetStateAction<string>>
  setNodes: React.Dispatch<React.SetStateAction<FmNode[]>>
  setPanelOpen: React.Dispatch<React.SetStateAction<boolean>>
  targetForRefs: boolean
  workflow: WorkflowDef
  workflowId: EditorInnerProps['workflowId']
}

/** 工作流编辑器左侧构建栏：流程大纲或制作阶段导航、可拖入画布的节点库，以及特效库与参考片库送来的待接入资源；侧栏收起时隐藏。 */
export function EditorBuildPanel({ activeStage, addFxIntent, addNode, addRefSegment, focusRequest, focusStage, fxIntents, isStructured, leftTab, nodeQuery, nodes, panelOpen, refConsumed, refIds, setLeftTab, setNodeQuery, setNodes, setPanelOpen, targetForRefs, workflow, workflowId }: EditorBuildPanelProps) {
  return (
    <aside className="wfe-left" aria-label="构建栏" hidden={!panelOpen}>
      <div className="wfe-panel-title"><span><UiIcon icon={Dataflow04} size="md" /> 构建工作流</span><button type="button" aria-label="收起侧栏" onClick={() => setPanelOpen(false)}><UiIcon icon={Menu01} size="md" /></button></div>
      <div className="wfe-tabs" role="tablist" aria-label="构建栏页签">
        {!isStructured && <button type="button" role="tab" aria-selected={leftTab === 'outline'} data-on={leftTab === 'outline' ? '' : undefined} onClick={() => setLeftTab('outline')}>流程</button>}
        {isStructured && <button type="button" role="tab" aria-selected={leftTab === 'stages'} data-on={leftTab === 'stages' ? '' : undefined} onClick={() => setLeftTab('stages')}>阶段</button>}
        <button type="button" role="tab" aria-selected={leftTab === 'nodes'} data-on={leftTab === 'nodes' ? '' : undefined} onClick={() => setLeftTab('nodes')}>
          添加节点
        </button>
        <button type="button" role="tab" aria-selected={leftTab === 'pending'} data-on={leftTab === 'pending' ? '' : undefined} onClick={() => setLeftTab('pending')}>
          资源
          {(fxIntents.length + refIds.length) > 0 && <em className="num">{fxIntents.length + refIds.length}</em>}
        </button>
      </div>
      {leftTab === 'outline' ? <div className="wfe-outline">
        <div className="wfe-outline-label">画布节点 <span>{nodes.filter((n) => n.type === 'fm').length}</span></div>
        {nodes.filter((n) => n.type === 'fm').map((n) => <button type="button" className="wfe-outline-item" key={n.id} data-selected={n.selected || undefined} onClick={() => { focusRequest.current = n.id; setNodes((prev) => prev.map((item) => ({ ...item, selected: item.id === n.id }))) }}><NodeMark type={n.data.defType}/><span><b>{NODE_COPY[n.data.defType]?.title ?? defForNode({ type: n.data.defType, params: n.data.params })?.label}</b></span><UiIcon icon={SemIcons.expand} size="xs" /></button>)}
        <button type="button" className="wfe-outline-add" onClick={() => setLeftTab('nodes')}><UiIcon icon={SemIcons.plus} size="sm" /> 添加创作环节</button>
        {/* 只显示用户自己写的说明；没有时不再用一段通用介绍填空。节点用途在「添加节点」页签里有完整说明。 */}
        {workflow.description && <div className="wfe-outline-note"><span>工作流说明</span><p>{workflow.description}</p></div>}
      </div> : leftTab === 'stages' ? (
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
          {!isStructured &&
            PF_NODE_DEFS.filter((d) => `${d.label} ${d.description} ${NODE_COPY[d.type]?.title ?? ''}`.toLowerCase().includes(nodeQuery.trim().toLowerCase())).map((d) => (
              <button key={d.type} type="button" className="wfe-nodeitem" draggable onDragStart={(e) => { e.dataTransfer.setData('application/fengmotion-node', JSON.stringify({ type: d.type, params: pfDefaultParams(d.type) })); e.dataTransfer.effectAllowed = 'copy' }} onClick={() => addNode(d.type, pfDefaultParams(d.type))} title="拖到画布，或点击添加">
                <NodeMark type={d.type}/><span className="wfe-nodeitem-copy"><b>{NODE_COPY[d.type]?.title ?? d.label}</b><small>{NODE_COPY[d.type]?.description ?? d.description}</small></span><UiIcon icon={DotsGrid} size="sm" />
              </button>
            ))}
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
                  {added ? '已加入本工作流（待保存）' : isStructured ? 'Structured 中经能力映射接入（待后续）' : '加入能力检索'}
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
