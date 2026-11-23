/**
 * 画布布局（纯函数、无依赖）：编辑器「整理」、新建模板的初始位置、首页缩略图共用。
 * 放在 model 下且不 import 别的模块，模板文件也能用而不形成循环引用。
 */

/**
 * 分层布局（编辑器「整理」与首页缩略图共用）：列 = 从源头数起的最长路径深度，
 * 同一列的节点从上往下排。默认每列整体垂直居中对齐最高的那一列；
 * align: 'top' 时各列顶边对齐（画布上卡片高矮不一，居中会排成锯齿）。纯函数，不改入参。
 */
export function layeredLayout(
  nodes: Array<{ id: string; height?: number }>,
  edges: Array<{ source: string; target: string }>,
  opts: { width: number; height: number; colGap: number; rowGap: number; align?: 'center' | 'top' },
): { positions: Record<string, { x: number; y: number }>; columns: number; width: number; height: number } {
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
  const cols = new Map<number, Array<{ id: string; h: number }>>()
  for (const node of nodes) {
    const col = level(node.id)
    cols.set(col, [...(cols.get(col) ?? []), { id: node.id, h: node.height ?? opts.height }])
  }
  const colHeight = (list: Array<{ h: number }>) => list.reduce((sum, n) => sum + n.h, 0) + Math.max(0, list.length - 1) * opts.rowGap
  const tallest = Math.max(0, ...[...cols.values()].map(colHeight))
  const positions: Record<string, { x: number; y: number }> = {}
  const columns = cols.size ? Math.max(...cols.keys()) + 1 : 0
  for (const [col, list] of cols) {
    let y = opts.align === 'top' ? 0 : (tallest - colHeight(list)) / 2
    for (const n of list) {
      positions[n.id] = { x: col * (opts.width + opts.colGap), y: Math.round(y) }
      y += n.h + opts.rowGap
    }
  }
  return { positions, columns, width: columns ? columns * opts.width + (columns - 1) * opts.colGap : 0, height: tallest }
}

/** 节点卡片的设计尺寸（workflow-nodes.css）：宽 240，高按类型估，量到真实高度时用真实高度 */
export const NODE_WIDTH = 240
const EST_HEIGHT: Record<string, number> = { prompt: 150, refs: 150, capability: 140, create: 258, review: 214, delivery: 236, artifact: 150, gate: 160 }
export const nodeHeightEstimate = (type: string) => EST_HEIGHT[type] ?? 130

/** 列间距留给连线弯过去，行间距让同列卡片不贴在一起 */
export const CANVAS_LAYOUT = { width: NODE_WIDTH, colGap: 72, rowGap: 28 }

/** 按连线分层排一张图，返回每个节点的左上角（原点 0,0） */
export function canvasLayout(nodes: Array<{ id: string; type?: string; height?: number }>, edges: Array<{ source: string; target: string }>) {
  const sized = nodes.map((n) => ({ id: n.id, height: n.height ?? nodeHeightEstimate(n.type ?? '') }))
  return layeredLayout(sized, edges, { ...CANVAS_LAYOUT, height: 130, align: 'top' }).positions
}
