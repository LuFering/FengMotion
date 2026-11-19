import type * as React from 'react'
import { readJson, FX_OUTBOX_KEY, REF_OUTBOX_KEY, REF_CONSUMED_KEY, toRfEdge, type FxIntent } from '@/features/workflow/model/editorStorage'
import { useCallback, useRef } from 'react'
import type { WorkflowDef } from '@/features/workflow/services/workflowService'
import type { Edge } from '@xyflow/react'
import type { WorkflowLegacyDrafts } from '@/features/workflow/model/workflowTemplates'
import type { FmNode } from '@/features/workflow/model/editorNodes'

export interface UseEditorHistoryArgs {
  edges: Edge[]
  legacyDrafts: WorkflowLegacyDrafts | undefined
  mapNodes: (wf: WorkflowDef | null) => FmNode[]
  name: string
  nodes: FmNode[]
  setDirty: React.Dispatch<React.SetStateAction<boolean>>
  setEdges: React.Dispatch<React.SetStateAction<Edge[]>>
  setHistoryVersion: React.Dispatch<React.SetStateAction<number>>
  setName: React.Dispatch<React.SetStateAction<string>>
  setNodes: React.Dispatch<React.SetStateAction<FmNode[]>>
  setWorkflow: React.Dispatch<React.SetStateAction<WorkflowDef | null>>
  workflow: WorkflowDef | null
}

/** 从 WorkflowEditor.tsx 的 EditorInner 原样搬出的一段状态与逻辑；参数与返回值和原处的变量同名。 */
export function useEditorHistory({ edges, legacyDrafts, mapNodes, name, nodes, setDirty, setEdges, setHistoryVersion, setName, setNodes, setWorkflow, workflow }: UseEditorHistoryArgs) {
  const fxIntents = readJson<FxIntent[]>(FX_OUTBOX_KEY, [])
  const refIds = readJson<string[]>(REF_OUTBOX_KEY, [])
  const refConsumed = readJson<Record<string, string>>(REF_CONSUMED_KEY, {})

  const snapshot = useCallback((): WorkflowDef | null => {
    if (!workflow) return null
    return {
      ...workflow,
      name,
      legacyDrafts,
      nodes: nodes.map((n) => ({
        id: n.id,
        type: n.data.defType,
        position: n.position,
        params: n.data.params,
        parentId: n.parentId,
        width: n.type === 'lane' ? (n.style?.width as number | undefined) ?? 1020 : undefined,
        height: n.type === 'lane' ? (n.style?.height as number | undefined) ?? 148 : undefined,
        hidden: n.hidden,
      })),
      edges: edges.map((e) => ({
        id: e.id,
        source: e.source,
        sourcePort: e.sourceHandle ?? '',
        target: e.target,
        targetPort: e.targetHandle ?? '',
      })),
    }
  }, [workflow, name, nodes, edges, legacyDrafts])

  const undoStack = useRef<WorkflowDef[]>([])
  const redoStack = useRef<WorkflowDef[]>([])
  const lastHistoryKey = useRef('')
  const markDirty = useCallback(() => {
    const previous = snapshot()
    if (previous) {
      const key = JSON.stringify([previous.name, previous.nodes, previous.edges])
      if (key !== lastHistoryKey.current) {
        undoStack.current.push(structuredClone(previous))
        if (undoStack.current.length > 60) undoStack.current.shift()
        lastHistoryKey.current = key
        redoStack.current = []
        setHistoryVersion((v) => v + 1)
      }
    }
    setDirty(true)
  }, [snapshot])
  const restoreSnapshot = useCallback((value: WorkflowDef) => {
    setWorkflow((prev) => prev ? { ...prev, projectId: value.projectId } : prev)
    setName(value.name)
    setNodes(mapNodes(value))
    setEdges(value.edges.map((edge) => toRfEdge(edge, value.nodes)))
    lastHistoryKey.current = ''
    setDirty(true)
    setHistoryVersion((v) => v + 1)
  }, [])
  const undo = useCallback(() => {
    const previous = undoStack.current.pop()
    const current = snapshot()
    if (!previous || !current) return
    redoStack.current.push(structuredClone(current))
    restoreSnapshot(previous)
  }, [snapshot, restoreSnapshot])
  const redo = useCallback(() => {
    const next = redoStack.current.pop()
    const current = snapshot()
    if (!next || !current) return
    undoStack.current.push(structuredClone(current))
    restoreSnapshot(next)
  }, [snapshot, restoreSnapshot])
  return { redo, undo, markDirty, snapshot, fxIntents, refIds, refConsumed, undoStack, redoStack }
}
