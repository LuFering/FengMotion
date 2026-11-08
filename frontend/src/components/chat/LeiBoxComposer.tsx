/**
 * LeiBoxComposer —— 直接运行 LeiBox 官方「Agent 对话输入框」原版代码。
 *
 * 不再有任何自研复刻：加号、权限菜单、附件区、上下文环、
 * 模型 + 推理档位胶囊、发送钮、以及它们的全部 GSAP 动效，
 * 都来自官方打包产物 `public/leibox-composer/composer-engine.js`
 * （2.7MB，自带 React / ReactDOM / GSAP / 图标，完全自包含）。
 *
 * 集成方式：官方脚本末尾被改为暴露 `window.__LeiBoxComposer.mount(el, options)`，
 * 由本组件传入一个空 div 交给它挂载。官方内部用 Shadow DOM 隔离样式，
 * 因此不会与本站样式互相污染。
 *
 * 与原产物的唯一差异：去掉了「整页 600px 演示舞台」的外层布局
 * （见下方 fitStyle），让它以输入框的自然高度嵌进对话页。
 */

import { useEffect, useRef } from 'react'

/** 官方暴露的挂载工厂。 */
type MountFn = (el: HTMLElement, options?: Record<string, unknown>) => {
  destroy?: () => void
  update?: (options: Record<string, unknown>) => void
}

declare global {
  interface Window {
    __LeiBoxComposer?: { mount: MountFn }
  }
}

/** 提交内容（官方 onSubmit 的 payload 子集）。 */
export interface LeiBoxSubmitPayload {
  text: string
  model?: string
  thinking?: string
  permission?: string
}

export interface LeiBoxComposerProps {
  onSubmit?: (payload: LeiBoxSubmitPayload) => void
  busy?: boolean
}

/** 脚本加载状态做全局复用：2.7MB 只该拉一次。 */
let enginePromise: Promise<void> | null = null

function loadEngine(): Promise<void> {
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

export function LeiBoxComposer({ onSubmit, busy = false }: LeiBoxComposerProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const instanceRef = useRef<ReturnType<MountFn> | null>(null)
  /* 回调放 ref：挂载只发生一次，不能因 props 变化重建组件 */
  const submitRef = useRef(onSubmit)
  submitRef.current = onSubmit

  useEffect(() => {
    let disposed = false
    const host = hostRef.current
    if (!host) return

    void loadEngine().then(() => {
      if (disposed || !hostRef.current) return
      const factory = window.__LeiBoxComposer
      if (!factory) return
      instanceRef.current = factory.mount(hostRef.current, {
        onSubmit: (payload: LeiBoxSubmitPayload) => {
          if (payload?.text?.trim()) submitRef.current?.(payload)
        },
      })

      /* 官方根节点带 min-height:600px（它独立成页时的画布高度）。
         这层样式在 Shadow DOM 内部，外部 CSS 穿不进去，只能挂载后改 style。
         注意：**不要给宿主写死高度** —— 官方根节点的实际高度（约 180px）
         比内部输入框（约 132px）多一圈内边距，写死会把内容裁掉、
         露出一条白边。这里只做「取消最小高度」这一件事，高度交给内容自己决定。 */
      /* 官方产物的 DOM 是「演示页」形状：
           DIV
             MAIN.original-deep-agent-stage   ← 600px 白底画布（整页舞台）
               DIV.original-composer-container ← 真正的输入框，132px
         我们只要输入框本身。直接把外层舞台**移除**（不是隐藏、也不是改高度）：
         把舞台上的主题变量与 data-* 搬到输入框容器上，再 replace 掉舞台。
         这样宿主里只剩输入框，既没有白底也不残留 600px 占位。 */
      const flatten = () => {
        const host = hostRef.current
        const surface = host?.querySelector('[data-motion-surface]') as HTMLElement | null
        const shadow = surface?.shadowRoot
        if (!surface || !shadow) return false
        const stage = shadow.querySelector('.original-deep-agent-stage') as HTMLElement | null
        const composer = shadow.querySelector('.original-composer-container') as HTMLElement | null
        if (!stage || !composer) return false

        /* 1) 继承舞台上的主题变量（--theme-*）与语义属性，否则输入框会丢配色 */
        const stageStyle = stage.getAttribute('style') ?? ''
        composer.setAttribute(
          'style',
          `${composer.getAttribute('style') ?? ''};${stageStyle}`
            .replace(/min-height[^;]*;?/g, '')
            .replace(/height[^;]*;?/g, ''),
        )
        for (const name of ['data-original-ready', 'data-reduced-motion', 'data-motion-surface']) {
          const value = stage.getAttribute(name)
          if (value !== null) composer.setAttribute(name, value)
        }
        /* 保留类名里与排版相关的部分（font-sans / text-text-base），
           去掉深色舞台专用的布局类 */
        composer.classList.add('font-sans', 'text-text-base')

        /* 2) 用输入框容器替换掉舞台 —— 舞台节点直接出 DOM，不留占位 */
        stage.replaceWith(composer)

        /* 3) 输入框跟随宿主宽度（官方默认 max-width 768） */
        composer.style.width = '100%'
        composer.style.maxWidth = '100%'

        /* 4) 根节点也不再需要 600px 画布高度 */
        surface.style.minHeight = '0'
        surface.style.height = 'auto'
        return true
      }

      /* 先隐藏 → 替换 → 显示，三步在同一帧内完成，用户看不到中间态 */
      const host = hostRef.current
      if (host) host.style.visibility = 'hidden'
      requestAnimationFrame(() => {
        const ok = flatten()
        if (host) host.style.visibility = ''
        if (!ok) {
          requestAnimationFrame(() => {
            flatten()
            if (host) host.style.visibility = ''
          })
        }
      })
    }).catch((error: unknown) => {
      /* 加载失败要说清楚：静默留一个空框会让人以为输入框坏了 */
      if (hostRef.current) {
        hostRef.current.textContent = `输入框加载失败：${error instanceof Error ? error.message : '未知错误'}`
      }
    })

    return () => {
      disposed = true
      instanceRef.current?.destroy?.()
      instanceRef.current = null
    }
  }, [])

  useEffect(() => {
    instanceRef.current?.update?.({ busy })
  }, [busy])

  return <div ref={hostRef} className="lbx-host" data-ready={undefined} />
}

export default LeiBoxComposer
