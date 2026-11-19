import type * as React from 'react'
import { readJson, FX_OUTBOX_KEY, REF_CONSUMED_KEY, type FxIntent } from '@/features/workflow/model/editorStorage'
import { pfDefaultParams } from '@/features/workflow/model/workflowTemplates'
import { REFERENCE_SEGMENTS, REFERENCE_VIDEOS } from '@/features/reference/model/referenceLibrary'
import { useState, useMemo } from 'react'
import { retryFailedProjectRun, resumeProjectRun, deliverProjectRun, workflowService, type WfArtifact, type WorkflowRun, type WorkflowDef } from '@/features/workflow/services/workflowService'
import { workflowArtifactMedia } from '@/features/workflow/services/workflowGraph'
import { runMatchesDefinition } from '@/features/workflow/services/workflowPresentation'
import type { FmNode } from '@/features/workflow/model/editorNodes'
import type { TaskEvent } from '@/api/studioApi'
import type { EditorInnerProps } from '@/features/workflow/WorkflowEditor'

export interface UseEditorArtifactsArgs {
  addNode: (defType: string, params: Record<string, unknown>, at?: { x: number; y: number }) => string
  dirty: boolean
  lastRun: WorkflowRun | null
  nodes: FmNode[]
  runHandle: React.RefObject<{ cancel: () => void } | null>
  running: boolean
  setActiveRunLabel: React.Dispatch<React.SetStateAction<string>>
  setDrawerOpen: React.Dispatch<React.SetStateAction<boolean>>
  setDrawerTab: React.Dispatch<React.SetStateAction<'events' | 'outputs' | 'artifacts' | 'history'>>
  setLastRun: React.Dispatch<React.SetStateAction<WorkflowRun | null>>
  setLiveEvents: React.Dispatch<React.SetStateAction<TaskEvent[]>>
  setNodes: React.Dispatch<React.SetStateAction<FmNode[]>>
  setPendingTick: React.Dispatch<React.SetStateAction<number>>
  setRunNotice: React.Dispatch<React.SetStateAction<string>>
  setRunning: React.Dispatch<React.SetStateAction<boolean>>
  updateParams: (nodeId: string, patch: Record<string, unknown>) => void
  workflow: WorkflowDef | null
  workflowId: EditorInnerProps['workflowId']
}

/**
 * 工作流编辑器的待接入资源与运行产物：把技法意向、参考片段接入画布节点，下载产物，继续、重试或交付已保存的项目运行；
 * 并判断上次运行是否与当前版本匹配、给出最近一次的渲染信息。
 */
export function useEditorArtifacts({ addNode, dirty, lastRun, nodes, runHandle, running, setActiveRunLabel, setDrawerOpen, setDrawerTab, setLastRun, setLiveEvents, setNodes, setPendingTick, setRunNotice, setRunning, updateParams, workflow, workflowId }: UseEditorArtifactsArgs) {
  /* 待处理资源 */
  const addFxIntent = (intent: FxIntent) => {
    const capNode = nodes.find((n) => n.data.defType === 'capability')
    if (capNode) {
      const ids = (capNode.data.params.techniqueIds as string[] | undefined) ?? []
      if (!ids.includes(intent.techniqueId)) updateParams(capNode.id, { techniqueIds: [...ids, intent.techniqueId] })
    } else {
      const id = addNode('capability', pfDefaultParams('capability'))
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
    if (workflow?.path === 'structured') {
      const logNode = nodes.find((n) => n.data.defType === 'artifact' && String(n.data.params.kind) === 'reference-log')
      if (!logNode) return
      const seg = REFERENCE_SEGMENTS.find((s) => s.id === segmentId)
      const film = seg ? REFERENCE_VIDEOS.find((v) => v.id === seg.videoId) : null
      const line = `引用片段：${film ? `${film.title} · 片段 ${(seg?.index ?? 0) + 1}` : segmentId}（来自参考片库意向清单）`
      const prev = String(logNode.data.params.summary ?? '')
      updateParams(logNode.id, {
        summary: prev ? `${prev}\n${line}` : line,
        status: String(logNode.data.params.status ?? 'missing') === 'missing' ? 'draft' : String(logNode.data.params.status),
      })
    } else {
      const refsNode = nodes.find((n) => n.data.defType === 'refs')
      if (!refsNode) return
      const ids = (refsNode.data.params.refSegmentIds as string[] | undefined) ?? []
      if (!ids.includes(segmentId)) updateParams(refsNode.id, { refSegmentIds: [...ids, segmentId] })
    }
    const map = readJson<Record<string, string>>(REF_CONSUMED_KEY, {})
    map[segmentId] = workflowId
    try { localStorage.setItem(REF_CONSUMED_KEY, JSON.stringify(map)) } catch { /* ignore */ }
    setPendingTick((t) => t + 1)
  }

  const [downloading, setDownloading] = useState(false)
  const downloadArtifact = async (a: WfArtifact) => {
    if (downloading) return
    setDownloading(true)
    try {
      const media = workflowArtifactMedia(a)
      if (!a.demo && !media) throw new Error('产物没有可读取的文件地址。')
      let blob: Blob
      if (media) {
        const response = await fetch(media)
        if (!response.ok) throw new Error(`文件读取失败（HTTP ${response.status}）`)
        blob = await response.blob()
        if (!blob.size || !blob.type.startsWith('video/')) throw new Error('文件为空或不是有效视频。')
      } else blob = new Blob([a.content], { type: 'application/json;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = a.demo ? (a.filename.endsWith('.json') ? a.filename : `${a.filename}.json`) : a.filename
      link.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 30000)
      setRunNotice(media ? '已获取产物，已发起下载。' : '已发起记录下载。')
    } catch (error) { setRunNotice(error instanceof Error ? error.message : '下载失败，请重试。') }
    finally { setDownloading(false) }
  }

  const goReview = () => {
    if (workflow?.projectId) window.postMessage({ type: 'fm-nav', id: 'production', projectId: workflow.projectId }, '*')
  }
  const resumeSavedRun = (retry=false) => {
    if(!lastRun || running || dirty)return
    setRunning(true);setActiveRunLabel(`继续项目运行 · 工作流 v${lastRun.revision}`);setLiveEvents([]);setDrawerOpen(true)
    const handle=(retry?retryFailedProjectRun:resumeProjectRun)(lastRun,{onEvent:e=>setLiveEvents(prev=>[...prev,e]),onNodeStatus:(id,status)=>setNodes(prev=>prev.map(n=>n.id===id?{...n,data:{...n.data,status}}:n))})
    runHandle.current=handle
    void handle.done.then(run=>{setLastRun(run);setRunning(false);runHandle.current=null;setDrawerTab('artifacts')})
  }

  /* 审片通过后从这里交付：读当前保存的审片结论，不重新渲染。 */
  const deliverSavedRun = () => {
    if(!lastRun || running || dirty)return
    let handle:ReturnType<typeof deliverProjectRun>
    try{
      handle=deliverProjectRun(lastRun,workflowService.getWorkflow(lastRun.workflowId),{onEvent:e=>setLiveEvents(prev=>[...prev,e]),onNodeStatus:(id,status)=>setNodes(prev=>prev.map(n=>n.id===id?{...n,data:{...n.data,status}}:n))})
    }catch(error){setRunNotice(error instanceof Error?error.message:'无法继续交付');return}
    setRunNotice('');setRunning(true);setActiveRunLabel(`按最新审片继续交付 · 工作流 v${lastRun.revision}`);setLiveEvents([]);setDrawerOpen(true)
    runHandle.current=handle
    void handle.done.then(run=>{setLastRun(run);setRunning(false);runHandle.current=null;setDrawerTab('events')})
  }
  const awaitingDelivery = lastRun?.status === 'awaiting_info' && Object.values(lastRun.nodeIO ?? {}).some((io) => io.outputs?.status === 'awaiting_review')

  const runMatches = runMatchesDefinition(lastRun, workflow, dirty)

  const latestRenderInfo = useMemo(() => {
    if (!lastRun || !runMatches) return null
    const renderArt = lastRun.artifacts.find((a) => a.kind === 'render' && !a.demo)
    if (renderArt) {
      try {
        const parsed = JSON.parse(renderArt.content) as { version?: number; artifactPath?: string; runId?: string }
        return {
          version: parsed.version ?? null,
          artifactPath: parsed.artifactPath ?? null,
          runId: parsed.runId ?? lastRun.id,
        }
      } catch {
        return { version: null, artifactPath: null, runId: lastRun.id }
      }
    }
    const createNode = nodes.find((n) => n.data.defType === 'create')
    if (createNode && lastRun.nodeStatus[createNode.id] === 'completed') {
      return { version: null, artifactPath: null, runId: lastRun.id }
    }
    return null
  }, [lastRun, runMatches, nodes])
  return { runMatches, resumeSavedRun, awaitingDelivery, deliverSavedRun, goReview, addFxIntent, addRefSegment, latestRenderInfo, downloading, downloadArtifact }
}
