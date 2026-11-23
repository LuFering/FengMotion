/**
 * 轻提示 —— 全应用一套。
 *
 * 为什么不让各视图自己 setState 弹一条：素材库和外壳各弹各的，同一时刻会出现
 * 两条 toast 叠在一起（实测：素材库那条盖住了「当前没有打开的对话」这条，
 * 于是用户点了没反应、也没有任何解释）。收成一条总线，谁都能发，只有一处渲染。
 *
 * 可撤销的操作（加入 / 移出待发送、收藏、删除片段、移至项目）带上 action：
 *   toast('已加入待发送', { action: { label: '撤销', run: () => remove(id) } })
 * 带动作的提示停留更久，点一次即关闭。
 */
const EVENT = 'fm-toast'

export interface ToastAction {
  label: string
  run: () => void
}

export interface ToastOptions {
  action?: ToastAction
  /** 停留毫秒数；默认纯文字 2400、带动作 5000 */
  duration?: number
}

export interface ToastMessage extends ToastOptions {
  id: number
  text: string
}

let seq = 0

export function toast(text: string, options: ToastOptions = {}) {
  const detail: ToastMessage = { id: ++seq, text, ...options }
  window.dispatchEvent(new CustomEvent<ToastMessage>(EVENT, { detail }))
}

export function toastDuration(msg: ToastMessage): number {
  return msg.duration ?? (msg.action ? 5000 : 2400)
}

export function onToast(handler: (msg: ToastMessage) => void) {
  const listener = (e: Event) => handler((e as CustomEvent<ToastMessage>).detail)
  window.addEventListener(EVENT, listener)
  return () => window.removeEventListener(EVENT, listener)
}
