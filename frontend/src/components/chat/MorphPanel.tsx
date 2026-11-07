/**
 * MorphPanel —— 从触发器「长出来」的菜单面板。
 *
 * 行为对照 LeiBox 官方 MorphingMenuShell：
 *   · 打开时宽度先走（stiffness 306.25 / damping 28 / 0.7s），
 *     高度延迟 57ms 再走（196 / 18.34 / 0.86s）——
 *     两者参数不同才有那种「先横向拉开、再纵向舒展开」的连续感
 *   · 关闭时反过来，高度更快（600.25 / 40 / 0.62s），宽度延迟 70ms
 *   · 面板从触发器的对齐边开始生长（align='left' 从左，'right' 从右）
 *   · 透明度与缩放同步渐显，圆角用连续圆角（24 × 1.6）
 *
 * 之前用 CSS display 瞬切 + 无过渡，观感是「啪」地出现，很生硬。
 */

import { AnimatePresence, motion } from 'motion/react'
import type { ReactNode } from 'react'
import { MORPH } from './morphMotion'
import './morph-panel.css'

export interface MorphPanelProps {
  open: boolean
  /** 面板宽度 */
  width: number
  /** 对齐方向：从左还是从右长出 */
  align?: 'left' | 'right'
  children: ReactNode
  className?: string
}

export function MorphPanel({ open, width, align = 'left', children, className }: MorphPanelProps) {
  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className={`morph-panel${className ? ` ${className}` : ''}`}
          data-align={align}
          initial={{ opacity: 0, scaleX: 0.72, scaleY: 0.6, borderRadius: 32 }}
          animate={{ opacity: 1, scaleX: 1, scaleY: 1, borderRadius: 26 }}
          exit={{ opacity: 0, scaleX: 0.8, scaleY: 0.7, borderRadius: 32 }}
          /* 宽高分开的两套弹簧：宽度快、高度慢且有回弹，
             对应原版 open.width 与 open.height 的不同参数 */
          transition={{
            opacity: { duration: 0.22, ease: 'easeOut' },
            scaleX: {
              type: 'spring',
              stiffness: MORPH.open.width.stiffness,
              damping: MORPH.open.width.damping,
            },
            scaleY: {
              type: 'spring',
              stiffness: MORPH.open.height.stiffness,
              damping: MORPH.open.height.damping,
              delay: MORPH.open.height.delay,
            },
            borderRadius: { duration: 0.3, ease: 'easeOut' },
          }}
          style={{
            width,
            transformOrigin: align === 'right' ? 'bottom right' : 'bottom left',
          }}
        >
          {children}
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}

export default MorphPanel
