import type * as React from 'react'
import { UiIcon, SemIcons } from '@/shared/icons/UiIcon'
import { nid } from '@/features/workflow/model/editorStorage'
import { Inspector } from '@/features/workflow/components/WorkflowInspector'
import { defForNode, GATE_DEFS } from '@/features/workflow/model/workflowTemplates'
import { NODE_COPY, pfSummary, type FmNode } from '@/features/workflow/model/editorNodes'
import { NodeMark, NodeState } from '@/features/workflow/components/WorkflowNodes'
import { nodeCapability } from '@/features/workflow/services/workflowCapabilities'
import { useEditorRun } from '@/features/workflow/hooks/editor/useEditorRun'
import { useEditorArtifacts } from '@/features/workflow/hooks/editor/useEditorArtifacts'
import { useEditorHistory } from '@/features/workflow/hooks/editor/useEditorHistory'
import { useGraphEditing } from '@/features/workflow/hooks/editor/useGraphEditing'
import type { Edge } from '@xyflow/react'
import type { WorkflowRun } from '@/features/workflow/services/workflowService'

export interface EditorInspectorPanelProps {
  activeStage: number | null
  doRunNode: ReturnType<typeof useEditorRun>['doRunNode']
  edges: Edge[]
  inspectorTab: 'outputs' | 'params' | 'inputs'
  isStructured: boolean
  lastRun: WorkflowRun | null
  latestRenderInfo: ReturnType<typeof useEditorArtifacts>['latestRenderInfo']
  markDirty: ReturnType<typeof useEditorHistory>['markDirty']
  nodes: FmNode[]
  projectId: string | null | undefined
  runMatches: ReturnType<typeof useEditorArtifacts>['runMatches']
  running: boolean
  selectedEdge: Edge | undefined
  selectedNode: FmNode | undefined
  setActiveStage: React.Dispatch<React.SetStateAction<number | null>>
  setEdges: React.Dispatch<React.SetStateAction<Edge[]>>
  setInspectorTab: React.Dispatch<React.SetStateAction<'outputs' | 'params' | 'inputs'>>
  setNodes: React.Dispatch<React.SetStateAction<FmNode[]>>
  snapshot: ReturnType<typeof useEditorHistory>['snapshot']
  updateParams: ReturnType<typeof useGraphEditing>['updateParams']
}

/** 工作流编辑器右侧检查器：选中节点时显示其设置、输入与输出并可单独运行，选中连线时显示连线设置；都没选中时隐藏。 */
export function EditorInspectorPanel({ activeStage, doRunNode, edges, inspectorTab, isStructured, lastRun, latestRenderInfo, markDirty, nodes, projectId, runMatches, running, selectedEdge, selectedNode, setActiveStage, setEdges, setInspectorTab, setNodes, snapshot, updateParams }: EditorInspectorPanelProps) {
  return (
    <aside className="wfe-inspector" aria-label="检查器" hidden={!selectedNode && !selectedEdge}>
      {selectedNode ? (<>
        <div className="wfe-inspector-toolbar"><span className="wfe-insp-type"><NodeMark type={selectedNode.data.defType} />{NODE_COPY[selectedNode.data.defType]?.title ?? defForNode({ type: selectedNode.data.defType, params: selectedNode.data.params })?.label ?? '节点'}</span>{(() => { const st = running ? selectedNode.data.status : runMatches ? lastRun?.nodeStatus[selectedNode.id] ?? 'idle' : 'idle'; return st !== 'idle' ? <NodeState status={st} /> : null })()}<div className="wfe-insp-tools"><button type="button" aria-label="关闭检查器" title="关闭检查器" onClick={() => setNodes((prev) => prev.map((n) => ({ ...n, selected: false })))}><UiIcon icon={SemIcons.close} size="md" /></button><button type="button" title="复制节点" aria-label="复制节点" onClick={() => { markDirty(); const id = nid(); setNodes((prev) => [...prev.map((n) => ({ ...n, selected: false })), { ...selectedNode, id, selected: true, className: 'is-new', position: { x: selectedNode.position.x + 35, y: selectedNode.position.y + 35 }, data: { ...selectedNode.data, params: structuredClone(selectedNode.data.params), status: 'idle' } }]) }}><UiIcon icon={SemIcons.copy} size="sm" /></button><button type="button" title="删除节点" aria-label="删除节点" onClick={() => { markDirty(); setNodes((prev) => prev.filter((n) => n.id !== selectedNode.id)); setEdges((prev) => prev.filter((e) => e.source !== selectedNode.id && e.target !== selectedNode.id)) }}><UiIcon icon={SemIcons.trash} size="sm" /></button></div></div>
        {(() => {
          const cap = nodeCapability(selectedNode.data.defType, { path: isStructured ? 'structured' : 'prompt-first', projectId })
          /* 一行小字：圆点 + 执行方式 + 说明，不再是一整块色块 */
          return <p className="wfe-insp-exec" data-x={cap.execution} title={cap.detail}><i aria-hidden="true" /><span>{cap.label}</span>{cap.detail}</p>
        })()}
        <div className="wfe-inspector-tabs" role="tablist" aria-label="节点详情">{([['params', '设置'], ['inputs', '输入'], ['outputs', '输出']] as const).map(([id, label]) => <button type="button" key={id} role="tab" aria-selected={inspectorTab === id} onClick={() => setInspectorTab(id)}>{label}</button>)}</div>
        <Inspector
          tab={inspectorTab}
          node={{ ...selectedNode, data: { ...selectedNode.data, status: running ? selectedNode.data.status : runMatches ? lastRun?.nodeStatus[selectedNode.id] ?? 'idle' : 'idle' } }}
          workflow={snapshot()}
          onParams={(patch) => updateParams(selectedNode.id, patch)}
          inputs={edges
            .filter((e) => e.target === selectedNode.id)
            .map((e) => {
              const src = nodes.find((n) => n.id === e.source)
              if (!src) return null
              const sdef = defForNode({ type: src.data.defType, params: src.data.params })
              const art = !running && runMatches ? lastRun?.artifacts.find((a) => a.nodeId === src.id) : null
              const detail = art
                ? art.summary
                : src.data.defType === 'artifact'
                  ? String(src.data.params.status ?? 'missing') === 'missing'
                    ? '尚无产物'
                    : `${String(src.data.params.status)}${src.data.params.version ? ` · ${String(src.data.params.version)}` : ''}`
                  : src.data.defType === 'gate'
                    ? '检查点'
                    : pfSummary(src.data.defType, src.data.params)
              return { nodeId: src.id, label: sdef?.label ?? src.data.defType, detail }
            })
            .filter((x): x is { nodeId: string; label: string; detail: string } => !!x)}
          output={!running && runMatches ? lastRun?.artifacts.find((a) => a.nodeId === selectedNode.id) ?? null : null}
          latestRender={latestRenderInfo}
          busy={running}
          onRunNode={() => doRunNode(selectedNode.id)}
          onSelectNode={(id) => {
            const target = nodes.find((n) => n.id === id)
            if (isStructured && activeStage !== null && target) {
              const parent = nodes.find((n) => n.id === target.parentId)
              const gateStage = target.data.defType === 'gate' ? GATE_DEFS[String(target.data.params.gate)]?.afterStage : undefined
              if (parent) setActiveStage(Number(parent.data.params.stage)); else if (gateStage !== undefined) setActiveStage(gateStage); else setActiveStage(null)
            }
            setNodes((prev) => prev.map((n) => ({ ...n, selected: n.id === id })))
          }}
        />
      </>) : selectedEdge ? (
        <div className="wfe-insp"><div className="wfe-inspector-toolbar"><span className="wfe-insp-type">连线</span><button type="button" aria-label="关闭连线检查器" onClick={() => setEdges((prev) => prev.map((e) => ({ ...e, selected: false })))}><UiIcon icon={SemIcons.close} size="md" /></button></div><h3>数据连接</h3><p className="wfe-hint">把上游节点的输出交给下游节点的输入。</p><button type="button" className="wfe-btn" onClick={() => { markDirty(); setEdges((prev) => prev.filter((e) => e.id !== selectedEdge.id)) }}><UiIcon icon={SemIcons.trash} size="sm" /> 删除连线</button></div>
      ) : null}
    </aside>
  )
}
