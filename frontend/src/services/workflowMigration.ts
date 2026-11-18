import {
  WORKFLOW_SCHEMA_VERSION,
  type WfEdgeInstance,
  type WfNodeInstance,
  type WorkflowLegacyDrafts,
} from '../data/workflowTemplates'

export interface MigratableWorkflow {
  schemaVersion?: number
  nodes: WfNodeInstance[]
  edges: WfEdgeInstance[]
  legacyDrafts?: WorkflowLegacyDrafts
}

function extractDraftText(node: WfNodeInstance): string {
  const p = node.params ?? {}
  if (typeof p.summary === 'string' && p.summary.trim()) return p.summary.trim()
  if (typeof p.text === 'string' && p.text.trim()) return p.text.trim()
  const parts = Object.entries(p)
    .filter(([k, v]) => k !== 'status' && typeof v === 'string' && v.trim())
    .map(([, v]) => (v as string).trim())
  return parts.join('\n')
}

function mergeDraftTexts(existing: string | undefined, extracted: string[]): string | undefined {
  const pieces = [existing?.trim(), ...extracted.map((s) => s.trim())].filter((x): x is string => Boolean(x))
  if (pieces.length === 0) return undefined
  const unique: string[] = []
  for (const item of pieces) {
    if (!unique.includes(item)) unique.push(item)
  }
  return unique.join('\n\n')
}

export function hasLegacyDrafts(wf: { legacyDrafts?: WorkflowLegacyDrafts } | null | undefined): boolean {
  if (!wf?.legacyDrafts) return false
  return Boolean(wf.legacyDrafts.lookdev?.trim() || wf.legacyDrafts.filmplan?.trim())
}

/**
 * 纯函数迁移（不做任何 IO，不修改入参）：
 * 1. 删掉 lookdev、filmplan 节点和它们的连线，原来填的文字保留在 legacyDrafts；
 * 2. 把 finishing 转成 delivery，保留原节点 ID 和兼容端口；
 * 3. 设置 schemaVersion = 2。
 */
export function migrateWorkflowDefinition<T extends MigratableWorkflow>(wf: T): T {
  const hasLegacyNodes = wf.nodes.some(
    (n) => n.type === 'lookdev' || n.type === 'filmplan' || n.type === 'finishing',
  )
  if ((wf.schemaVersion ?? 1) >= WORKFLOW_SCHEMA_VERSION && !hasLegacyNodes) {
    return wf
  }

  const lookdevTexts: string[] = []
  const filmplanTexts: string[] = []
  const removedIds = new Set<string>()

  for (const node of wf.nodes) {
    if (node.type === 'lookdev') {
      removedIds.add(node.id)
      const text = extractDraftText(node)
      if (text) lookdevTexts.push(text)
    } else if (node.type === 'filmplan') {
      removedIds.add(node.id)
      const text = extractDraftText(node)
      if (text) filmplanTexts.push(text)
    }
  }

  const nextLookdev = mergeDraftTexts(wf.legacyDrafts?.lookdev, lookdevTexts)
  const nextFilmplan = mergeDraftTexts(wf.legacyDrafts?.filmplan, filmplanTexts)
  const nextLegacyDrafts: WorkflowLegacyDrafts | undefined =
    nextLookdev || nextFilmplan
      ? {
          ...(nextLookdev ? { lookdev: nextLookdev } : {}),
          ...(nextFilmplan ? { filmplan: nextFilmplan } : {}),
        }
      : undefined

  const nextNodes: WfNodeInstance[] = wf.nodes
    .filter((n) => !removedIds.has(n.id))
    .map((n) => {
      if (n.type === 'finishing') {
        return {
          ...n,
          type: 'delivery',
          params: structuredClone(n.params ?? {}),
        }
      }
      return {
        ...n,
        position: { ...n.position },
        params: structuredClone(n.params ?? {}),
      }
    })

  const nextEdges: WfEdgeInstance[] = wf.edges
    .filter((e) => !removedIds.has(e.source) && !removedIds.has(e.target))
    .map((e) => ({ ...e }))

  const migrated: T = {
    ...wf,
    schemaVersion: WORKFLOW_SCHEMA_VERSION,
    nodes: nextNodes,
    edges: nextEdges,
  }
  if (nextLegacyDrafts) {
    migrated.legacyDrafts = nextLegacyDrafts
  } else {
    delete migrated.legacyDrafts
  }
  return migrated
}
