import type * as React from 'react'
import { defForNode, pfDefaultParams, GATE_DEFS, STRUCTURED_STAGES } from '@/features/workflow/model/workflowTemplates'
import { UiIcon, SemIcons } from '@/shared/icons/UiIcon'
import { Menu01, ReverseLeft, ReverseRight, Grid01, ChevronLeft, Minus, Maximize01, Dataflow04 } from '@untitledui/icons'
import { canvasLayout } from '@/features/workflow/model/graphLayout'
import { ReactFlow, Background, BackgroundVariant, type Edge, type ReactFlowInstance, type Node } from '@xyflow/react'
import { nodeTypes, ConnectMenuView } from '@/features/workflow/components/WorkflowNodes'
import { ReworkEdge } from '@/features/workflow/components/editor/ReworkEdge'

const edgeTypes = { rework: ReworkEdge }
import { useGraphEditing } from '@/features/workflow/hooks/editor/useGraphEditing'
import { useDisplayedGraph } from '@/features/workflow/hooks/editor/useDisplayedGraph'
import { useEditorHistory } from '@/features/workflow/hooks/editor/useEditorHistory'
import type { FmNode } from '@/features/workflow/model/editorNodes'

export interface EditorCanvasProps {
  activeStage: number | null
  addNode: ReturnType<typeof useGraphEditing>['addNode']
  compact: boolean
  /** 正在拖的连线：端口类型与方向，用来把不能接的端口变暗 */
  linking: ReturnType<typeof useGraphEditing>['linking']
  connectCandidates: ReturnType<typeof useGraphEditing>['connectCandidates']
  connectMenu: ReturnType<typeof useGraphEditing>['connectMenu']
  displayedNodes: ReturnType<typeof useDisplayedGraph>['displayedNodes']
  edges: Edge[]
  flow: ReactFlowInstance<Node, Edge>
  focusStage: (index: number | null) => void
  isStructured: boolean
  isValidConnection: ReturnType<typeof useGraphEditing>['isValidConnection']
  markDirty: ReturnType<typeof useEditorHistory>['markDirty']
  nodes: FmNode[]
  onConnect: ReturnType<typeof useGraphEditing>['onConnect']
  onConnectEnd: ReturnType<typeof useGraphEditing>['onConnectEnd']
  onConnectStart: ReturnType<typeof useGraphEditing>['onConnectStart']
  panelOpen: boolean
  pickConnectCandidate: ReturnType<typeof useGraphEditing>['pickConnectCandidate']
  redo: ReturnType<typeof useEditorHistory>['redo']
  redoStack: ReturnType<typeof useEditorHistory>['redoStack']
  setCompact: React.Dispatch<React.SetStateAction<boolean>>
  setConnectMenu: ReturnType<typeof useGraphEditing>['setConnectMenu']
  setEdges: React.Dispatch<React.SetStateAction<Edge[]>>
  setLeftTab: React.Dispatch<React.SetStateAction<'nodes' | 'pending' | 'stages'>>
  setNodes: React.Dispatch<React.SetStateAction<FmNode[]>>
  setPanelOpen: React.Dispatch<React.SetStateAction<boolean>>
  setRunNotice: React.Dispatch<React.SetStateAction<string>>
  setZoom: React.Dispatch<React.SetStateAction<number>>
  undo: ReturnType<typeof useEditorHistory>['undo']
  undoStack: ReturnType<typeof useEditorHistory>['undoStack']
  visibleEdges: ReturnType<typeof useDisplayedGraph>['visibleEdges']
  wrapRef: React.RefObject<HTMLDivElement | null>
  zoom: number
}

/** 工作流编辑器的画布：拖入节点、连线与删除、撤销重做、整理与缩放；空画布时给出起步提示，连线拖到空白处时弹出可接节点菜单。 */
export function EditorCanvas({ activeStage, addNode, compact, linking, connectCandidates, connectMenu, displayedNodes, edges, flow, focusStage, isStructured, isValidConnection, markDirty, nodes, onConnect, onConnectEnd, onConnectStart, panelOpen, pickConnectCandidate, redo, redoStack, setCompact, setConnectMenu, setEdges, setLeftTab, setNodes, setPanelOpen, setRunNotice, setZoom, undo, undoStack, visibleEdges, wrapRef, zoom }: EditorCanvasProps) {
  const tidy = () => {
    markDirty()
    if (isStructured) {
      setNodes((prev) => prev.map((n) => {
        if (n.type === 'lane') return { ...n, position: { x: 0, y: Number(n.data.params.stage) * 350 }, style: { width: 1240, height: 300 } }
        if (n.parentId) { const peers = prev.filter((p) => p.parentId === n.parentId); return { ...n, position: { x: 24 + peers.findIndex((p) => p.id === n.id) * 300, y: 64 } } }
        if (n.data.defType === 'gate') { const stage = GATE_DEFS[String(n.data.params.gate)]?.afterStage ?? 0; return { ...n, position: { x: 944, y: stage * 350 + 64 } } }
        return n
      }))
    } else {
      setNodes((prev) => {
        const positions = canvasLayout(prev.map((n) => ({ id: n.id, type: n.data.defType, height: n.measured?.height })), edges.filter((e) => e.id !== '__rework-hint__'))
        return prev.map((n) => ({ ...n, position: positions[n.id] }))
      })
    }
    window.setTimeout(() => { void flow.fitView({ padding: 0.18, minZoom: 0.2, maxZoom: 1, duration: 200 }) }, 80)
  }
  return (
    <div className="wfe-canvas" ref={wrapRef} data-compact={compact || undefined} data-linking={linking?.portType} data-linking-from={linking?.handleType}
      onDragOver={(e) => { if (Array.from(e.dataTransfer.types).includes('application/fengmotion-node')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy' } }}
      onDrop={(e) => {
        const raw = e.dataTransfer.getData('application/fengmotion-node')
        if (!raw) return
        e.preventDefault()
        try {
          const value = JSON.parse(raw) as { type?: string; params?: Record<string, unknown> }
          if (!value.type || !defForNode({ type: value.type, params: value.params ?? {} })) return
          addNode(value.type!, value.params ?? pfDefaultParams(value.type!), flow.screenToFlowPosition({ x: e.clientX - 25, y: e.clientY - 25 }))
          if (window.innerWidth < 1000) setPanelOpen(false)
        } catch { setRunNotice('无法添加该节点，请从节点库重试。') }
      }}>
      {!panelOpen && <button type="button" className="wfe-panel-reopen" onClick={() => setPanelOpen(true)} title="展开侧栏" aria-label="展开工作流侧栏"><UiIcon icon={Menu01} size="md" /></button>}
      {isStructured && activeStage !== null && <div className="wfe-stage-context"><span>阶段 {String(activeStage + 1).padStart(2, '0')} / 08</span><h2>{STRUCTURED_STAGES[activeStage].label}</h2><p>{STRUCTURED_STAGES[activeStage].question}</p><div><button type="button" aria-label="上个阶段" disabled={activeStage === 0} onClick={() => focusStage(activeStage - 1)}><UiIcon icon={ChevronLeft} size="sm" /></button><button type="button" aria-label="下个阶段" disabled={activeStage === 7} onClick={() => focusStage(activeStage + 1)}><UiIcon icon={SemIcons.expand} size="sm" /></button></div></div>}
      {/* 画布工具集中在底部一条：添加 · 撤销重做 · 整理 · 缩放 · 适应。快捷键表在顶栏「更多」里，不常驻提示。 */}
      <div className="wfe-dock" role="toolbar" aria-label="画布工具">
        <button type="button" className="wfe-dock-add" onClick={() => { setPanelOpen(true); setLeftTab('nodes') }}><UiIcon icon={SemIcons.plus} size="sm" />添加节点</button>
        <i />
        <button type="button" onClick={undo} disabled={!undoStack.current.length} title="撤销（Ctrl+Z）" aria-label="撤销"><UiIcon icon={ReverseLeft} size="sm" /></button>
        <button type="button" onClick={redo} disabled={!redoStack.current.length} title="重做（Ctrl+Shift+Z）" aria-label="重做"><UiIcon icon={ReverseRight} size="sm" /></button>
        <button type="button" onClick={tidy} title="自动整理节点位置" aria-label="整理"><UiIcon icon={Grid01} size="sm" /></button>
        <i />
        <button type="button" onClick={() => { void flow.zoomOut({ duration: 150 }) }} aria-label="缩小" title="缩小"><UiIcon icon={Minus} size="sm" /></button>
        <button type="button" className="wfe-dock-zoom" onClick={() => { void flow.zoomTo(1, { duration: 150 }) }} title="恢复 100%">{Math.round(zoom * 100)}%</button>
        <button type="button" onClick={() => { void flow.zoomIn({ duration: 150 }) }} aria-label="放大" title="放大"><UiIcon icon={SemIcons.plus} size="sm" /></button>
        <button type="button" onClick={() => { void flow.fitView({ padding: 0.16, minZoom: 0.2, maxZoom: 1, duration: 200 }) }} title="适应画布（F）" aria-label="适应画布"><UiIcon icon={Maximize01} size="sm" /></button>
      </div>
      {nodes.length === 0 && <div className="wfe-empty-canvas"><UiIcon icon={Dataflow04} size="xl" /><h2>从第一个节点开始</h2><p>从左侧节点库拖进来，再把输出连到下一个节点的输入。</p><button type="button" className="wfe-btn" onClick={() => { setPanelOpen(true); setLeftTab('nodes') }}><UiIcon icon={SemIcons.plus} size="sm" />添加节点</button></div>}
      <ReactFlow
        nodes={displayedNodes}
        edges={visibleEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodeDragStart={() => markDirty()}
        onMove={(_, vp) => { setCompact(vp.zoom < 0.55); setZoom(Math.round(vp.zoom * 100) / 100) }}
        onNodesChange={(changes) => {
          setNodes((prev) => {
            let next = [...prev]
            for (const c of changes) {
              if (c.type === 'position' && c.position) next = next.map((n) => (n.id === c.id ? { ...n, position: c.position!, dragging: c.dragging } : n))
              if (c.type === 'select') next = next.map((n) => (n.id === c.id ? { ...n, selected: c.selected } : n))
              if (c.type === 'dimensions' && c.dimensions) next = next.map((n) => (n.id === c.id ? { ...n, measured: c.dimensions } : n))
              if (c.type === 'remove') {
                const removed = next.find((n) => n.id === c.id)
                next = next.filter((n) => n.id !== c.id)
                if (removed?.type === 'lane') {
                  next = next.map((n) =>
                    n.parentId === c.id
                      ? { ...n, parentId: undefined, position: { x: n.position.x + removed.position.x, y: n.position.y + removed.position.y } }
                      : n,
                  )
                }
              }
            }
            return next
          })
          if (changes.some((c) => c.type === 'remove')) markDirty()
        }}
        onEdgesChange={(changes) => {
          setEdges((prev) => {
            let next = [...prev]
            for (const c of changes) {
              if (c.type === 'select') next = next.map((e) => (e.id === c.id ? { ...e, selected: c.selected } : e))
              if (c.type === 'remove') next = next.filter((e) => e.id !== c.id)
            }
            return next
          })
          if (changes.some((c) => c.type === 'remove')) markDirty()
        }}
        onConnect={onConnect}
        onConnectStart={onConnectStart}
        onConnectEnd={onConnectEnd}
        isValidConnection={isValidConnection}
        deleteKeyCode={['Backspace', 'Delete']}
        minZoom={0.2}
        maxZoom={1.6}
        onPaneClick={() => setNodes((prev) => prev.map((n) => ({ ...n, selected: false })))}
        proOptions={{ hideAttribution: true }}
        colorMode="system"
        ariaLabelConfig={{ "node.a11yDescription.default": '拖动节点调整位置，按 Delete 删除。', "edge.a11yDescription.default": '连接节点的输入与输出。' }}
      >
        <Background variant={BackgroundVariant.Dots} gap={24} size={1} bgColor="var(--canvas)" />

      </ReactFlow>
      {connectMenu && (
        <ConnectMenuView
          x={connectMenu.x}
          y={connectMenu.y}
          portType={connectMenu.portType}
          fromSource={connectMenu.handleType === 'source'}
          candidates={connectCandidates}
          onPick={pickConnectCandidate}
          onClose={() => setConnectMenu(null)}
        />
      )}
    </div>
  )
}
