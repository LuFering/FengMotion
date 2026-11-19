import type * as React from 'react'
import { useCallback, useEffect, useRef } from 'react'
import { documentsStatus, flushLocalDocuments } from '@/shared/local-documents/localDocuments'
import { workflowService, startDemoRun, startSingleNodeRun, type WorkflowRun, type WfArtifact, type WorkflowDef } from '@/features/workflow/services/workflowService'
import { studioHttpApi } from '@/api'
import type { WorkflowLegacyDrafts } from '@/features/workflow/model/workflowTemplates'
import { useUnsavedEditor } from '@/shared/navigation/navigationGuardContext'
import { workflowGraphProblems } from '@/features/workflow/services/workflowGraph'
import type { EditorInnerProps } from '@/features/workflow/WorkflowEditor'
import type { TaskEvent } from '@/api/studioApi'
import type { FmNode } from '@/features/workflow/model/editorNodes'

export interface UseEditorRunArgs {
  autoRun: EditorInnerProps['autoRun']
  dirty: boolean
  legacyDrafts: WorkflowLegacyDrafts | undefined
  markDirty: () => void
  name: string
  runHandle: React.RefObject<{ cancel: () => void } | null>
  running: boolean
  setActiveRunLabel: React.Dispatch<React.SetStateAction<string>>
  setDirty: React.Dispatch<React.SetStateAction<boolean>>
  setDrawerOpen: React.Dispatch<React.SetStateAction<boolean>>
  setDrawerTab: React.Dispatch<React.SetStateAction<'events' | 'outputs' | 'artifacts' | 'history'>>
  setIntegrityWarn: React.Dispatch<React.SetStateAction<string | null>>
  setLastRun: React.Dispatch<React.SetStateAction<WorkflowRun | null>>
  setLegacyDrafts: React.Dispatch<React.SetStateAction<WorkflowLegacyDrafts | undefined>>
  setLiveEvents: React.Dispatch<React.SetStateAction<TaskEvent[]>>
  setNodes: React.Dispatch<React.SetStateAction<FmNode[]>>
  setRunNotice: React.Dispatch<React.SetStateAction<string>>
  setRunning: React.Dispatch<React.SetStateAction<boolean>>
  setViewing: React.Dispatch<React.SetStateAction<WfArtifact | null>>
  setWorkflow: React.Dispatch<React.SetStateAction<WorkflowDef | null>>
  snapshot: () => WorkflowDef | null
  workflow: WorkflowDef | null
}

/**
 * 工作流编辑器的保存与运行：保存（含 Ctrl+S 与离开前提示）、整图运行与单节点运行，带 autoRun 进入时自动跑一次；
 * 另检查项目原始需求文件的完整性，并清理旧版草稿字段。
 */
export function useEditorRun({ autoRun, dirty, legacyDrafts, markDirty, name, runHandle, running, setActiveRunLabel, setDirty, setDrawerOpen, setDrawerTab, setIntegrityWarn, setLastRun, setLegacyDrafts, setLiveEvents, setNodes, setRunNotice, setRunning, setViewing, setWorkflow, snapshot, workflow }: UseEditorRunArgs) {
  const doSave = useCallback(() => {
    if(documentsStatus().error){setRunNotice('本机记录尚有保存冲突，请先导出副本并重新核对。');return false}
    const snap = snapshot()
    if (!snap) return false
    try {
      const saved = workflowService.saveWorkflow(snap.id, {
        name: snap.name,
        projectId: snap.projectId,
        nodes: snap.nodes,
        edges: snap.edges,
        legacyDrafts: legacyDrafts ?? null,
      })
      if (!saved) { setRunNotice('工作流已不存在，无法保存。请返回工作流首页核对。'); return false }
      setWorkflow(saved)
      setLegacyDrafts(saved.legacyDrafts)
      setDirty(false)
      setRunNotice('')
      return true
    } catch (error) { setRunNotice(error instanceof Error ? error.message : '保存失败，请重试。'); return false }
  }, [snapshot, legacyDrafts])

  useEffect(() => {
    const pid = workflow?.projectId
    if (!pid) { setIntegrityWarn(null); return }
    let alive = true
    void studioHttpApi().workflowContext.state(pid)
      .then((st) => {
        if (!alive) return
        if (st.originalIntegrity === 'suspect') {
          setIntegrityWarn(st.originalIntegrityReasons?.length ? st.originalIntegrityReasons.join('；') : '检测到 prompt.original.md 疑似存在重复段落或模板标题混入（只报告不自动修改）。')
        } else {
          setIntegrityWarn(null)
        }
      })
      .catch(() => { if (alive) setIntegrityWarn(null) })
    return () => { alive = false }
  }, [workflow?.projectId])

  const clearLegacyDraftKey = useCallback((key: keyof WorkflowLegacyDrafts) => {
    setLegacyDrafts((prev) => {
      if (!prev) return undefined
      const next: WorkflowLegacyDrafts = { ...prev }
      delete next[key]
      const normalized = next.lookdev?.trim() || next.filmplan?.trim() ? next : undefined
      if (!dirty && workflow) {
        const snap = snapshot()
        if (snap) {
          try {
            const saved = workflowService.saveWorkflow(snap.id, {
              name: snap.name,
              projectId: snap.projectId,
              nodes: snap.nodes,
              edges: snap.edges,
              legacyDrafts: normalized ?? null,
            })
            if (saved) setWorkflow(saved)
          } catch { /* ignore */ }
        }
      } else {
        markDirty()
      }
      return normalized
    })
  }, [dirty, workflow, snapshot, markDirty])

  useUnsavedEditor({ name, dirty, canSave: !running, save:async()=>{if(!doSave())return false;try{await flushLocalDocuments();return true}catch(error){setDirty(true);throw error}} })

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        if (dirty && !running) doSave()
      }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [doSave, dirty, running])

  const doRun = useCallback(() => {
    const snap = snapshot()
    if (!snap || running) return
    if (dirty) { setRunNotice('请先保存工作流，再运行当前版本。'); return }
    const problems = workflowGraphProblems(snap.nodes, snap.edges, { validateInputs: snap.path !== 'structured' })
    if (problems.length) {
      setRunNotice(problems[0].message)
      if (problems[0].nodeId) setNodes((prev) => prev.map((n) => ({ ...n, selected: n.id === problems[0].nodeId })))
      return
    }
    setRunNotice('')
    setRunning(true)
    setActiveRunLabel(`${snap.path === 'structured' ? '状态评估' : snap.projectId ? '项目运行' : '演示运行'} · 工作流 v${snap.revision}`)
    setLiveEvents([])
    setViewing(null)
    setDrawerOpen(true)
    setDrawerTab('events')
    setNodes((prev) => prev.map((n) => (n.type === 'fm' ? { ...n, data: { ...n.data, status: 'pending' as const } } : n)))
    const handle = startDemoRun(snap, {
      onEvent: (e) => setLiveEvents((prev) => [...prev, e]),
      onNodeStatus: (nodeId, status) =>
        setNodes((prev) => prev.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, status } } : n))),
      /* 工作流自带所属项目：编辑器里跑的时候也要真实建立创作上下文，
         否则「在工作流里创作」与「在工作台里创作」会是两种行为。
         prompt 必须一起带上 ——「创作需求」节点的文本就是用户的原始需求，
         只传 projectId 会让后端收到空需求，运行直接被拒。 */
      projectId: snap.projectId ?? undefined,
      prompt: String(snap.nodes.find((n) => n.type === 'prompt')?.params.text ?? '') || undefined,
    })
    runHandle.current = handle
    void handle.done.then((run) => {
      setLastRun(run)
      setRunning(false)
      runHandle.current = null
      if (run.status === 'completed') setDrawerTab('artifacts')
    })
  }, [snapshot, running, dirty])

  /* 创作启动层快速路径：带 autoRun 进来时，工作流载入后自动跑一次（仅一次） */
  const autoRanRef = useRef(false)
  useEffect(() => {
    if (!autoRun || !workflow || autoRanRef.current) return
    autoRanRef.current = true
    doRun()
  }, [autoRun, workflow, doRun])

  /* 单节点运行（检查器「只运行此节点 / 评估此节点」） */
  const doRunNode = useCallback(
    (nodeId: string) => {
      const snap = snapshot()
      if (!snap || running) return
      if (dirty) { setRunNotice('请先保存工作流，再运行当前版本。'); return }
      setRunNotice('')
      setRunning(true)
      setActiveRunLabel(`${snap.path === 'structured' ? '状态评估' : '单节点演示'} · 工作流 v${snap.revision}`)
      setLiveEvents([])
      setDrawerOpen(true)
      setDrawerTab('events')
      setViewing(null)
      setNodes((prev) => prev.map((n) => ({ ...n, data: { ...n.data, status: 'idle' as const } })))
      const handle = startSingleNodeRun(snap, nodeId, {
        onEvent: (e) => setLiveEvents((prev) => [...prev, e]),
        onNodeStatus: (id, status) =>
          setNodes((prev) => prev.map((n) => (n.id === id ? { ...n, data: { ...n.data, status } } : n))),
      })
      runHandle.current = handle
      void handle.done.then((run) => {
        setLastRun(run)
        setRunning(false)
        runHandle.current = null
      })
    },
    [snapshot, running, dirty],
  )
  return { doSave, doRun, doRunNode, clearLegacyDraftKey }
}
