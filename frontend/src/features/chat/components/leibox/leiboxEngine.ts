

/** 官方暴露的挂载工厂。 */
export type MountFn = (el: HTMLElement, options?: Record<string, unknown>) => {
  destroy?: () => void
  update?: (options: Record<string, unknown>) => void
}

/**
 * 把文本写进官方组件的受控 textarea。
 *
 * <p><strong>为什么不能直接 `textarea.value = text`</strong>：官方输入框是
 * 受控组件（bundle 里 `value: ne` + `onChange: Cse`），真正显示内容的是
 * 它上方那层镜像 div（`data-message-composer-content`），而镜像由内部 state 驱动。
 * 只改 DOM 的 value 不动 state，镜像仍是空的 —— 用户看到的还是空输入框。
 * 必须先走原生 value setter，再派发冒泡的 input 事件，React 才会把值收进 state。</p>
 *
 * @returns 是否写入成功
 */
/** 程序化写入期间置位：此时触发的 input 事件不是用户操作，不应推进输入轮次。 */
let programmaticWrite = false
/** 当前这次输入是不是程序写入（不是用户打字）。 */
export const isProgrammaticWrite = () => programmaticWrite

export function writeComposerText(textarea: HTMLTextAreaElement, text: string): boolean {
  if (textarea.value === text) return true
  const descriptor = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype,
    'value',
  )
  if (!descriptor?.set) return false
  /* 绕开 React 挂在自己实例上的 value 拦截，直接改原生值，
     再派发事件让受控层同步 —— 这是驱动受控输入框的标准做法。 */
  descriptor.set.call(textarea, text)
  programmaticWrite = true
  try {
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
  } finally {
    /* 事件是同步派发的，处理完立刻复位，避免影响后续真实输入。 */
    programmaticWrite = false
  }
  return true
}

/** 脚本加载状态做全局复用：2.7MB 只该拉一次。 */
let enginePromise: Promise<void> | null = null

export function loadEngine(): Promise<void> {
  if (window.__LeiBoxComposer) return Promise.resolve()
  if (enginePromise) return enginePromise
  enginePromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script')
    /* 相对路径：dist 与 public 同根，file:// 与 http:// 都能解析 */
    script.src = './leibox-composer/composer-engine.js'
    script.async = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('LeiBox 输入框脚本加载失败'))
    document.head.appendChild(script)
  })
  return enginePromise
}
