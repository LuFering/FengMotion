

/* ── 官方弹层形变动效（composer-engine.js 的 Z1 + t1 + a1）──────────
   原版是 GSAP 时间线：外层从**触发元素的矩形**长成卡片矩形，
   width / height 各跑一条弹簧，圆角与底色 0.22s 收口。
   这里把同一组弹簧参数翻成 WAAPI 关键帧 —— WAAPI 不接受函数式缓动，
   但可以用 offset + 线性插值精确复现同一条弹簧曲线。 */

/** 官方 t1：hover 展开 / 收回两条不同的弹簧（stiffness, damping, duration(s), delay(s)）。 */
export const MORPH = {
  open: {
    width: { stiffness: 306.25, damping: 28, duration: 0.7, delay: 0 },
    height: { stiffness: 196, damping: 18.34, duration: 0.86, delay: 0.057 },
  },
  close: {
    width: { stiffness: 400, damping: 33, duration: 0.64, delay: 0.07 },
    height: { stiffness: 600.25, damping: 40, duration: 0.62, delay: 0 },
  },
} as const

/** 官方 a1：欠阻尼弹簧的单位阶跃响应，秒为单位推进。 */
export function springEase(stiffness: number, damping: number, duration: number) {
  const decay = damping / 2
  const freq = Math.sqrt(Math.max(1, stiffness - decay * decay))
  return (t: number) => {
    if (t <= 0) return 0
    if (t >= 1) return 1
    const e = t * duration
    return 1 - Math.exp(-decay * e) * (Math.cos(freq * e) + (decay / freq) * Math.sin(freq * e))
  }
}

/** 生成一条属性的弹簧关键帧（from → to），offset 均匀采样。 */
export function springKeyframes(
  prop: 'width' | 'height',
  from: number,
  to: number,
  cfg: { stiffness: number; damping: number; duration: number },
  steps = 40,
) {
  const ease = springEase(cfg.stiffness, cfg.damping, cfg.duration)
  const frames: Record<string, string | number>[] = []
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    frames.push({ offset: t, [prop]: `${from + (to - from) * ease(t)}px` })
  }
  return frames
}
