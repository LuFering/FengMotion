import { persistLocalDocument } from '@/shared/local-documents/localDocuments'
import { migrateWorkflowDefinition } from '@/features/workflow/services/workflowMigration'
import { buildGraphFromSkillPreset, extractPresetMeta } from '@/features/workflow/services/workflowPresetBinding'
import { type WorkflowPreset } from '@/api/skillPresets'
import type { AgentReference } from '@/api/studioApi'
import { WORKFLOW_SCHEMA_VERSION, promptFirstGraph, structuredGraph, type WfEdgeInstance, type WfNodeInstance, type WfPath, type WorkflowLegacyDrafts } from '@/features/workflow/model/workflowTemplates'
import type { WorkflowDef, WorkflowRun } from '@/features/workflow/model/workflowTypes'

export const WF_KEY = 'fm-workflows-v2'

export const RUN_KEY = 'fm-workflow-runs-v2'

export let uidCounter = 0

export function uid(prefix: string): string {
  uidCounter += 1
  return `${prefix}-${Date.now().toString(36)}${uidCounter.toString(36)}`
}

export function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

export function writeJson(key: string, value: unknown): boolean {
  try { localStorage.setItem(key, JSON.stringify(value)); persistLocalDocument(key, value); return true }
  catch { return false }
}

export function writeWorkflows(list: WorkflowDef[]) {
  const versions=readJson<Array<WorkflowDef & {definitionId:string}>>('fm-workflow-versions-v1',[])
  for(const wf of list) {
    const id=`${wf.id}@${wf.revision}`
    if(!versions.some(v=>v.id===id))versions.push({...structuredClone(wf),definitionId:wf.id,id})
  }
  if(!writeJson('fm-workflow-versions-v1',versions))throw new Error('工作流版本快照未能保存')
  if (!writeJson(WF_KEY, list)) throw new Error('工作流未能保存。浏览器存储可能已满或被禁用，请释放空间后重试。')
}

export function seedWorkflows(): WorkflowDef[] {
  const now = new Date().toISOString()
  const pf = promptFirstGraph('talking')
  const st = structuredGraph()
  const brief = st.nodes.find((n) => n.id === 'a-intent-brief')
  if (brief) {
    brief.params = {
      kind: 'intent-brief',
      status: 'draft',
      version: 'v1',
      summary: '面向 AI 初学者讲清 Token 的定义、计费与上下文（演示快照，整理自项目既有口播稿与分镜基线）',
      fixture: true,
    }
  }
  return [
    {
      id: 'wf-token-pf',
      name: 'Token 科普视频',
      description: '默认路径：从提示词直接创作。带 Token 项目的真实素材引用作基线。',
      path: 'prompt-first',
      presetId: 'talking',
      projectId: 'token',
      revision: 1,
      schemaVersion: WORKFLOW_SCHEMA_VERSION,
      createdAt: now,
      updatedAt: now,
      nodes: pf.nodes,
      edges: pf.edges,
    },
    {
      id: 'wf-token-structured',
      name: 'Token 科普视频',
      description: '按需路径：阶段泳道 + Gate 检查点的演示骨架；产物状态如实为空缺起步。',
      path: 'structured',
      presetId: 'talking',
      projectId: 'token',
      revision: 1,
      schemaVersion: WORKFLOW_SCHEMA_VERSION,
      createdAt: now,
      updatedAt: now,
      nodes: st.nodes,
      edges: st.edges,
    },
  ]
}

export function loadRawWorkflows(): WorkflowDef[] {
  // An intentionally empty library must stay empty after deleting its last item.
  try {
    if (localStorage.getItem(WF_KEY) !== null) return readJson<WorkflowDef[]>(WF_KEY, [])
  } catch { return [] }
  const list = readJson<WorkflowDef[]>(WF_KEY, [])
  if (list.length === 0) {
    const seeded = seedWorkflows()
    writeJson(WF_KEY, seeded)
    return seeded
  }
  return list
}

export function loadWorkflows(): WorkflowDef[] {
  // 读取时仅做纯函数内存迁移，不回写存储；下次保存时再写回。
  return loadRawWorkflows().map((w) => migrateWorkflowDefinition(w))
}

export function loadRuns(): WorkflowRun[] {
  return readJson<WorkflowRun[]>(RUN_KEY, [])
}

export function saveRuns(runs: WorkflowRun[]) {
  if(!writeJson(RUN_KEY, runs.slice(0,60)))throw new Error('运行记录未能保存，请释放存储空间后重试。')
}

export const workflowService = {
  listWorkflows(): WorkflowDef[] {
    return loadWorkflows().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  },

  getWorkflow(id: string): WorkflowDef | null {
    return loadWorkflows().find((w) => w.id === id) ?? null
  },

  createEmpty(name = '未命名工作流'): WorkflowDef {
    const now = new Date().toISOString()
    const wf: WorkflowDef = { id: uid('wf'), name, description: '', path: 'prompt-first', presetId: 'general', projectId: null, revision: 1, schemaVersion: WORKFLOW_SCHEMA_VERSION, createdAt: now, updatedAt: now, nodes: [], edges: [] }
    const list = loadWorkflows()
    list.push(wf)
    writeWorkflows(list)
    return wf
  },

  createFromPath(
    path: WfPath,
    presetId: string,
    name?: string,
    opts?: { projectId?: string | null; seedPrompt?: string; resourceReferences?: AgentReference[] },
  ): WorkflowDef {
    const graph = path === 'prompt-first' ? promptFirstGraph(presetId) : structuredGraph()
    /* 创作启动层带入的用户需求：PF 写进提示词节点的 text（主干第一节点），
       同时全文留在 description 里，两条路径都可追溯原始需求。 */
    const seed = opts?.seedPrompt?.trim()
    if (seed && path === 'prompt-first') {
      const promptNode = graph.nodes.find((n) => n.type === 'prompt')
      if (promptNode) promptNode.params = { ...promptNode.params, text: seed }
    }
    const now = new Date().toISOString()
    const wf: WorkflowDef = {
      id: uid('wf'),
      name: name ?? (path === 'prompt-first' ? '未命名创作' : '未命名结构化制作'),
      description: seed ?? '',
      resourceReferences: opts?.resourceReferences ? structuredClone(opts.resourceReferences) : undefined,
      path,
      presetId,
      projectId: opts?.projectId ?? null,
      revision: 1,
      schemaVersion: WORKFLOW_SCHEMA_VERSION,
      createdAt: now,
      updatedAt: now,
      nodes: graph.nodes,
      edges: graph.edges,
    }
    const list = loadWorkflows()
    list.push(wf)
    writeWorkflows(list)
    return wf
  },

  createFromSkillPreset(
    preset: WorkflowPreset,
    name?: string,
    opts?: { projectId?: string | null; seedPrompt?: string; resourceReferences?: AgentReference[] },
  ): WorkflowDef {
    const graph = buildGraphFromSkillPreset(preset)
    /* 只带入用户的原话，不拼接骨架：骨架里没填的项写进 prompt.original.md 就成了「用户原文」。 */
    const seed = opts?.seedPrompt?.trim()
    if (seed) {
      const promptNode = graph.nodes.find((n) => n.type === 'prompt')
      if (promptNode) promptNode.params = { ...promptNode.params, text: seed }
    }
    const meta = extractPresetMeta(preset)
    const now = new Date().toISOString()
    const wf: WorkflowDef = {
      id: uid('wf'),
      name: name?.trim() || `${meta.name}工作流`,
      description: seed ?? (preset.description || preset.mapping.description || ''),
      resourceReferences: opts?.resourceReferences ? structuredClone(opts.resourceReferences) : undefined,
      path: 'prompt-first',
      presetId: meta.slug || preset.id,
      skillPresetId: preset.id,
      skillPresetMeta: meta,
      projectId: opts?.projectId ?? null,
      revision: 1,
      schemaVersion: WORKFLOW_SCHEMA_VERSION,
      createdAt: now,
      updatedAt: now,
      nodes: graph.nodes,
      edges: graph.edges,
    }
    const list = loadWorkflows()
    list.push(wf)
    writeWorkflows(list)
    return wf
  },

  saveWorkflow(
    id: string,
    patch: {
      name?: string
      description?: string
      projectId?: string | null
      nodes: WfNodeInstance[]
      edges: WfEdgeInstance[]
      legacyDrafts?: WorkflowLegacyDrafts | null
    },
  ): WorkflowDef | null {
    const list = loadWorkflows()
    const at = list.findIndex((w) => w.id === id)
    if (at < 0) return null
    const nextLegacy = patch.legacyDrafts === undefined ? list[at].legacyDrafts : patch.legacyDrafts
    const next: WorkflowDef = {
      ...list[at],
      name: patch.name ?? list[at].name,
      description: patch.description ?? list[at].description,
      projectId: patch.projectId === undefined ? list[at].projectId : patch.projectId,
      nodes: patch.nodes,
      edges: patch.edges,
      schemaVersion: WORKFLOW_SCHEMA_VERSION,
      revision: list[at].revision + 1,
      updatedAt: new Date().toISOString(),
    }
    if (nextLegacy && (nextLegacy.lookdev?.trim() || nextLegacy.filmplan?.trim())) {
      next.legacyDrafts = nextLegacy
    } else {
      delete next.legacyDrafts
    }
    list[at] = next
    writeWorkflows(list)
    return next
  },

  duplicateWorkflow(id: string): WorkflowDef | null {
    const src = loadWorkflows().find((w) => w.id === id)
    if (!src) return null
    const now = new Date().toISOString()
    const copy: WorkflowDef = {
      ...structuredClone(src),
      id: uid('wf'),
      name: `${src.name} · 副本`,
      revision: 1,
      createdAt: now,
      updatedAt: now,
    }
    const list = loadWorkflows()
    list.push(copy)
    writeWorkflows(list)
    return copy
  },

  deleteWorkflow(id: string) {
    writeWorkflows(loadWorkflows().filter((w) => w.id !== id))
  },

  listRuns(workflowId?: string): WorkflowRun[] {
    return loadRuns()
      .filter((r) => !workflowId || r.workflowId === workflowId)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
  },
}
