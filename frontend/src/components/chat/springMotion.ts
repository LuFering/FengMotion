/**
 * 弹簧动效公共库 —— 数值与算法逐行取自 LeiBox 官方 `ui/springMotion.ts`。
 *
 * 核心是 `springEase`：阻尼谐振子的解析解，
 *   1 - e^(-decay·t) · (cos(freq·t) + decay/freq · sin(freq·t))
 * 其中 decay = damping/2、freq = √(stiffness - decay²)。
 * 它比 CSS 的 cubic-bezier 更接近真弹簧：会过冲、会回弹收敛。
 *
 * 为什么不用 motion 的 spring：官方整套参数是按「给定 duration 的
 * 归一化缓动」设计的，motion 的 spring 以物理时长驱动，两者对不上，
 * 移植过来回弹幅度会不同。这里直接复刻同一套函数，观感才一致。
 */

/** 生成与官方同一条弹簧曲线。 */
export function springEase(stiffness: number, damping: number, duration: number) {
  const decay = damping / 2
  const frequency = Math.sqrt(Math.max(1e-6, stiffness - decay * decay))
  return (progress: number) => {
    if (progress === 0) return 0
    if (progress === 1) return 1
    const time = progress * duration
    return 1 - Math.exp(-decay * time)
      * (Math.cos(frequency * time) + (decay / frequency) * Math.sin(frequency * time))
  }
}

/** 系统是否要求减少动态效果。所有动效都要先问它。 */
export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** 菜单形变（打开）：宽度先走、高度延迟 57ms —— 官方 SHARE_MOTION.open */
export const SHARE_MOTION = {
  open: {
    width: { stiffness: 306.25, damping: 28, duration: 0.7, delay: 0 },
    height: { stiffness: 196, damping: 18.34, duration: 0.86, delay: 0.057 },
  },
  close: {
    width: { stiffness: 400, damping: 33, duration: 0.64, delay: 0.07 },
    height: { stiffness: 600.25, damping: 40, duration: 0.62, delay: 0 },
  },
  resize: { stiffness: 280, damping: 24, duration: 0.64 },
} as const

/** 通用展开/收起弹簧（SpringDisclosure 用） */
export const SOFT_SPRING = { stiffness: 360, damping: 34, duration: 0.42 } as const

/** 按钮按压：按下压到 0.97，松开用这条弹回 1 */
export const PRESS_MOTION = {
  downScale: 0.97,
  downDuration: 0.075,
  upDuration: 0.38,
  upStiffness: 420,
  upDamping: 24,
} as const

/** 附件卡片入场：从 y+6 / scale .96 弹进来 */
export const ITEM_MOTION = {
  enterStiffness: 360,
  enterDamping: 24,
  enterDuration: 0.42,
  enterY: 6,
  enterScale: 0.96,
  exitDuration: 0.16,
  exitScale: 0.95,
} as const
