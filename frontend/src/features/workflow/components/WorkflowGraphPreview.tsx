import { memo } from 'react'
import type * as React from 'react'
import { ARTIFACT_KIND_MAP, defForNode, type WfEdgeInstance, type WfNodeInstance } from '@/features/workflow/model/workflowTemplates'
import { NODE_COPY } from '@/features/workflow/model/editorNodes'
import { nodeCategory } from '@/features/workflow/model/nodeCategories'
import { layeredLayout } from '@/features/workflow/model/graphLayout'

/* 每个节点是一格「小分镜」：上面 56×36 的画框（约 16:10），下面一行 10px 名称 */
const FRAME = { w: 56, h: 36 }
const NODE = { width: FRAME.w, height: 50, colGap: 18, rowGap: 10 }
/* 节点太多（分阶段工作流 22 个）时只画小方格和连线，不放字 */
const COMPACT = { width: 18, height: 12, colGap: 9, rowGap: 5 }
const COMPACT_ABOVE = 8

const labelOf = (node: WfNodeInstance) =>
  NODE_COPY[node.type]?.title
  ?? (node.type === 'artifact' ? ARTIFACT_KIND_MAP[String(node.params.kind ?? '')]?.label : undefined)
  ?? defForNode(node, { includeLegacy: true })?.label
  ?? node.type

/**
 * 画框里画的是这个节点「产出什么」：需求是一页字，参考是一组拼片，制作是一块带播放键的画面，
 * 审片是取景框，交付是打了勾的成片。看一眼就知道这条工作流从什么做到什么。
 */
function FrameGlyph({ type }: { type: string }) {
  const { w, h } = FRAME
  const box = <rect className="wf-sb-frame" x="0.5" y="0.5" width={w - 1} height={h - 1} rx="4" />
  switch (type) {
    case 'prompt':
      return <>{box}<path className="wf-sb-ink" d="M9 11h36M9 17h30M9 23h20" /></>
    case 'refs':
      return <>{[0, 1, 2, 3].map((i) => <rect key={i} className="wf-sb-tile" data-i={i} x={i % 2 ? 29 : 1} y={i < 2 ? 1 : 19} width="26" height="16" rx="3" />)}</>
    case 'capability':
      return <><rect className="wf-sb-frame" x="9.5" y="2.5" width="37" height="22" rx="3" opacity=".45" /><rect className="wf-sb-frame" x="5.5" y="6.5" width="45" height="25" rx="3" opacity=".7" /><rect className="wf-sb-frame" x="1.5" y="10.5" width="53" height="25" rx="3" /><path className="wf-sb-mark" d="M22 23l4 -4 4 4 4 -4" /></>
    case 'create':
      return <><rect className="wf-sb-screen" x="0.5" y="0.5" width={w - 1} height={h - 1} rx="4" /><path className="wf-sb-play" d="M24 12.5v11l9 -5.5z" /></>
    case 'review':
      return <><rect className="wf-sb-screen" x="0.5" y="0.5" width={w - 1} height={h - 1} rx="4" /><path className="wf-sb-mark" d="M8 13v-5h6M42 8h6v5M48 23v5h-6M14 28h-6v-5" /></>
    case 'delivery':
      return <><rect className="wf-sb-done" x="0.5" y="0.5" width={w - 1} height={h - 1} rx="4" /><path className="wf-sb-mark" d="M21 18.5l5 5 9 -10" /></>
    case 'artifact':
      return <><path className="wf-sb-frame" d="M14.5 .5h20l7 7v28h-27z" /><path className="wf-sb-ink" d="M19 15h18M19 21h18M19 27h11" /></>
    case 'gate':
      return <path className="wf-sb-gate" d="M28 3l15 15 -15 15 -15 -15z" />
    default:
      return box
  }
}

/**
 * 工作流结构缩略图：不挂 React Flow、不读保存的坐标，按连线关系重新分层排，
 * 所以同一种结构不管用户在画布上怎么摆，卡片上看起来都一样整齐。
 */
export const WorkflowGraphPreview = memo(function WorkflowGraphPreview({ nodes, edges }: {
  nodes: WfNodeInstance[]
  edges: WfEdgeInstance[]
}) {
  const items = nodes.filter((n) => n.type !== 'lane' && !n.hidden)
  if (!items.length) {
    return <div className="wf-graph-empty"><svg viewBox="0 0 56 36" aria-hidden="true"><rect x="0.5" y="0.5" width="55" height="35" rx="4" /><path d="M24 18h8m-4-4v8" /></svg><span>空白画布</span></div>
  }
  const compact = items.length > COMPACT_ABOVE
  const size = compact ? COMPACT : NODE
  const midY = compact ? COMPACT.height / 2 : FRAME.h / 2
  const ids = new Set(items.map((n) => n.id))
  const links = edges.filter((e) => ids.has(e.source) && ids.has(e.target))
  const layout = layeredLayout(items, links, size)
  const pad = 2
  /* 列号：卡片悬停时连线按列依次亮起（workflow-library.css「悬停」一节） */
  const colOf = (id: string) => Math.round(layout.positions[id].x / (size.width + size.colGap))
  return (
    <svg className="wf-graph-preview" data-compact={compact || undefined}
         viewBox={`${-pad} ${-pad} ${layout.width + pad * 2} ${layout.height + pad * 2}`} preserveAspectRatio="xMidYMid meet" aria-hidden="true"
         /* 撑满容器、等比缩放；最多放大到自然尺寸的 1.7 倍，两三个节点的小图不会被放得很粗 */
         style={{ '--nw': layout.width + pad * 2 } as React.CSSProperties}>
      {links.map((edge) => {
        const a = layout.positions[edge.source], b = layout.positions[edge.target]
        const x1 = a.x + size.width, y1 = a.y + midY, x2 = b.x, y2 = b.y + midY
        const c = Math.max(5, (x2 - x1) / 2)
        const d = `M${x1 + 2},${y1} C${x1 + c},${y1} ${x2 - c},${y2} ${x2 - 2},${y2}`
        /* 底线常驻；亮线叠在上面，平时不显示，悬停时描出来 */
        return <g key={edge.id}><path className="wf-sb-edge" d={d} /><path className="wf-sb-trace" pathLength={1} style={{ '--col': colOf(edge.source) } as React.CSSProperties} d={d} /></g>
      })}
      {items.map((node) => {
        const { x, y } = layout.positions[node.id]
        return (
          <g key={node.id} className="wf-sb" data-cat={nodeCategory(node.type)} transform={`translate(${x},${y})`} style={{ '--col': colOf(node.id) } as React.CSSProperties}>
            {compact
              ? <rect className="wf-sb-cell" x="0.5" y="0.5" width={size.width - 1} height={size.height - 1} rx="2.5" />
              : <><FrameGlyph type={node.type} /><text x={FRAME.w / 2} y={FRAME.h + 10} textAnchor="middle">{labelOf(node).slice(0, 5)}</text></>}
          </g>
        )
      })}
    </svg>
  )
})
