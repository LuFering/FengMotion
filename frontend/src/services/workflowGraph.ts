import { defForNode, type WfEdgeInstance, type WfNodeInstance } from '../data/workflowTemplates'

/** Validate the same saved graph the editor will run; no writes or execution. */
export function workflowGraphProblems(nodes: WfNodeInstance[], edges: WfEdgeInstance[], options = { validateInputs: true }): Array<{ nodeId?: string; message: string }> {
  const items = nodes.filter((n) => n.type !== 'lane')
  if (!items.length) return [{ message: '画布上还没有节点，请先添加节点。' }]
  const problems: Array<{ nodeId?: string; message: string }> = []
  const ids = new Map(items.map((n) => [n.id, n]))
  if (ids.size !== items.length) return [{ message: '节点标识重复，请复制为新的节点后重试。' }]
  const occupied = new Set<string>()
  for (const edge of edges) {
    const source = ids.get(edge.source), target = ids.get(edge.target)
    const out = source && defForNode(source)?.outputs.find((p) => p.id === edge.sourcePort)
    const input = target && defForNode(target)?.inputs.find((p) => p.id === edge.targetPort)
    if (!out || !input || out.type !== input.type) problems.push({ nodeId: target?.id, message: '存在失效或类型不兼容的连线，请重新连接。' })
    const key = `${edge.target}:${edge.targetPort}`
    if (occupied.has(key)) problems.push({ nodeId: edge.target, message: '同一输入端口只能连接一个来源。' })
    occupied.add(key)
  }
  for (const node of items) {
    const def = defForNode(node)
    if (!def) { problems.push({ nodeId: node.id, message: '存在无法识别的节点，请移除后重新添加。' }); continue }
    for (const port of def.inputs.filter((p) => p.required && options.validateInputs)) {
      if (!edges.some((e) => e.target === node.id && e.targetPort === port.id)) problems.push({ nodeId: node.id, message: `「${def.label}」缺少「${port.label}」输入，请连接上游节点。` })
    }
    if (node.type === 'prompt' && !String(node.params.text ?? '').trim()) problems.push({ nodeId: node.id, message: '请在「创作需求」节点填写原始提示词。' })
  }
  const degrees = new Map(items.map((n) => [n.id, 0]))
  for (const edge of edges) if (ids.has(edge.source) && ids.has(edge.target)) degrees.set(edge.target, degrees.get(edge.target)! + 1)
  const ready = items.filter((n) => degrees.get(n.id) === 0).map((n) => n.id)
  let visited = 0
  while (ready.length) {
    const id = ready.shift()!; visited++
    for (const edge of edges.filter((e) => e.source === id && ids.has(e.target))) {
      const degree = degrees.get(edge.target)! - 1
      degrees.set(edge.target, degree)
      if (degree === 0) ready.push(edge.target)
    }
  }
  if (visited !== items.length) problems.push({ message: '连线形成了循环，请断开循环后再运行。' })
  return problems
}

export function workflowArtifactMedia(artifact: { demo: boolean; content: string } | null | undefined): string | null {
  if (!artifact || artifact.demo) return null
  try {
    const value = JSON.parse(artifact.content)
    return typeof value.file === 'string' && /^(https?:\/\/|blob:|\/)/.test(value.file) ? value.file : null
  } catch { return null }
}

/** Pure layout: Strict Mode may invoke a React updater twice. */
export function workflowLayoutPositions(nodes: Array<{ id: string; height?: number }>, edges: Array<{ source: string; target: string }>): Record<string, { x: number; y: number }> {
  const ids = new Set(nodes.map((n) => n.id))
  const levels = new Map<string, number>(), visiting = new Set<string>()
  const level = (id: string): number => {
    if (levels.has(id)) return levels.get(id)!
    if (visiting.has(id)) return 0
    visiting.add(id)
    const incoming = edges.filter((e) => e.target === id && ids.has(e.source))
    const depth = incoming.length ? Math.max(...incoming.map((e) => level(e.source))) + 1 : 0
    visiting.delete(id); levels.set(id, depth)
    return depth
  }
  const rows = new Map<number, number>()
  const positions: Record<string, { x: number; y: number }> = {}
  for (const node of nodes) {
    const col = level(node.id), y = rows.get(col) ?? 0
    rows.set(col, y + (node.height ?? 280) + 64)
    positions[node.id] = { x: col * 390, y }
  }
  return positions
}

/** Only migrate the old generated layout; manually positioned graphs remain untouched. */
export function upgradeLegacyStructuredLayout(nodes: WfNodeInstance[]): WfNodeInstance[] {
  const lanes = nodes.filter((n) => n.type === 'lane')
  if (!lanes.length || !lanes.every((n) => n.height === 148 && n.position.x === 30 && n.position.y === 30 + Number(n.params.stage) * 166)) return nodes
  const stages = new Map(lanes.map((n) => [n.id, Number(n.params.stage)]))
  // Preserve graphs whose children or gates were manually moved, even if lanes were not.
  for (const lane of lanes) {
    const children = nodes.filter((n) => n.parentId === lane.id)
    if (!children.every((n, i) => n.type === 'artifact' && n.position.x === 24 + i * 252 && n.position.y === 44)) return nodes
  }
  for (const gate of nodes.filter((n) => n.type === 'gate')) {
    const stage = ({ ref: 2, A: 3, B: 4, C: 5, D: 7 } as Record<string, number>)[String(gate.params.gate)]
    if (stage === undefined || gate.position.x !== 816 || gate.position.y !== 161 + stage * 166) return nodes
  }
  return nodes.map((n) => {
    if (n.type === 'lane') return { ...n, position: { x: 30, y: 30 + Number(n.params.stage) * 350 }, width: 1240, height: 300 }
    if (n.parentId && stages.has(n.parentId)) return { ...n, position: { x: 24 + Math.round((n.position.x - 24) / 252) * 276, y: 56 } }
    if (n.type === 'gate') {
      const gate = String(n.params.gate)
      const stage = ({ ref: 2, A: 3, B: 4, C: 5, D: 7 } as Record<string, number>)[gate]
      if (stage !== undefined) return { ...n, position: { x: 920, y: 86 + stage * 350 } }
    }
    return n
  })
}
