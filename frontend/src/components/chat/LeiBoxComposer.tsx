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

import { useEffect, useRef, useState } from 'react'
import './leibox-composer.css'

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

/** 官方上下文圆圈的构成块。 */
export interface ContextBlock {
  kind: string
  source: string
  name: string
  tokens: number
}

/**
 * 官方上下文圆圈要的数据快照。
 *
 * 字段名照抄官方 hse 组件的 props 约定（`contextUsage` + `blocks`），
 * 不是我们自创的形状 —— 名字传错官方会静默当作 null，圆圈恒显示 0%。
 */
export interface ContextUsageSnapshot {
  context_window: number
  /** 构成块；官方自己会排序、算「其他/未归类」并渲染列表 */
  blocks: ContextBlock[]
  projected_request_tokens?: number
  measured_prompt_tokens?: number
  estimated_prompt_tokens?: number
}

export interface LeiBoxComposerProps {
  onSubmit?: (payload: LeiBoxSubmitPayload) => void
  busy?: boolean
  /** 上下文快照；null 时官方圆圈显示 0% */
  contextUsage?: ContextUsageSnapshot | null
  /** 分子兜底：没有快照时用它算百分比 */
  contextUsageFallbackTokens?: number
  /**
   * 上下文弹层的内容。
   *
   * 官方圆环点开自带的是一张「预计下一次请求 N%」的小卡 —— 那是它自己的
   * 表述方式，和本项目要的「上下文被什么吃掉」不是一回事。这里把内容换成
   * 调用方给的节点（Bencho 的 ContextMeter），由它画在官方弹层的位置上。
   */
  contextPanel?: React.ReactNode
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

export function LeiBoxComposer({
  onSubmit,
  busy = false,
  contextUsage = null,
  contextUsageFallbackTokens = 0,
  contextPanel = null,
}: LeiBoxComposerProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const instanceRef = useRef<ReturnType<MountFn> | null>(null)
  /* 自己的上下文面板是否展开 */
  const [ctxOpen, setCtxOpen] = useState(false)
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

        /* 5) 隐藏官方那枚上下文圆钮，由本组件自己在同一位置画。
           官方圆钮点开是一张「预计下一次请求 N%」的小卡 —— 那是它自己的
           表述方式，回答不了「上下文被什么吃掉」。把它藏掉、换成我们自己的
           圆钮 + Bencho 点阵面板，位置与尺寸沿用官方（32x32）。
           只藏按钮，不动其它工具：属性选择器精确匹配 aria-label 前缀。 */
        const style = shadow.querySelector('style[data-lbx-hide-ctx]')
        if (!style) {
          const el = document.createElement('style')
          el.setAttribute('data-lbx-hide-ctx', '')
          el.textContent = 'button[aria-label^="Context"]{visibility:hidden!important}'
          shadow.appendChild(el)
        }
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

  /* 上下文数据后到（一轮跑完才有），所以单独一个 effect 推给官方组件。
     官方 update() 内部会整包合并并重渲染，圆圈与它自己的分档面板一起刷新。 */
  useEffect(() => {
    instanceRef.current?.update?.({
      contextUsage: contextUsage ?? null,
      contextUsageFallbackTokens: contextUsageFallbackTokens ?? 0,
    })
  }, [contextUsage, contextUsageFallbackTokens])

  /* 有数据才画自己的圆钮；没有数据时按钮位留空，与官方「无数据不显示」一致 */
  const ratio =
    contextUsage && contextUsage.context_window > 0
      ? Math.min(1, (contextUsageFallbackTokens ?? 0) / contextUsage.context_window)
      : null

  return (
    /* 圆钮必须放在 .lbx-host **内部** —— 那个容器是 position:relative，
       放外面的话 offsetParent 会一路找到 .cv3-seat，right 的参照系就错了
       （实测偏了 182px，正好压在模型胶囊上）。 */
    <div ref={hostRef} className="lbx-host" data-ready={undefined}>
      {/* 自己画的上下文圆钮：盖在官方圆钮被隐藏的那个位置上。
          官方那枚点开是「预计下一次请求 N%」的小卡，换成本组件的点阵面板。 */}
      {ratio !== null && contextPanel ? (
        <div className="lbx-ctxwrap">
          <button
            type="button"
            className="lbx-ctxring"
            aria-label={`上下文占用 ${Math.round(ratio * 100)}%`}
            title="上下文占用"
            onClick={() => setCtxOpen((v) => !v)}
          >
            <svg viewBox="0 0 32 32" aria-hidden="true">
              <circle cx="16" cy="16" r="13" fill="none" strokeWidth="3" className="lbx-ctxring-trail" />
              <circle
                cx="16"
                cy="16"
                r="13"
                fill="none"
                strokeWidth="3"
                strokeLinecap="round"
                className="lbx-ctxring-path"
                strokeDasharray={`${2 * Math.PI * 13}`}
                strokeDashoffset={`${2 * Math.PI * 13 * (1 - ratio)}`}
                transform="rotate(-90 16 16)"
              />
            </svg>
          </button>
          {ctxOpen ? (
            <div className="lbx-ctxpop" role="dialog" aria-label="上下文组成">
              {contextPanel}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

export default LeiBoxComposer
