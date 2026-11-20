import type { ElementInspector } from '@/features/workbench/hooks/stage/useElementInspector'
import type { NormRect } from '@/features/workbench/model/elementEdit'
import '@/features/workbench/styles/workbench/element-edit.css'

/**
 * 叠在画面上的元素标注层：只画，不接指针（指针由舞台在捕获阶段统一处理）。
 *
 * <p>暂停时淡淡描出这一帧可点选的元素，悬停的那个加深并标上名字；
 * 选中后换成实线框加四角标记；点在没有元素的地方画一个落点，拖拽时画框选。
 * 所有位置都按画面实际矩形（扣掉黑边）换算。</p>
 */
export function ElementLayer({ inspector }: { inspector: ElementInspector }) {
  const { frameBox, paused, enabled, visibleNow, hovered, target, dragRect, declared } = inspector
  if (!enabled || !frameBox || frameBox.width <= 0) return null
  const place = (r: NormRect) => ({
    left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%`,
  })
  const selectedId = target?.kind === 'element' ? target.element.id : null
  return (
    <div className="el-layer" aria-hidden="true"
         style={{ left: frameBox.left, top: frameBox.top, width: frameBox.width, height: frameBox.height }}>
      {/* 可点选的元素：暂停时才描，播放时画面干干净净 */}
      {paused && visibleNow.map((el) => el.id === selectedId ? null : (
        <div key={el.id} className="el-box" data-hover={el.id === hovered || undefined} style={place(el.placement!.bounds)}>
          {el.id === hovered && <span className="el-tag">{el.label}</span>}
        </div>
      ))}

      {target?.kind === 'element' && target.element.placement && (
        <div className="el-box" data-selected="" style={place(target.element.placement.bounds)}>
          <i className="el-corner" data-c="tl" /><i className="el-corner" data-c="tr" />
          <i className="el-corner" data-c="bl" /><i className="el-corner" data-c="br" />
          <span className="el-tag">{target.element.label} · 文字</span>
        </div>
      )}

      {target?.kind === 'point' && (
        <span className="el-point" style={{ left: `${target.point.x * 100}%`, top: `${target.point.y * 100}%` }} />
      )}

      {target?.kind === 'region' && (
        <div className="el-region" data-selected="" style={place(target.rect)}>
          <span className="el-tag">框选区域</span>
        </div>
      )}
      {dragRect && <div className="el-region" style={place(dragRect)} />}

      {/* 暂停且什么都没选时，告诉用户这块画面能怎么用 */}
      {paused && !target && !dragRect && (
        <span className="el-hint">
          {declared && visibleNow.length > 0 ? '点选元素编辑 · 拖拽框选区域' : '点选或框选画面，交给 AI 修改'}
        </span>
      )}
    </div>
  )
}
