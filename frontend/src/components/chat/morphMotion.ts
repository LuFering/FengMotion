/**
 * 菜单「形变」动效参数 —— 逐值取自 LeiBox 官方实现的 GSAP 配置。
 *
 * 原版用 GSAP 对面板的 width / height 分别做弹簧动画，两组参数不同，
 * 因而出现「先横向展开、纵向略带回弹」的连续形变。之前本项目是 CSS
 * 瞬切（display + opacity），所以看起来生硬。
 *
 * 这里保留同样的数值语义，但改用项目已有的 `motion` 库：
 * 弹簧用 spring(stiffness, damping)，时长/延迟由 transition 表达。
 */
export const MORPH = {
  open: {
    width: { stiffness: 306.25, damping: 28, duration: 0.7, delay: 0 },
    height: { stiffness: 196, damping: 18.34, duration: 0.86, delay: 0.057 },
  },
  close: {
    width: { stiffness: 400, damping: 33, duration: 0.64, delay: 0.07 },
    height: { stiffness: 600.25, damping: 40, duration: 0.62, delay: 0 },
  },
  /** 面板内容重排（模型列表长度变化时） */
  resize: { stiffness: 280, damping: 24, duration: 0.64 },
} as const

/** 连续圆角：与原版 continuousCorners 相同的平滑系数。 */
export const CORNER = { radius: 24, smoothing: 0.6, scale: 1.6 } as const
