import { memo } from 'react'
import { BaseEdge, EdgeLabelRenderer, useInternalNode, type EdgeProps } from '@xyflow/react'

/**
 * 「返工」提示线：从审片节点底部绕到制作节点底部的一条弧线（只画不存，图保持无环）。
 * 以前用 smoothstep 连两个端口，线从卡片中间横穿、标签压在线上；改成走在两张卡片下方。
 * 线是很淡的细实线，弧底一个回转记号；只有审片判了「需要修改」才变琥珀色并带文字。
 */
export const ReworkEdge = memo(function ReworkEdge({ id, source, target, data, markerEnd }: EdgeProps) {
  const from = useInternalNode(source)
  const to = useInternalNode(target)
  if (!from || !to) return null
  const fw = from.measured.width ?? 240, fh = from.measured.height ?? 140
  const tw = to.measured.width ?? 240, th = to.measured.height ?? 140
  const fx = from.internals.positionAbsolute.x + fw / 2, fy = from.internals.positionAbsolute.y + fh
  const tx = to.internals.positionAbsolute.x + tw / 2, ty = to.internals.positionAbsolute.y + th
  const low = Math.max(fy, ty) + 46
  const path = `M${fx},${fy} C${fx},${low} ${tx},${low} ${tx},${ty + 4}`
  const active = !!(data as { active?: boolean } | undefined)?.active
  /* 三次贝塞尔在 t=0.5 处的 y = (fy + 3·low + 3·low + ty) / 8 */
  const labelX = (fx + tx) / 2, labelY = (fy + 6 * low + ty) / 8
  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} className="wfe-rework-path" style={{ stroke: active ? 'var(--warn)' : 'color-mix(in srgb, var(--tx) 22%, transparent)', strokeWidth: active ? 1.5 : 1 }} />
      <EdgeLabelRenderer>
        <span className="wfe-rework-label nodrag nopan" data-active={active || undefined} title="审片判定需要修改时，下次运行回到制作" style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}>
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8a4.5 4.5 0 1 0 1.4-3.3M3.5 2.5v2.6h2.6" /></svg>
          {active ? '下次运行返工' : '返工'}
        </span>
      </EdgeLabelRenderer>
    </>
  )
})
