/**
 * 对话区共用的动效常量。
 *
 * 数值取自 BoardUI 的 Task List / Agent Message 实现（Pro 组件，无源码，
 * 从它站点上编译后的 chunk 里读出来的原值），不是目测：
 *   SOFT_EASE = [.22, 1, .36, 1]
 *   单元入场  height .38 / opacity .42 / filter .42 / y .42 / 遮罩 .44
 *
 * 单独抽出来的原因：TaskList、消息正文、工作台对话三处都要用同一条曲线。
 * 各写一份的话，改一处就漏一处，最后看起来像三种不同的动效。
 */

/** BoardUI 的统一缓动：起步快、收尾极缓，适合「长出来」而不是「弹出来」 */
export const SOFT_EASE = [0.22, 1, 0.36, 1] as const

/**
 * 底部渐隐遮罩用到的自定义属性。
 *
 * 用 CSS 变量而不是直接改 mask 字符串：Motion 只能对数值属性做补间，
 * 而遮罩要跟着高度一起从 22px 收到 0，否则内容长出来时下半截是被硬切的。
 */
export const REVEAL_FADE_VAR = '--fm-reveal-fade'

const FADE = REVEAL_FADE_VAR
const maskImage = `linear-gradient(to bottom, #000 calc(100% - var(${FADE}, 0px)), transparent calc(100% + 1px))`

/** 生长单元的初始态：高度 0、下移 4px、模糊 6px、底部遮罩 22px */
export const UNIT_INITIAL = {
  opacity: 0,
  height: 0,
  y: 4,
  filter: 'blur(6px)',
  [FADE]: '22px',
}

/** 生长单元的终态 */
export const UNIT_ANIMATE = {
  opacity: 1,
  height: 'auto',
  y: 0,
  filter: 'blur(0px)',
  [FADE]: '0px',
}

/** 生长单元的过渡：高度稍快，遮罩稍慢，末帧才不出硬边 */
export const UNIT_TRANSITION = {
  height: { duration: 0.38, ease: SOFT_EASE },
  opacity: { duration: 0.42, ease: SOFT_EASE },
  filter: { duration: 0.42, ease: SOFT_EASE },
  y: { duration: 0.42, ease: SOFT_EASE },
  [FADE]: { duration: 0.44, ease: SOFT_EASE },
}

/** 遮罩只在首次生长时挂上，动画结束即摘掉 —— 否则文字永远带一层渐隐 */
export const REVEAL_MASK_STYLE = {
  WebkitMaskImage: maskImage,
  maskImage,
}
