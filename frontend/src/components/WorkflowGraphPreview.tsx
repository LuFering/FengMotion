import { memo } from 'react'
import { defForNode, type WfEdgeInstance, type WfNodeInstance } from '../data/workflowTemplates'

/** Saved graph geometry only: no player, timers or second React Flow instance. */
export const WorkflowGraphPreview = memo(function WorkflowGraphPreview({ nodes, edges }: {
  nodes: WfNodeInstance[]
  edges: WfEdgeInstance[]
}) {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const absolute = (n: WfNodeInstance, seen = new Set<string>()): { x: number; y: number } => {
    if (!n.parentId || seen.has(n.id)) return n.position
    seen.add(n.id)
    const parent = byId.get(n.parentId)
    if (!parent) return n.position
    const p = absolute(parent, seen)
    return { x: p.x + n.position.x, y: p.y + n.position.y }
  }
  const items = nodes.filter((n) => n.type !== 'lane').map((node) => ({ node, x: absolute(node).x * 0.36, y: absolute(node).y * 0.36 }))
  if (!items.length) return <div className="wf-graph-empty"><svg viewBox="0 0 160 64" aria-hidden="true"><rect x="48" y="10" width="64" height="44" rx="8"/><path d="M72 32h16m-8-8v16"/></svg><span>空白画布</span></div>
  const minX = Math.min(...items.map((n) => n.x)) - 15
  const minY = Math.min(...items.map((n) => n.y)) - 20
  const width = Math.max(...items.map((n) => n.x)) - minX + 125
  const height = Math.max(...items.map((n) => n.y)) - minY + 78
  const positions = new Map(items.map((n) => [n.node.id, n]))
  return <svg className="wf-graph-preview" viewBox={`${minX} ${minY} ${width} ${height}`} aria-hidden="true">
    {edges.map((edge) => {
      const a = positions.get(edge.source), b = positions.get(edge.target)
      if (!a || !b) return null
      const x1 = a.x + 110, y1 = a.y + 26, x2 = b.x, y2 = b.y + 26
      const curve = Math.max(15, Math.abs(x2 - x1) / 2)
      return <path className="wf-mini-edge" key={edge.id} d={`M${x1},${y1} C${x1 + curve},${y1} ${x2 - curve},${y2} ${x2},${y2}`}/>
    })}
    {items.map(({ node, x, y }) => <g key={node.id} transform={`translate(${x},${y})`}>
      <rect className="wf-mini-node" width="110" height="52" rx="6"/>
      <rect className="wf-mini-mark" x="10" y="11" width="8" height="8" rx="2"/>
      <text x="25" y="20">{(defForNode(node)?.label ?? node.type).slice(0, 8)}</text>
      <path className="wf-mini-line" d="M11 32h64m-64 8h43"/>
      {edges.some((e) => e.target === node.id) && <circle cx="0" cy="26" r="2.5"/>}
      {edges.some((e) => e.source === node.id) && <circle cx="110" cy="26" r="2.5"/>}
    </g>)}
  </svg>
})
