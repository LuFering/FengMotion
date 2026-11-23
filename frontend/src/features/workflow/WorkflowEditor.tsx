/**
 * 工作流编辑器（v5 重构）
 *
 * 骨架沿用第一期（命令条/左构建栏/画布/Inspector/执行抽屉，React Flow 仅作引擎），
 * 内容模型换成 workflow-v0.1.1：Prompt-first 自由节点图（无 Gate）、Structured
 * 阶段泳道 + 产物节点 + Gate 检查点。Gate 的确认只能由用户在检查器里对
 * 具体产物版本做出；演示运行永不代确认。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { UiIcon, SemIcons } from '@/shared/icons/UiIcon'
import { Clock, SlashCircle01 } from '@untitledui/icons'
import { ReactFlowProvider, useReactFlow, useNodesInitialized, type Edge } from '@xyflow/react'
import { type FmNode, RUN_STATUS_TXT } from '@/features/workflow/model/editorNodes'
import '@xyflow/react/dist/style.css'
import '@/features/workflow/styles/skill-presets.css'
import { type WorkflowLegacyDrafts } from '@/features/workflow/model/workflowTemplates'

import { workflowService, type WorkflowDef, type WorkflowRun, type WfArtifact } from '@/features/workflow/services/workflowService'
import type { TaskEvent } from '@/api/studioApi'
import { WorkflowProjectPicker } from '@/features/workflow/components/WorkflowProjectPicker'
import { WorkflowDraftsPanel } from '@/features/workflow/components/WorkflowDraftsPanel'
import { hasLegacyDrafts } from '@/features/workflow/services/workflowMigration'
import { formatApplyPresetSummary } from '@/features/workflow/services/workflowPresetBinding'
import { studioHttpApi } from '@/api'
import { upgradeLegacyPromptLayout, upgradeLegacyStructuredLayout } from '@/features/workflow/services/workflowGraph'
import { useNavigationGuard } from '@/shared/navigation/navigationGuardContext'
import { documentsStatus } from '@/shared/local-documents/localDocuments'
import { workflowRunLabel } from '@/features/workflow/services/workflowPresentation'
import { nid, toRfEdge } from '@/features/workflow/model/editorStorage'
import { runCapability } from '@/features/workflow/services/workflowCapabilities'
import { EditorMoreMenu } from '@/features/workflow/components/editor/EditorMoreMenu'
import { useDisplayedGraph } from '@/features/workflow/hooks/editor/useDisplayedGraph'
import { useEditorArtifacts } from '@/features/workflow/hooks/editor/useEditorArtifacts'
import { useEditorRun } from '@/features/workflow/hooks/editor/useEditorRun'
import { useGraphEditing } from '@/features/workflow/hooks/editor/useGraphEditing'
import { useEditorEffects } from '@/features/workflow/hooks/editor/useEditorEffects'
import { useEditorHistory } from '@/features/workflow/hooks/editor/useEditorHistory'
import { EditorRunDrawer } from '@/features/workflow/components/editor/EditorRunDrawer'
import { EditorInspectorPanel } from '@/features/workflow/components/editor/EditorInspectorPanel'
import { EditorCanvas } from '@/features/workflow/components/editor/EditorCanvas'
import { EditorBuildPanel } from '@/features/workflow/components/editor/EditorBuildPanel'

export function WorkflowEditor(props: { workflowId: string; onBack: () => void; autoRun?: boolean }) {
  return (
    <ReactFlowProvider>
      <EditorInner {...props} />
    </ReactFlowProvider>
  )
}

export interface EditorInnerProps { workflowId: string; onBack: () => void; autoRun?: boolean }

function EditorInner({ workflowId, onBack, autoRun }: EditorInnerProps) {
  const navigation = useNavigationGuard()
  const initial = useMemo(() => workflowService.getWorkflow(workflowId), [workflowId])
  const [workflow, setWorkflow] = useState<WorkflowDef | null>(initial)
  const [name, setName] = useState(initial?.name ?? '')
  const [nodes, setNodes] = useState<FmNode[]>(() => mapNodes(initial))
  const [edges, setEdges] = useState<Edge[]>(() =>
    (initial?.edges ?? []).map((e) => toRfEdge(e, initial?.nodes ?? [])),
  )
  const [dirty, setDirty] = useState(false)
  const [runNotice, setRunNotice] = useState('')
  const [leftTab, setLeftTab] = useState<'stages' | 'nodes' | 'pending'>(initial?.path === 'structured' ? 'stages' : 'nodes')
  /* 已有节点、窗口又不宽时先收起节点库，把宽度留给画布；空画布要靠节点库起步，照常打开 */
  const [panelOpen, setPanelOpen] = useState(() => window.innerWidth >= 1280 || (window.innerWidth >= 760 && !(initial?.nodes.length)))
  const [activeStage, setActiveStage] = useState<number | null>(initial?.path === 'structured' ? 0 : null)
  const [zoom, setZoom] = useState(1)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [drawerTab, setDrawerTab] = useState<'events' | 'outputs' | 'artifacts' | 'history'>('events')
  const [nodeQuery, setNodeQuery] = useState('')
  const [inspectorTab, setInspectorTab] = useState<'params' | 'inputs' | 'outputs'>('params')
  const [historyVersion, setHistoryVersion] = useState(0)
  const [running, setRunning] = useState(false)
  const [liveEvents, setLiveEvents] = useState<TaskEvent[]>([])
  const [lastRun, setLastRun] = useState<WorkflowRun | null>(() => workflowService.listRuns(workflowId)[0] ?? null)
  const [activeRunLabel, setActiveRunLabel] = useState('')
  const [viewing, setViewing] = useState<WfArtifact | null>(null)
  const [compact, setCompact] = useState(false)
  const [draftsOpen, setDraftsOpen] = useState(false)
  const [legacyDrafts, setLegacyDrafts] = useState<WorkflowLegacyDrafts | undefined>(() => initial?.legacyDrafts)
  const [integrityWarn, setIntegrityWarn] = useState<string | null>(null)
  const [, setPendingTick] = useState(0)
  const runHandle = useRef<{ cancel: () => void } | null>(null)
  const flow = useReactFlow()
  const nodesInitialized = useNodesInitialized()
  const initialFramed = useRef(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const focusRequest = useRef<string | null>(null)

  function mapNodes(wf: WorkflowDef | null): FmNode[] {
    if (!wf) return []
    return (wf.path === 'structured' ? upgradeLegacyStructuredLayout(wf.nodes) : upgradeLegacyPromptLayout(wf.nodes, wf.edges)).map((n) => ({
      id: n.id,
      type: n.type === 'lane' ? 'lane' : 'fm',
      position: n.position,
      parentId: n.parentId,
      hidden: n.hidden,
      style: n.type === 'lane' ? { width: n.width ?? 1020, height: n.height ?? 148 } : undefined,
      data: { defType: n.type, params: n.params, status: 'idle' as const },
    })) as FmNode[]
  }

  const selectedNode = nodes.find((n) => n.selected && n.type === 'fm')
  const selectedEdge = edges.find((e) => e.selected)
  const selectionId = selectedNode?.id
  useEffect(() => {
    setInspectorTab('params')
    if (selectionId && window.innerWidth < 1100) setPanelOpen(false)
  }, [selectionId])
  useEffect(() => {
    if (window.innerWidth < 1100 && panelOpen) return
    if (!selectionId || focusRequest.current !== selectionId) return
    const frame = requestAnimationFrame(() => {
      const node = flow.getInternalNode(selectionId)
      if (!node) return
      focusRequest.current = null
      const zoom = Math.min(1, Math.max(.8, flow.getZoom()))
      const rect = wrapRef.current?.getBoundingClientRect()
      if (!rect) return
      const available = rect.width - (window.innerWidth <= 1180 ? 340 : 0)
      const centerX = node.internals.positionAbsolute.x + (node.measured.width ?? 292) / 2
      const centerY = node.internals.positionAbsolute.y + (node.measured.height ?? 220) / 2
      void flow.setViewport({ x: Math.max(160, available / 2) - centerX * zoom, y: rect.height / 2 - centerY * zoom, zoom }, { duration: 180 })
    })
    return () => cancelAnimationFrame(frame)
  }, [selectionId, panelOpen, flow])

  /* 选中的节点被检查器（窄窗时浮在画布上）或画布边缘挡住时，平移到刚好露出来，不改缩放 */
  useEffect(() => {
    if (!selectionId) return
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        const node = flow.getInternalNode(selectionId)
        const canvas = wrapRef.current?.getBoundingClientRect()
        if (!node || !canvas) return
        const insp = document.querySelector<HTMLElement>('.wfe-inspector:not([hidden])')?.getBoundingClientRect()
        const right = insp && insp.left < canvas.right && insp.left > canvas.left ? insp.left : canvas.right
        const margin = 24
        const a = flow.flowToScreenPosition(node.internals.positionAbsolute)
        const b = flow.flowToScreenPosition({ x: node.internals.positionAbsolute.x + (node.measured.width ?? 240), y: node.internals.positionAbsolute.y + (node.measured.height ?? 160) })
        const dx = b.x > right - margin ? right - margin - b.x : a.x < canvas.left + margin ? canvas.left + margin - a.x : 0
        const dy = b.y > canvas.bottom - 72 ? canvas.bottom - 72 - b.y : a.y < canvas.top + margin ? canvas.top + margin - a.y : 0
        if (!dx && !dy) return
        const { x, y, zoom } = flow.getViewport()
        void flow.setViewport({ x: x + dx, y: y + dy, zoom }, { duration: 220 })
      })
    })
    return () => cancelAnimationFrame(frame)
  }, [selectionId, flow])

  const { redo, undo, markDirty, snapshot, fxIntents, refIds, refConsumed, undoStack, redoStack } = useEditorHistory({ edges, legacyDrafts, mapNodes, name, nodes, setDirty, setEdges, setHistoryVersion, setName, setNodes, setWorkflow, workflow })
  /* 画布快捷键（列表见 EditorMoreMenu）：输入框里打字时不拦截 */
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement
      if (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return
      const mod = event.ctrlKey || event.metaKey
      const key = event.key.toLowerCase()
      if (mod && key === 'z') {
        event.preventDefault()
        if (event.shiftKey) redo(); else undo()
      } else if (mod && key === 'd') {
        const picked = nodes.find((n) => n.selected && n.type === 'fm')
        if (!picked) return
        event.preventDefault()
        markDirty()
        const id = nid()
        setNodes((prev) => [...prev.map((n) => ({ ...n, selected: false })), { ...picked, id, selected: true, className: 'is-new', position: { x: picked.position.x + 36, y: picked.position.y + 36 }, data: { ...picked.data, params: structuredClone(picked.data.params), status: 'idle' } }])
      } else if (!mod && !event.altKey && key === 'f') {
        event.preventDefault()
        void flow.fitView({ padding: 0.16, minZoom: 0.2, maxZoom: 1, duration: 200 })
      } else if (!mod && event.key === '/') {
        event.preventDefault()
        setPanelOpen(true)
        setLeftTab('nodes')
        window.setTimeout(() => document.querySelector<HTMLInputElement>('.wfe-library-search input')?.focus(), 30)
      } else if (event.key === 'Escape') {
        setNodes((prev) => prev.some((n) => n.selected) ? prev.map((n) => ({ ...n, selected: false })) : prev)
        setEdges((prev) => prev.some((e) => e.selected) ? prev.map((e) => ({ ...e, selected: false })) : prev)
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [undo, redo, nodes, markDirty, flow])
  void historyVersion

  /* Gate 评估与泳道摘要注入节点数据（Gate 口径与首页一致，来自服务层 evaluateGate） */
  useEditorEffects({ edges, flow, initial, initialFramed, markDirty, nodes, nodesInitialized, setNodes, setPanelOpen, snapshot, wrapRef })

  const { addNode, updateParams, onConnect, onConnectStart, onConnectEnd, isValidConnection, connectMenu, connectCandidates, pickConnectCandidate, setConnectMenu, linking } = useGraphEditing({ edges, flow, focusRequest, markDirty, nodes, setActiveStage, setEdges, setNodes, workflow, wrapRef })

  const { doSave, doRun, doRunNode, clearLegacyDraftKey } = useEditorRun({ autoRun, dirty, legacyDrafts, markDirty, name, runHandle, running, setActiveRunLabel, setDirty, setDrawerOpen, setDrawerTab, setIntegrityWarn, setLastRun, setLegacyDrafts, setLiveEvents, setNodes, setRunNotice, setRunning, setViewing, setWorkflow, snapshot, workflow })

  /* 待处理资源 */
  const { runMatches, resumeSavedRun, awaitingDelivery, deliverSavedRun, goReview, addFxIntent, addRefSegment, latestRenderInfo, downloading, downloadArtifact } = useEditorArtifacts({ addNode, dirty, lastRun, nodes, runHandle, running, setActiveRunLabel, setDrawerOpen, setDrawerTab, setLastRun, setLiveEvents, setNodes, setPendingTick, setRunNotice, setRunning, updateParams, workflow, workflowId })

  const { displayedNodes, visibleEdges } = useDisplayedGraph({ activeStage, edges, lastRun, nodes, runMatches, running, workflow })

  if (!workflow) {
    return (
      <section className="wfe">
        <div className="wfe-cmd">
          <button type="button" className="wfe-iconbtn" onClick={onBack} aria-label="返回工作流首页"><UiIcon icon={SemIcons.back} size="md" /></button>
          <b>工作流不存在或已被删除</b>
        </div>
      </section>
    )
  }

  const isStructured = workflow.path === 'structured'
  const runCap = runCapability({ path: workflow.path, projectId: workflow.projectId })
  const saveError = !!documentsStatus().error
  const savePending = !!documentsStatus().pending
  const eventsToShow = running || liveEvents.length > 0 ? liveEvents : (lastRun?.events ?? [])
  const artifactsToShow = running ? [] : lastRun?.artifacts ?? []
  const selectedRunCaption = running ? activeRunLabel : lastRun ? `${workflowRunLabel(lastRun)} · 工作流 v${lastRun.revision} · ${RUN_STATUS_TXT[lastRun.status] ?? lastRun.status}` : ''
  const focusStage = (index: number | null) => {
    setActiveStage(index)
    setNodes((prev) => prev.map((n) => ({ ...n, selected: false })))
    window.setTimeout(() => { void flow.fitView({ nodes: flow.getNodes().filter((n) => n.type !== 'lane').map((n) => ({ id: n.id })), padding: 0.16, minZoom: 0.2, maxZoom: 1, duration: 250 }) }, 60)
  }
  const targetForRefs = isStructured
    ? nodes.some((n) => n.data.defType === 'artifact' && String(n.data.params.kind) === 'reference-log')
    : nodes.some((n) => n.data.defType === 'refs')

  return (
    <section className="wfe" aria-label="工作流编辑器" data-structured={workflow.path === 'structured' || undefined} data-stage-focused={isStructured && activeStage !== null || undefined} data-panel-open={panelOpen || undefined} data-inspecting={!!(selectedNode || selectedEdge) || undefined}>
      <div className="wfe-cmd">
        {/* 面包屑：工作流 / 名称（可直接改）· 版本与保存状态 */}
        <nav className="wfe-crumb" aria-label="位置">
          <button type="button" className="wfe-crumb-back" onClick={() => navigation.request(onBack)} title="返回工作流首页"><UiIcon icon={SemIcons.back} size="sm" />工作流</button>
          <span className="wfe-crumb-sep" aria-hidden="true">/</span>
          <span className="wfe-titleblock"><input className="wfe-name" value={name} onChange={(e) => { setName(e.target.value); markDirty() }} aria-label="工作流名称" maxLength={120} size={Math.max(4, Math.min(28, name.length + 1))} /></span>
          <span className="wfe-savestate" data-state={dirty ? 'dirty' : saveError ? 'error' : savePending ? 'pending' : 'saved'} title={dirty ? '有未保存的更改（Ctrl+S 保存）' : undefined}>
            <span className="wfe-revision">v{workflow.revision}</span>
            <i aria-hidden="true" />
            {dirty ? '未保存' : saveError ? '本机保存失败' : savePending ? '正在保存…' : '已保存'}
          </span>
        </nav>

        <span className="wfe-spacer" />
        {!running && lastRun?.definition && lastRun.projectId && lastRun.status === 'running' && <button type="button" className="wfe-btn" disabled={dirty} title={dirty ? '先保存工作流' : undefined} onClick={()=>resumeSavedRun()}>接回上次运行</button>}
        {!running && lastRun?.definition && lastRun.projectId && lastRun.status === 'failed' && <button type="button" className="wfe-btn" disabled={dirty} title={dirty ? '先保存工作流' : undefined} onClick={()=>resumeSavedRun(true)}>重试失败节点</button>}
        {!running && lastRun?.definition && lastRun.projectId && awaitingDelivery && <button type="button" className="wfe-btn" disabled={dirty} title={dirty ? '先保存工作流' : '读取最新审片结论，审片通过最新渲染时输出成片；不重新渲染'} onClick={deliverSavedRun}>按最新审片交付</button>}
        <WorkflowProjectPicker
          projectId={workflow.projectId}
          disabled={running}
          onChange={(projectId) => {
            markDirty()
            setWorkflow((prev) => prev ? { ...prev, projectId } : prev)
            if (projectId && workflow.skillPresetId) {
              const presetLabel = workflow.skillPresetMeta?.name || workflow.presetId
              void studioHttpApi().skillPresets.applyPresetToProject(projectId, workflow.skillPresetId)
                .then((res) => setRunNotice(formatApplyPresetSummary(presetLabel, res)))
                .catch((err) => setRunNotice(`预设没有写入项目：${err instanceof Error ? err.message : String(err)}`))
            }
          }}
        />
        <button type="button" className="wfe-iconbtn" aria-label="运行记录" title="运行记录" data-active={drawerOpen && drawerTab === 'history' || undefined} onClick={() => { setDrawerOpen(true); setDrawerTab('history') }}><UiIcon icon={Clock} size="md" /></button>
        <EditorMoreMenu
          showDrafts={!isStructured}
          draftsNeedMigration={!isStructured && hasLegacyDrafts({ legacyDrafts })}
          onOpenDrafts={() => setDraftsOpen(true)}
          projectLinked={!!workflow.projectId}
          onOpenWorkbench={goReview}
        />
        <i className="wfe-cmd-sep" aria-hidden="true" />
        <button type="button" className="wfe-btn wfe-save" title="保存（Ctrl+S）" onClick={doSave} disabled={!dirty || running}>保存</button>
        {running ? (
          <button type="button" className="wfe-btn wfe-run is-running" onClick={() => runHandle.current?.cancel()} title="请求停止这次运行">
            <UiIcon icon={SemIcons.loading} size="sm" className="wfe-spin" />运行中<span className="wfe-run-sep" />
            <UiIcon icon={SlashCircle01} size="sm" />取消
          </button>
        ) : (
          <>
            <span className="wfe-run-hint" data-real={runCap.real || undefined} title={runCap.detail}>{runCap.real ? <><i aria-hidden="true" />{runCap.label}</> : runCap.label}</span>
            <button type="button" className="wfe-btn is-primary wfe-run" onClick={doRun} title={runCap.detail}>
              <UiIcon icon={SemIcons.play} size="sm" />{isStructured ? '评估' : '运行'}
            </button>
          </>
        )}
      </div>

      {integrityWarn && <div className="wfe-run-alert is-warn" role="alert"><span>原始需求（prompt.original.md）检测存疑：{integrityWarn}</span><button type="button" aria-label="关闭原文警告" onClick={() => setIntegrityWarn(null)}><UiIcon icon={SemIcons.close} size="sm" /></button></div>}
      {hasLegacyDrafts({ legacyDrafts }) && !isStructured && (
        <div className="wfe-legacy-banner" role="status">
          <span>旧版画布中的工作稿（视觉构想 / 导演处理）已保留到迁移草稿中，尚未写入项目文件。</span>
          <button type="button" className="wfe-btn sm is-primary" onClick={() => setDraftsOpen(true)}>查看并写入工作稿</button>
        </div>
      )}
      {runNotice && <div className="wfe-run-alert" role="alert"><span>{runNotice}</span><button type="button" aria-label="关闭运行提示" onClick={() => setRunNotice('')}><UiIcon icon={SemIcons.close} size="sm" /></button></div>}
      <div className="wfe-body">
        <EditorBuildPanel
          activeStage={activeStage}
          addFxIntent={addFxIntent}
          addNode={addNode}
          addRefSegment={addRefSegment}
          focusStage={focusStage}
          fxIntents={fxIntents}
          isStructured={isStructured}
          leftTab={leftTab}
          nodeQuery={nodeQuery}
          nodes={nodes}
          panelOpen={panelOpen}
          refConsumed={refConsumed}
          refIds={refIds}
          setLeftTab={setLeftTab}
          setNodeQuery={setNodeQuery}
          setPanelOpen={setPanelOpen}
          targetForRefs={targetForRefs}
          workflowId={workflowId}
        />

        <EditorCanvas
          activeStage={activeStage}
          addNode={addNode}
          compact={compact}
          linking={linking}
          connectCandidates={connectCandidates}
          connectMenu={connectMenu}
          displayedNodes={displayedNodes}
          edges={edges}
          flow={flow}
          focusStage={focusStage}
          isStructured={isStructured}
          isValidConnection={isValidConnection}
          markDirty={markDirty}
          nodes={nodes}
          onConnect={onConnect}
          onConnectEnd={onConnectEnd}
          onConnectStart={onConnectStart}
          panelOpen={panelOpen}
          pickConnectCandidate={pickConnectCandidate}
          redo={redo}
          redoStack={redoStack}
          setCompact={setCompact}
          setConnectMenu={setConnectMenu}
          setEdges={setEdges}
          setLeftTab={setLeftTab}
          setNodes={setNodes}
          setPanelOpen={setPanelOpen}
          setRunNotice={setRunNotice}
          setZoom={setZoom}
          undo={undo}
          undoStack={undoStack}
          visibleEdges={visibleEdges}
          wrapRef={wrapRef}
          zoom={zoom}
        />

        <EditorInspectorPanel
          activeStage={activeStage}
          doRunNode={doRunNode}
          edges={edges}
          inspectorTab={inspectorTab}
          isStructured={isStructured}
          lastRun={lastRun}
          latestRenderInfo={latestRenderInfo}
          markDirty={markDirty}
          nodes={nodes}
          projectId={workflow.projectId}
          runMatches={runMatches}
          running={running}
          selectedEdge={selectedEdge}
          selectedNode={selectedNode}
          setActiveStage={setActiveStage}
          setEdges={setEdges}
          setInspectorTab={setInspectorTab}
          setNodes={setNodes}
          snapshot={snapshot}
          updateParams={updateParams}
        />
      </div>

      <EditorRunDrawer
        artifactsToShow={artifactsToShow}
        dirty={dirty}
        downloadArtifact={downloadArtifact}
        downloading={downloading}
        drawerOpen={drawerOpen}
        drawerTab={drawerTab}
        eventsToShow={eventsToShow}
        isStructured={isStructured}
        lastRun={lastRun}
        nodes={nodes}
        onLocateNode={(id) => { focusRequest.current = id; setNodes((prev) => prev.map((n) => ({ ...n, selected: n.id === id }))) }}
        runMatches={runMatches}
        running={running}
        selectedRunCaption={selectedRunCaption}
        setDrawerOpen={setDrawerOpen}
        setDrawerTab={setDrawerTab}
        setLastRun={setLastRun}
        setLiveEvents={setLiveEvents}
        setViewing={setViewing}
        viewing={viewing}
        workflowId={workflowId}
      />
      <WorkflowDraftsPanel
        open={draftsOpen}
        onClose={() => setDraftsOpen(false)}
        projectId={workflow.projectId}
        legacyDrafts={legacyDrafts}
        onClearLegacyDraft={clearLegacyDraftKey}
      />
    </section>
  )
}
