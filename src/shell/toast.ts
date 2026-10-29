/**
 * 轻提示 —— 全应用一套。
 *
 * 为什么不让各视图自己 setState 弹一条：素材库和外壳各弹各的，同一时刻会出现
 * 两条 toast 叠在一起（实测：素材库那条盖住了「当前没有打开的对话」这条，
 * 于是用户点了没反应、也没有任何解释）。收成一条总线，谁都能发，只有一处渲染。
 */
const EVENT = 'fm-toast'

export function toast(text: string) {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: text }))
}

export function onToast(handler: (text: string) => void) {
  const listener = (e: Event) => handler((e as CustomEvent<string>).detail)
  window.addEventListener(EVENT, listener)
  return () => window.removeEventListener(EVENT, listener)
}
