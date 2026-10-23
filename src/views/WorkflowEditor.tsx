/**
 * 工作流编辑器（原生，第一期）
 *
 * 定案骨架：顶部命令条（返回/名称/保存状态/DEMO 标识/保存/运行）+
 * 左构建栏（节点 / 待处理资源两页签）+ 中央画布（React Flow 仅作引擎）+
 * 右 Inspector + 底部执行抽屉（事件/节点输出/产物）。
 *
 * 数据只经 workflowService；两个 outbox 是跨库交接清单，加入状态分开记账：
 * 意向（库侧记录）→ 已加入画布（编辑器写回）→ 已保存（保存动作）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Handle,
  Position,
  useReactFlow,
  type Node,
  type Edge,
  type Connection,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import {
  ArrowLeft,
  Ban,
  CheckCircle2,
  ChevronDown,
  CircleDashed,
  Download,
  Eye,
  LoaderCircle,
  Play,
  Plus,
  Save,
  XCircle,
} from 'lucide-react'
import {
  WF_NODE_DEFS,
  WF_NODE_DEF_MAP,
  WF_PORT_COLORS,
  type WfEdgeInstance,
} from '../data/workflowTemplates'
import { BUILTIN_ASSETS, MEDIA_LABEL } from '../data/myAssets'
import { FX_TECHNIQUES } from '../data/fxTechniques'
import { REFERENCE_SEGMENTS, REFERENCE_VIDEOS } from '../data/referenceLibrary'
import { STORYBOARD } from '../data/productionData'
import {
  workflowService,
  startDemoRun,
  type WorkflowDef,
  type WorkflowRun,
  type WfArtifact,
  type WfNodeStatus,
} from '../services/workflowService'
import type { TaskEvent } from '../services/studioApi'

type FmNodeData = {
  defType: string
  params: Record<string, unknown>
  status: WfNodeStatus | 'idle'
}
type FmNode = Node<FmNodeData, 'fm'>

const FX_OUTBOX_KEY = 'fm-fx-usage-outbox-v1'
const REF_OUTBOX_KEY = 'fm-reference-outbox-v1'
const REF_CONSUMED_KEY = 'fm-workflow-ref-consumed-v1'

interface FxIntent {
  techniqueId: string
  techniqueName: string
  projectId: string
  projectName: string
  at: string
  status?: string
  workflowId?: string
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function nodeSummary(defType: string, params: Record<string, unknown>): string {
  switch (defType) {
    case 'script':
      return `${String(params.title ?? '未命名脚本')} · ${String(params.text ?? '').length} 字`
    case 'media':
      return `${((params.assetIds as string[] | undefined) ?? []).length} 项素材引用`
    case 'voiceover':
      return `${String(params.voiceLabel ?? '')} · 语速 ${String(params.rate ?? '正常')}`
    case 'shotplan':
      return `${STORYBOARD.length} 段基线 · ${((params.refSegmentIds as string[] | undefined) ?? []).length} 条参考`
    case 'technique': {
      const n = ((params.techniqueIds as string[] | undefined) ?? []).length
      return n ? `${n} 项技法引用（不执行）` : '未选择技法'
    }
    case 'compose':
      return `${String(params.resolution ?? '1080p')} · 工程描述（不渲染）`
    default:
      return ''
  }
}

function FmNodeView({ data, selected }: { data: FmNodeData; selected?: boolean }) {
  const def = WF_NODE_DEF_MAP[data.defType]
  if (!def) return null
  return (
    <div className="wfn" data-selected={selected || undefined} data-status={data.status}>
      <div className="wfn-head">
        <span className="wfn-group">{def.group}</span>
        <b>{def.label}</b>
        <span className="wfn-status" data-s={data.status}>
          {data.status === 'running' && <LoaderCircle size={11} className="wfn-spin" />}
          {data.status === 'completed' && <CheckCircle2 size={11} />}
          {data.status === 'failed' && <XCircle size={11} />}
          {data.status === 'skipped' && <Ban size={11} />}
          {data.status === 'pending' && <CircleDashed size={11} />}
        </span>
      </div>
      <p className="wfn-summary">{nodeSummary(data.defType, data.params)}</p>
      <div className="wfn-ports">
        <div className="wfn-col">
          {def.inputs.map((p) => (
            <span key={p.id} className="wfn-port in">
              <Handle
                type="target"
                position={Position.Left}
                id={p.id}
                className="wfn-handle"
                style={{ background: WF_PORT_COLORS[p.type] }}
              />
              {p.label}
              {p.required && <em>*</em>}
            </span>
          ))}
        </div>
        <div className="wfn-col out">
          {def.outputs.map((p) => (
            <span key={p.id} className="wfn-port out">
              {p.label}
              <Handle
                type="source"
                position={Position.Right}
                id={p.id}
                className="wfn-handle"
                style={{ background: WF_PORT_COLORS[p.type] }}
              />
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

const nodeTypes = { fm: FmNodeView }

let seq = 0
const nid = () => `n-${Date.now().toString(36)}${(seq += 1).toString(36)}`

export function WorkflowEditor(props: { workflowId: string; onBack: () => void }) {
  return (
    <ReactFlowProvider>
      <EditorInner {...props} />
    </ReactFlowProvider>
  )
}

function EditorInner({ workflowId, onBack }: { workflowId: string; onBack: () => void }) {
  const initial = useMemo(() => workflowService.getWorkflow(workflowId), [workflowId])
  const [workflow, setWorkflow] = useState<WorkflowDef | null>(initial)
  const [name, setName] = useState(initial?.name ?? '')
  const [nodes, setNodes] = useState<FmNode[]>(() =>
    (initial?.nodes ?? []).map((n) => ({
      id: n.id,
      type: 'fm',
      position: n.position,
      data: { defType: n.type, params: n.params, status: 'idle' },
    })),
  )
  const [edges, setEdges] = useState<Edge[]>(() =>
    (initial?.edges ?? []).map((e) => toRfEdge(e)),
  )
  const [dirty, setDirty] = useState(false)
  const [leftTab, setLeftTab] = useState<'nodes' | 'pending'>('nodes')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [drawerTab, setDrawerTab] = useState<'events' | 'outputs' | 'artifacts'>('events')
  const [running, setRunning] = useState(false)
  const [liveEvents, setLiveEvents] = useState<TaskEvent[]>([])
  const [lastRun, setLastRun] = useState<WorkflowRun | null>(() => workflowService.listRuns(workflowId)[0] ?? null)
  const [viewing, setViewing] = useState<WfArtifact | null>(null)
  const [pendingTick, setPendingTick] = useState(0)
  const runHandle = useRef<{ cancel: () => void } | null>(null)
  const flow = useReactFlow()
  const wrapRef = useRef<HTMLDivElement>(null)

  const selectedNode = nodes.find((n) => n.selected)
  const selectedEdge = edges.find((e) => e.selected)

  const fxIntents = useMemo(() => readJson<FxIntent[]>(FX_OUTBOX_KEY, []), [pendingTick])
  const refIds = useMemo(() => readJson<string[]>(REF_OUTBOX_KEY, []), [pendingTick])
  const refConsumed = useMemo(() => readJson<Record<string, string>>(REF_CONSUMED_KEY, {}), [pendingTick])

  useEffect(() => {
    const t = setTimeout(() => flow.fitView({ padding: 0.18, maxZoom: 1 }), 60)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function toRfEdge(e: WfEdgeInstance): Edge {
    const srcDef = WF_NODE_DEF_MAP[initial?.nodes.find((n) => n.id === e.source)?.type ?? '']
    const out = srcDef?.outputs.find((p) => p.id === e.sourcePort)
    return {
      id: e.id,
      source: e.source,
      sourceHandle: e.sourcePort,
      target: e.target,
      targetHandle: e.targetPort,
      style: { stroke: out ? WF_PORT_COLORS[out.type] : undefined, strokeWidth: 1.6 },
      animated: false,
    }
  }

  const markDirty = () => setDirty(true)

  const updateParams = useCallback(
    (nodeId: string, patch: Record<string, unknown>) => {
      setNodes((prev) =>
        prev.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, params: { ...n.data.params, ...patch } } } : n)),
      )
      markDirty()
    },
    [],
  )

  const isValidConnection = useCallback(
    (c: Connection | Edge) => {
      if (!c.source || !c.target || c.source === c.target) return false
      const s = nodes.find((n) => n.id === c.source)
      const t = nodes.find((n) => n.id === c.target)
      if (!s || !t) return false
      const out = WF_NODE_DEF_MAP[s.data.defType]?.outputs.find((p) => p.id === c.sourceHandle)
      const inp = WF_NODE_DEF_MAP[t.data.defType]?.inputs.find((p) => p.id === c.targetHandle)
      return !!out && !!inp && out.type === inp.type
    },
    [nodes],
  )

  const onConnect = useCallback(
    (c: Connection) => {
      if (!isValidConnection(c)) return
      setEdges((prev) => {
        const kept = prev.filter((e) => !(e.target === c.target && e.targetHandle === c.targetHandle))
        const srcNode = nodes.find((n) => n.id === c.source)
        const out = srcNode ? WF_NODE_DEF_MAP[srcNode.data.defType]?.outputs.find((p) => p.id === c.sourceHandle) : undefined
        return [
          ...kept,
          {
            id: nid(),
            source: c.source!,
            sourceHandle: c.sourceHandle ?? undefined,
            target: c.target!,
            targetHandle: c.targetHandle ?? undefined,
            style: { stroke: out ? WF_PORT_COLORS[out.type] : undefined, strokeWidth: 1.6 },
          } as Edge,
        ]
      })
      markDirty()
    },
    [isValidConnection, nodes],
  )

  const addNode = useCallback(
    (defType: string, at?: { x: number; y: number }) => {
      const id = nid()
      const rect = wrapRef.current?.getBoundingClientRect()
      const center = at ?? (rect ? flow.screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }) : { x: 240, y: 200 })
      const jitter = (nodes.length % 5) * 26
      const node: FmNode = {
        id,
        type: 'fm',
        position: { x: center.x - 110 + jitter, y: center.y - 40 + jitter },
        data: { defType, params: defaultParamsFor(defType), status: 'idle' },
      }
      setNodes((prev) => [...prev, node])
      markDirty()
      return id
    },
    [flow, nodes.length],
  )

  function defaultParamsFor(defType: string): Record<string, unknown> {
    switch (defType) {
      case 'script': return { title: '未命名脚本', text: '' }
      case 'media': return { projectId: 'token', assetIds: [] }
      case 'voiceover': return { voiceLabel: '讲述声线（计划）', rate: '正常' }
      case 'shotplan': return { note: '', refSegmentIds: [] }
      case 'technique': return { techniqueIds: [] }
      case 'compose': return { projectId: 'token', resolution: '1080p' }
      default: return {}
    }
  }

  const snapshot = useCallback((): WorkflowDef | null => {
    if (!workflow) return null
    return {
      ...workflow,
      name,
      nodes: nodes.map((n) => ({ id: n.id, type: n.data.defType, position: n.position, params: n.data.params })),
      edges: edges.map((e) => ({
        id: e.id,
        source: e.source,
        sourcePort: e.sourceHandle ?? '',
        target: e.target,
        targetPort: e.targetHandle ?? '',
      })),
    }
  }, [workflow, name, nodes, edges])

  const doSave = useCallback(() => {
    const snap = snapshot()
    if (!snap) return
    const saved = workflowService.saveWorkflow(snap.id, { name: snap.name, nodes: snap.nodes, edges: snap.edges })
    if (saved) {
      setWorkflow(saved)
      setDirty(false)
    }
  }, [snapshot])

  const doRun = useCallback(() => {
    const snap = snapshot()
    if (!snap || running) return
    setRunning(true)
    setLiveEvents([])
    setViewing(null)
    setDrawerOpen(true)
    setDrawerTab('events')
    setNodes((prev) => prev.map((n) => ({ ...n, data: { ...n.data, status: 'pending' as const } })))
    const handle = startDemoRun(snap, {
      onEvent: (e) => setLiveEvents((prev) => [...prev, e]),
      onNodeStatus: (nodeId, status) =>
        setNodes((prev) => prev.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, status } } : n))),
    })
    runHandle.current = handle
    void handle.done.then((run) => {
      setLastRun(run)
      setRunning(false)
      runHandle.current = null
      if (run.status === 'completed') setDrawerTab('artifacts')
    })
  }, [snapshot, running])

  /* 待处理资源动作 */
  const addFxIntent = (intent: FxIntent) => {
    const techNode = nodes.find((n) => n.data.defType === 'technique')
    if (techNode) {
      const ids = (techNode.data.params.techniqueIds as string[] | undefined) ?? []
      if (!ids.includes(intent.techniqueId)) updateParams(techNode.id, { techniqueIds: [...ids, intent.techniqueId] })
    } else {
      const id = addNode('technique')
      // 新增节点的参数在下一轮状态里写入
      setTimeout(() => updateParams(id, { techniqueIds: [intent.techniqueId] }), 0)
    }
    const list = readJson<FxIntent[]>(FX_OUTBOX_KEY, [])
    const at = list.findIndex((x) => x.techniqueId === intent.techniqueId && x.at === intent.at)
    if (at >= 0) {
      list[at] = { ...list[at], status: 'added', workflowId }
      try { localStorage.setItem(FX_OUTBOX_KEY, JSON.stringify(list)) } catch { /* ignore */ }
    }
    setPendingTick((t) => t + 1)
  }

  const addRefSegment = (segmentId: string) => {
    const shotsNode = nodes.find((n) => n.data.defType === 'shotplan')
    if (!shotsNode) return
    const ids = (shotsNode.data.params.refSegmentIds as string[] | undefined) ?? []
    if (!ids.includes(segmentId)) updateParams(shotsNode.id, { refSegmentIds: [...ids, segmentId] })
    const map = readJson<Record<string, string>>(REF_CONSUMED_KEY, {})
    map[segmentId] = workflowId
    try { localStorage.setItem(REF_CONSUMED_KEY, JSON.stringify(map)) } catch { /* ignore */ }
    setPendingTick((t) => t + 1)
  }

  const downloadArtifact = (a: WfArtifact) => {
    const blob = new Blob([a.content], { type: 'application/json;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = a.filename
    link.click()
    URL.revokeObjectURL(url)
  }

  const goReview = () => {
    window.parent.postMessage({ type: 'fm-nav', id: 'production', projectId: 'token' }, '*')
    window.postMessage({ type: 'fm-nav', id: 'production', projectId: 'token' }, '*')
  }

  if (!workflow) {
    return (
      <section className="wfe">
        <div className="wfe-cmd">
          <button type="button" className="wfe-iconbtn" onClick={onBack} aria-label="返回工作流首页"><ArrowLeft size={16} /></button>
          <b>工作流不存在或已被删除</b>
        </div>
      </section>
    )
  }

  const eventsToShow = running || liveEvents.length > 0 ? liveEvents : (lastRun?.events ?? [])
  const artifactsToShow = lastRun?.artifacts ?? []
  const hasShotplan = nodes.some((n) => n.data.defType === 'shotplan')

  return (
    <section className="wfe" aria-label="工作流编辑器">
      <div className="wfe-cmd">
        <button type="button" className="wfe-iconbtn" onClick={onBack} aria-label="返回工作流首页">
          <ArrowLeft size={16} strokeWidth={2.2} />
        </button>
        <input
          className="wfe-name"
          value={name}
          onChange={(e) => { setName(e.target.value); markDirty() }}
          aria-label="工作流名称"
        />
        <span className="wfe-savestate">{dirty ? '有未保存更改' : `已保存 · 修订 ${workflow.revision}`}</span>
        <span className="wfe-demo">DEMO 执行器</span>
        <span className="wfe-spacer" />
        {running && (
          <button type="button" className="wfe-btn" onClick={() => runHandle.current?.cancel()}>
            <Ban size={13} strokeWidth={2.2} /> 取消
          </button>
        )}
        <button type="button" className="wfe-btn" onClick={doSave} disabled={!dirty}>
          <Save size={13} strokeWidth={2.2} /> 保存
        </button>
        <button type="button" className="wfe-btn is-primary" onClick={doRun} disabled={running}>
          <Play size={13} strokeWidth={2.2} /> {running ? '运行中…' : '运行'}
        </button>
      </div>

      <div className="wfe-body">
        <aside className="wfe-left" aria-label="构建栏">
          <div className="wfe-tabs" role="tablist" aria-label="构建栏页签">
            <button type="button" role="tab" aria-selected={leftTab === 'nodes'} data-on={leftTab === 'nodes' ? '' : undefined} onClick={() => setLeftTab('nodes')}>
              节点
            </button>
            <button type="button" role="tab" aria-selected={leftTab === 'pending'} data-on={leftTab === 'pending' ? '' : undefined} onClick={() => setLeftTab('pending')}>
              待处理资源
              {(fxIntents.length + refIds.length) > 0 && <em className="num">{fxIntents.length + refIds.length}</em>}
            </button>
          </div>
          {leftTab === 'nodes' ? (
            <div className="wfe-nodelist">
              {WF_NODE_DEFS.map((d) => (
                <button
                  key={d.type}
                  type="button"
                  className="wfe-nodeitem"
                  onClick={() => addNode(d.type)}
                  title="点击添加到画布"
                >
                  <span className="wfe-nodeitem-top"><b>{d.label}</b><Plus size={12} strokeWidth={2.4} /></span>
                  <span>{d.description}</span>
                </button>
              ))}
              <p className="wfe-hint">连线按端口类型校验：颜色相同的端口才能相连；同一输入口只接受一条连线。</p>
            </div>
          ) : (
            <div className="wfe-pending">
              <h3>技法意向 <em className="num">{fxIntents.length}</em></h3>
              {fxIntents.length === 0 && <p className="wfe-hint">暂无。在特效库点「用于工作流」后，意向会出现在这里。</p>}
              {fxIntents.map((it, i) => {
                const added = it.status === 'added' && it.workflowId === workflowId
                return (
                  <div key={`${it.techniqueId}-${i}`} className="wfe-pend">
                    <b>{it.techniqueName}</b>
                    <span>意向目标：{it.projectName}</span>
                    <button type="button" className="wfe-btn sm" disabled={added} onClick={() => addFxIntent(it)}>
                      {added ? '已加入本工作流（待保存）' : '加入技法节点'}
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
                    <button type="button" className="wfe-btn sm" disabled={attached || !hasShotplan} onClick={() => addRefSegment(id)}>
                      {attached ? '已附加到分镜设计（待保存）' : hasShotplan ? '附加到分镜设计' : '画布上暂无分镜设计节点'}
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </aside>

        <div className="wfe-canvas" ref={wrapRef}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={(changes) => {
              setNodes((prev) => {
                let next = [...prev]
                for (const c of changes) {
                  if (c.type === 'position' && c.position) next = next.map((n) => (n.id === c.id ? { ...n, position: c.position!, dragging: c.dragging } : n))
                  if (c.type === 'select') next = next.map((n) => (n.id === c.id ? { ...n, selected: c.selected } : n))
                  if (c.type === 'remove') next = next.filter((n) => n.id !== c.id)
                  if (c.type === 'dimensions' && c.dimensions) next = next.map((n) => (n.id === c.id ? { ...n, measured: c.dimensions } : n))
                }
                return next
              })
              if (changes.some((c) => c.type === 'remove' || c.type === 'position')) markDirty()
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
            isValidConnection={isValidConnection}
            deleteKeyCode={['Backspace', 'Delete']}
            fitView
            fitViewOptions={{ padding: 0.18, maxZoom: 1 }}
            proOptions={{ hideAttribution: true }}
            colorMode="dark"
          >
            <Background variant={BackgroundVariant.Dots} gap={24} size={1.4} />
            <Controls showInteractive={false} position="bottom-left" />
            <MiniMap position="bottom-right" pannable zoomable style={{ width: 148, height: 96 }} />
          </ReactFlow>
        </div>

        <aside className="wfe-inspector" aria-label="检查器">
          {selectedNode ? (
            <Inspector
              node={selectedNode}
              onParams={(patch) => updateParams(selectedNode.id, patch)}
              attachedRefs={((selectedNode.data.params.refSegmentIds as string[] | undefined) ?? [])}
            />
          ) : selectedEdge ? (
            <div className="wfe-insp">
              <h3>连线</h3>
              <p className="wfe-hint">
                {nodes.find((n) => n.id === selectedEdge.source)?.data.defType} →{' '}
                {nodes.find((n) => n.id === selectedEdge.target)?.data.defType}，端口类型一致。
                按 Delete 可删除这条连线。
              </p>
            </div>
          ) : (
            <div className="wfe-insp">
              <h3>检查器</h3>
              <p className="wfe-hint">选中节点查看并编辑参数；选中连线查看类型关系。</p>
              <dl className="wfe-kv">
                <dt>工作流</dt><dd>{workflow.name}</dd>
                <dt>修订</dt><dd className="num">{workflow.revision}</dd>
                <dt>节点 / 连线</dt><dd className="num">{nodes.length} / {edges.length}</dd>
                <dt>来源</dt><dd>{workflow.sourceTemplateId ? `模板 ${workflow.sourceTemplateId} ${workflow.templateVersion ?? ''}` : '空白创建'}</dd>
                <dt>执行器</dt><dd>DEMO（Mock 适配器，本地持久化）</dd>
              </dl>
            </div>
          )}
        </aside>
      </div>

      <div className="wfe-drawer" data-open={drawerOpen || undefined}>
        <button type="button" className="wfe-drawer-head" onClick={() => setDrawerOpen((v) => !v)} aria-expanded={drawerOpen}>
          <ChevronDown size={14} className={drawerOpen ? 'wfe-chev is-open' : 'wfe-chev'} />
          执行日志
          {lastRun && <span className="wfe-drawer-meta">最近运行：{lastRun.status === 'completed' ? '已完成' : lastRun.status} · {lastRun.artifacts.length} 项产物 · {new Date(lastRun.startedAt).toLocaleTimeString('zh-CN')}</span>}
          {running && <span className="wfe-drawer-meta">运行中…</span>}
        </button>
        {drawerOpen && (
          <div className="wfe-drawer-body">
            <div className="wfe-tabs sm" role="tablist" aria-label="执行日志视图">
              {([['events', '事件'], ['outputs', '节点输出'], ['artifacts', '产物']] as const).map(([id, label]) => (
                <button key={id} type="button" role="tab" aria-selected={drawerTab === id} data-on={drawerTab === id ? '' : undefined} onClick={() => setDrawerTab(id)}>
                  {label}
                </button>
              ))}
            </div>
            {drawerTab === 'events' && (
              <ul className="wfe-events">
                {eventsToShow.length === 0 && <li className="wfe-hint">暂无事件。点击顶部「运行」开始一次演示运行。</li>}
                {eventsToShow.map((e) => (
                  <li key={e.id} data-k={e.kind}>
                    <span className="num">{new Date(e.at).toLocaleTimeString('zh-CN')}</span> {e.message}
                  </li>
                ))}
              </ul>
            )}
            {drawerTab === 'outputs' && (
              <ul className="wfe-events">
                {nodes.map((n) => {
                  const st = lastRun?.nodeStatus[n.id] ?? n.data.status
                  return (
                    <li key={n.id}>
                      {WF_NODE_DEF_MAP[n.data.defType]?.label}：
                      {st === 'completed' ? '已完成' : st === 'running' ? '运行中' : st === 'failed' ? '失败' : st === 'skipped' ? '已跳过' : '待运行'}
                      {' · '}{nodeSummary(n.data.defType, n.data.params)}
                    </li>
                  )
                })}
                {nodes.length === 0 && <li className="wfe-hint">画布上还没有节点。</li>}
              </ul>
            )}
            {drawerTab === 'artifacts' && (
              <div className="wfe-artifacts">
                {viewing ? (
                  <div className="wfe-artifact-view">
                    <div className="wfe-artifact-view-head">
                      <b>{viewing.title}</b>
                      <span>{viewing.filename}</span>
                      <button type="button" className="wfe-btn sm" onClick={() => setViewing(null)}>返回产物列表</button>
                    </div>
                    <pre>{viewing.content}</pre>
                  </div>
                ) : (
                  <>
                    {artifactsToShow.length === 0 && <p className="wfe-hint">暂无产物。运行完成后，结构化演示产物会出现在这里。</p>}
                    {artifactsToShow.map((a) => (
                      <div key={a.id} className="wfe-artifact">
                        <div className="wfe-artifact-main">
                          <b>{a.title}</b>
                          <span>{a.summary}</span>
                        </div>
                        <button type="button" className="wfe-btn sm" onClick={() => setViewing(a)}><Eye size={12} /> 查看</button>
                        <button type="button" className="wfe-btn sm" onClick={() => downloadArtifact(a)}><Download size={12} /> 下载</button>
                        {a.kind === 'spec' && (
                          <button type="button" className="wfe-btn sm" onClick={goReview}>去工作台审查</button>
                        )}
                      </div>
                    ))}
                    {artifactsToShow.some((a) => a.kind === 'spec') && (
                      <p className="wfe-hint">「去工作台审查」打开 Token 科普视频的制作工作台；演示产物保存在本次运行记录中，工作台产物联动待服务层接入后在此审查（Gate）。</p>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  )
}

/* ── Inspector 参数编辑 ─────────────────────────────────────────── */

function Inspector(props: {
  node: FmNode
  onParams: (patch: Record<string, unknown>) => void
  attachedRefs: string[]
}) {
  const { node, onParams } = props
  const def = WF_NODE_DEF_MAP[node.data.defType]
  const p = node.data.params
  if (!def) return null
  const tokenAssets = BUILTIN_ASSETS.filter((a) => a.refs.some((r) => r.kind === 'project' && r.id === 'token'))

  return (
    <div className="wfe-insp">
      <h3>{def.label}</h3>
      <p className="wfe-hint">{def.description}</p>

      {node.data.defType === 'script' && (
        <>
          <label className="wfe-field"><span>标题</span>
            <input value={String(p.title ?? '')} onChange={(e) => onParams({ title: e.target.value })} />
          </label>
          <label className="wfe-field"><span>脚本文本</span>
            <textarea rows={12} value={String(p.text ?? '')} onChange={(e) => onParams({ text: e.target.value })} />
          </label>
        </>
      )}

      {node.data.defType === 'media' && (
        <>
          <p className="wfe-hint">项目：Token 科普视频。只引用素材库中的真实素材，不复制文件。</p>
          <div className="wfe-checks">
            {tokenAssets.map((a) => {
              const ids = (p.assetIds as string[] | undefined) ?? []
              const on = ids.includes(a.id)
              return (
                <label key={a.id} className="wfe-check">
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => onParams({ assetIds: on ? ids.filter((x) => x !== a.id) : [...ids, a.id] })}
                  />
                  <span>{a.name}</span><em>{MEDIA_LABEL[a.mediaType]}</em>
                </label>
              )
            })}
          </div>
        </>
      )}

      {node.data.defType === 'voiceover' && (
        <>
          <label className="wfe-field"><span>声线（计划）</span>
            <input value={String(p.voiceLabel ?? '')} onChange={(e) => onParams({ voiceLabel: e.target.value })} />
          </label>
          <div className="wfe-field"><span>语速</span>
            <div className="wfe-seg">
              {['慢', '正常', '快'].map((r) => (
                <button key={r} type="button" data-on={p.rate === r ? '' : undefined} aria-pressed={p.rate === r} onClick={() => onParams({ rate: r })}>{r}</button>
              ))}
            </div>
          </div>
          <p className="wfe-hint">只生成配音计划（分段 + 估算时长），不合成语音。</p>
        </>
      )}

      {node.data.defType === 'shotplan' && (
        <>
          <label className="wfe-field"><span>说明</span>
            <input value={String(p.note ?? '')} onChange={(e) => onParams({ note: e.target.value })} />
          </label>
          <p className="wfe-hint">基线：Token 科普视频真实工程 {STORYBOARD.length} 段分镜（演示基线，非新生成）。</p>
          {props.attachedRefs.length > 0 && (
            <div className="wfe-field"><span>已附加的参考结论</span>
              <ul className="wfe-reflist">
                {props.attachedRefs.map((id) => {
                  const seg = REFERENCE_SEGMENTS.find((s) => s.id === id)
                  const film = seg ? REFERENCE_VIDEOS.find((v) => v.id === seg.videoId) : null
                  return (
                    <li key={id}>
                      <span>{film ? `${film.title} · 片段 ${(seg?.index ?? 0) + 1}` : id}</span>
                      <button
                        type="button"
                        className="wfe-textbtn"
                        onClick={() => onParams({ refSegmentIds: props.attachedRefs.filter((x) => x !== id) })}
                      >
                        移除
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
          )}
        </>
      )}

      {node.data.defType === 'technique' && (
        <>
          <p className="wfe-hint">引用只记录技法 ID 与能力标签，运行不会执行技法本身。</p>
          <div className="wfe-checks">
            {FX_TECHNIQUES.map((t) => {
              const ids = (p.techniqueIds as string[] | undefined) ?? []
              const on = ids.includes(t.id)
              return (
                <label key={t.id} className="wfe-check">
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => onParams({ techniqueIds: on ? ids.filter((x) => x !== t.id) : [...ids, t.id] })}
                  />
                  <span>{t.name}</span><em>{t.execLabel}</em>
                </label>
              )
            })}
          </div>
        </>
      )}

      {node.data.defType === 'compose' && (
        <>
          <label className="wfe-field"><span>目标规格</span>
            <select value={String(p.resolution ?? '1080p')} onChange={(e) => onParams({ resolution: e.target.value })}>
              <option value="1080p">1080p · 1920×1080</option>
              <option value="1440p">1440p · 2560×1440</option>
              <option value="4k">4k · 3840×2160</option>
            </select>
          </label>
          <p className="wfe-hint">产出工程描述（RemotionProjectSpec）并记录到本次运行的 ChangeSet；demo 执行器不渲染视频。</p>
        </>
      )}
    </div>
  )
}
