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
  /**
   * 官方胶囊的模型清单。
   *
   * 官方胶囊读的是 `bridge.api.getSettings()` 返回的 `available_models`，
   * 而那个值就来自挂载时传入的 `models` —— 所以换掉这一项，
   * 胶囊里显示的就是后端真实目录，不需要自建控件。
   */
  models?: Array<{ id: string; label?: string }>
  /** 当前选中的模型 id；官方胶囊据此高亮并显示名字 */
  selectedModel?: string
  /** 已接入的引擎清单（官方胶囊第一级抽屉） */
  harnesses?: Array<{ id: string; name: string }>
  /** 当前引擎 id */
  harness?: string
  /** 用户在抽屉里换了引擎 */
  onHarnessChange?: (id: string) => void
  /** 每个引擎的真实模型目录（换引擎后胶囊里要换成它的模型） */
  modelsByHarness?: Record<string, Array<{ id: string; label?: string }>>
  /** 用户在官方胶囊里换模型 */
  onModelChange?: (modelId: string) => void
  /** 用户在官方胶囊里换推理强度 */
  onThinkingChange?: (level: string) => void
}


/**
 * 胶囊的环绕光与两级抽屉样式。
 *
 * 必须注入到官方组件的 Shadow DOM 里 —— 这些类名作用在它渲染出来的节点上，
 * 外部样式表穿不进去。光效沿用首页输入框那套（conic-gradient + mask xor
 * 裁成 2px 描边 + drop-shadow 发光），不用 box-shadow 是因为渐变要跑起来。
 */
const PILL_CSS = `
@property --lbx-hz-spin { syntax: '<angle>'; initial-value: 0deg; inherits: false; }
.lbx-hz-glow { position: relative; display: inline-flex; }
.lbx-hz-glow-ring {
  position: absolute; inset: -2px; border-radius: 999px; padding: 2px;
  pointer-events: none;
  background: conic-gradient(from var(--lbx-hz-spin),
    transparent 0deg, transparent 130deg,
    color-mix(in srgb, var(--theme-accent, #3B8CF8) 45%, transparent) 200deg,
    var(--theme-accent, #3B8CF8) 265deg,
    #fff 292deg,
    var(--theme-accent, #3B8CF8) 315deg,
    color-mix(in srgb, var(--theme-accent, #3B8CF8) 45%, transparent) 350deg,
    transparent 360deg);
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  -webkit-mask-composite: xor;
  mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  mask-composite: exclude;
  filter: drop-shadow(0 0 5px color-mix(in srgb, var(--theme-accent, #3B8CF8) 90%, transparent))
          drop-shadow(0 0 11px color-mix(in srgb, var(--theme-accent, #3B8CF8) 60%, transparent));
  animation: lbx-hz-spin-cw 2.8s linear infinite;
}
@keyframes lbx-hz-spin-cw { to { --lbx-hz-spin: 360deg; } }
@media (prefers-reduced-motion: reduce) { .lbx-hz-glow-ring { animation: none; } }

.lbx-hz-panel { overflow: hidden; padding: 6px 0; }
.lbx-hz-track { display: flex; width: 200%; transition: transform 320ms cubic-bezier(0.19, 1, 0.22, 1); }
.lbx-hz-panel[data-pane="model"] .lbx-hz-track { transform: translateX(-50%); }
.lbx-hz-page { width: 50%; flex-shrink: 0; padding: 0 10px; }
.lbx-hz-row {
  display: flex; align-items: center; gap: 6px; width: 100%;
  padding: 7px 8px; margin: 1px 0; border: 0; border-radius: 8px;
  background: transparent; color: inherit; font: inherit; font-size: 12.5px;
  text-align: left; cursor: pointer; transition: background-color 140ms ease;
}
.lbx-hz-row:hover { background: color-mix(in srgb, currentColor 7%, transparent); }
.lbx-hz-row--on { background: color-mix(in srgb, var(--theme-accent, #3B8CF8) 14%, transparent); }
.lbx-hz-back {
  display: inline-flex; align-items: center; gap: 3px;
  margin: 2px 0 4px; padding: 3px 6px; border: 0; border-radius: 6px;
  background: transparent; color: inherit; font: inherit; font-size: 11px;
  opacity: .65; cursor: pointer;
}
.lbx-hz-back:hover { opacity: 1; background: color-mix(in srgb, currentColor 7%, transparent); }
`

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


/* ── 官方弹层形变动效（composer-engine.js 的 Z1 + t1 + a1）──────────
   原版是 GSAP 时间线：外层从**触发元素的矩形**长成卡片矩形，
   width / height 各跑一条弹簧，圆角与底色 0.22s 收口。
   这里把同一组弹簧参数翻成 WAAPI 关键帧 —— WAAPI 不接受函数式缓动，
   但可以用 offset + 线性插值精确复现同一条弹簧曲线。 */

/** 官方 t1：hover 展开 / 收回两条不同的弹簧（stiffness, damping, duration(s), delay(s)）。 */
const MORPH = {
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
function springEase(stiffness: number, damping: number, duration: number) {
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
function springKeyframes(
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

export function LeiBoxComposer({
  onSubmit,
  busy = false,
  contextUsage = null,
  contextUsageFallbackTokens = 0,
  contextPanel = null,
  models,
  selectedModel,
  harnesses,
  harness,
  onHarnessChange,
  modelsByHarness,
  onModelChange,
  onThinkingChange,
}: LeiBoxComposerProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const instanceRef = useRef<ReturnType<MountFn> | null>(null)
  /* 面板是否展开。官方是 PreviewCard：hover 开、离开关，不是点击。 */
  const [ctxOpen, setCtxOpen] = useState(false)
  /* 关闭中：节点要留到形变收回去再卸，否则会「啪」地消失 */
  const [ctxClosing, setCtxClosing] = useState(false)
  const hoverTimer = useRef<number | null>(null)
  /* 面板根节点：形变动效要量它的最终尺寸 */
  const popRef = useRef<HTMLDivElement>(null)
  /* 圆钮：展开时隐藏它，让卡片从它所在的位置长出来 */
  const ringRef = useRef<HTMLButtonElement>(null)
  /* 回调放 ref：挂载只发生一次，不能因 props 变化重建组件 */
  const submitRef = useRef(onSubmit)
  submitRef.current = onSubmit
  const modelsRef = useRef(models)
  modelsRef.current = models
  const selectedRef = useRef(selectedModel)
  selectedRef.current = selectedModel
  const hzRef = useRef({ harnesses, harness, onHarnessChange, modelsByHarness })
  hzRef.current = { harnesses, harness, onHarnessChange, modelsByHarness }
  const modelCbRef = useRef(onModelChange)
  modelCbRef.current = onModelChange
  const thinkCbRef = useRef(onThinkingChange)
  thinkCbRef.current = onThinkingChange

  useEffect(() => {
    let disposed = false
    const host = hostRef.current
    if (!host) return

    void loadEngine().then(() => {
      if (disposed || !hostRef.current) return
      const factory = window.__LeiBoxComposer
      if (!factory) return
      instanceRef.current = factory.mount(hostRef.current, {
        /* 官方胶囊的模型清单直接读这里（bridge.api.getSettings 的 available_models），
           所以传真实目录它显示的就是真模型，不用另做一套控件。 */
        models: (modelsRef.current ?? []).map((m) => m.id),
        selectedModel: selectedRef.current ?? modelsRef.current?.[0]?.id,
        harnesses: hzRef.current.harnesses ?? [],
        harness: hzRef.current.harness ?? '',
        modelsByHarness: hzRef.current.modelsByHarness ?? {},
        onHarnessChange: (id: string) => hzRef.current.onHarnessChange?.(id),
        onModelChange: (id: string) => modelCbRef.current?.(id),
        onValueChange: (level: string) => thinkCbRef.current?.(level),
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

        /* 2) 把舞台压成「零外框」而不是从 DOM 里摘掉它。
           ⚠️ 不能用 stage.replaceWith(composer)：那会把 React 渲染的节点
           从 DOM 里拿走，React 的树和真实 DOM 就对不上了 —— 之后任何一次
           重渲染（每轮 contextUsage 更新都会）都会抛
           `NotFoundError: Failed to removeChild`，渲染进程直接崩。
           这里只改样式：背景透明、内边距清零、最小高度归零，视觉上和删掉一样。 */
        stage.style.background = 'transparent'
        stage.style.minHeight = '0'
        stage.style.height = 'auto'
        stage.style.padding = '0'
        stage.style.borderRadius = '0'
        stage.style.boxShadow = 'none'

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

        /* 胶囊的环绕光与两级抽屉样式。
           必须在 shadow 内注入：这些类名作用在官方组件渲染的节点上，
           外部样式表穿不进 Shadow DOM。 */
        if (!shadow.querySelector('style[data-lbx-pill]')) {
          const el = document.createElement('style')
          el.setAttribute('data-lbx-pill', '')
          el.textContent = PILL_CSS
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

  /* 模型目录是异步到的（/api/harnesses/{id}/models），到了就推给官方胶囊。
     官方 update 会合并 props 并重渲染，胶囊里的清单随之更新。 */
  useEffect(() => {
    if (!models || models.length === 0) return
    instanceRef.current?.update?.({
      models: models.map((m) => m.id),
      selectedModel: selectedRef.current ?? models[0]?.id,
    })
  }, [models])

  /* 用户换了模型（或后端默认模型变化）时同步给官方胶囊 */
  useEffect(() => {
    if (!selectedModel) return
    instanceRef.current?.update?.({ selectedModel })
  }, [selectedModel])

  /* 引擎清单与目录异步到；到了推给官方胶囊，抽屉里才有内容可列 */
  useEffect(() => {
    instanceRef.current?.update?.({
      harnesses: harnesses ?? [],
      harness: harness ?? '',
      modelsByHarness: modelsByHarness ?? {},
    })
  }, [harnesses, harness, modelsByHarness])

  /* 上下文数据后到（一轮跑完才有），所以单独一个 effect 推给官方组件。
     官方 update() 内部会整包合并并重渲染，圆圈与它自己的分档面板一起刷新。 */
  useEffect(() => {
    instanceRef.current?.update?.({
      contextUsage: contextUsage ?? null,
      contextUsageFallbackTokens: contextUsageFallbackTokens ?? 0,
    })
  }, [contextUsage, contextUsageFallbackTokens])

  /* ── 悬停开合：官方 PreviewCard 的 delay 120 / closeDelay 150 ──────
     不是点击切换。点击在官方那里被 trigger-press 显式取消了。 */
  const openCtx = () => {
    if (hoverTimer.current) window.clearTimeout(hoverTimer.current)
    hoverTimer.current = window.setTimeout(() => {
      setCtxClosing(false)
      setCtxOpen(true)
    }, 120)
  }
  const closeCtx = () => {
    if (hoverTimer.current) window.clearTimeout(hoverTimer.current)
    hoverTimer.current = window.setTimeout(() => {
      if (!popRef.current) {
        setCtxOpen(false)
        return
      }
      setCtxClosing(true)
    }, 150)
  }
  useEffect(() => () => {
    if (hoverTimer.current) window.clearTimeout(hoverTimer.current)
  }, [])

  /* 展开：从圆环的 32×32 长成卡片 —— 官方 open 弹簧。 */
  useEffect(() => {
    if (!ctxOpen || ctxClosing) return
    const el = popRef.current
    if (!el) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    /* ⚠️ 不能量外层：它此刻可能还带着上一次动画的尺寸（甚至就是 32×32），
       量到的「目标尺寸」会等于起点，动画等于没动，随后又被收起逻辑接走。
       内层 .ctx 才是内容的自然尺寸（卡片固定 309px 宽、高度随图例换行）。 */
    const inner = el.firstElementChild as HTMLElement | null
    const finalW = inner?.offsetWidth || el.scrollWidth
    const finalH = inner?.offsetHeight || el.scrollHeight
    if (finalW <= 0 || finalH <= 0) return

    /* ── 圆环让位 ────────────────────────────────────────────
       官方在展开的同一帧把触发元素设为 opacity:0（`S2.style.opacity="0"`），
       收起时再还原。所以视觉上是「圆环自己长成卡片把它盖住」，
       而不是卡片浮在圆环旁边。 */
    const ringEl = ringRef.current
    if (ringEl) ringEl.style.opacity = '0'

    /* 卡片底色在内层 .ctx 上，外层容器本身透明 —— 直接读外层会拿到
       rgba(0,0,0,0)，整张卡就没有底。 */
    const cardBg =
      (el.firstElementChild && getComputedStyle(el.firstElementChild).backgroundColor) ||
      'rgb(255,255,255)'

    /* 圆角 / 底色 / 阴影：官方 0.22s power2.out，从「环」的样子开始 */
    /* 起点用圆环轨迹色而不是全透明：圆环刚被隐藏，卡片就从同一个颜色
       接上，视觉上是「环自己变厚变成卡片」，不是「凭空浮出一张白卡」。 */
    /* 起点用「实心化的圆环色」而不是轨迹的 28% 透明度：轨迹本来就是淡的
       （那是个未填充的槽），拿它当卡片起始底色，渐变几乎看不出来。
       alpha 提到 0.55 才有肉眼可见的「灰 → 白」过渡。 */
    const ringTrail = 'rgba(25,26,32,0.55)'
    /* 形变期间把底色让给外层容器（见 leibox-composer.css 的 [data-morphing]），
       否则 .ctx 自己的不透明白底会把渐变整个盖住 —— 那样看起来就只是
       「一张白卡从小变大」，完全没有颜色过渡。 */
    el.setAttribute('data-morphing', '')
    const shell = el.animate(
      [
        { borderRadius: '999px', backgroundColor: ringTrail, boxShadow: '0 0 0 rgba(0,0,0,0)' },
        { borderRadius: '20px', backgroundColor: cardBg, boxShadow: '0 12px 32px rgba(0,0,0,0.16)' },
      ],
      { duration: 260, easing: 'cubic-bezier(0.215, 0.61, 0.355, 1)', fill: 'both' },
    )
    /* 渐变色走完就把底交还给 .ctx —— 它自带圆角与底色，
       交接时两者颜色相同，不会闪。 */
    shell.finished.then(() => el.removeAttribute('data-morphing')).catch(() => {})
    /* 宽 / 高：两条独立弹簧，height 比 width 晚 57ms 起 */
    el.animate(springKeyframes('width', 32, finalW, MORPH.open.width), {
      duration: MORPH.open.width.duration * 1000,
      delay: MORPH.open.width.delay * 1000,
      easing: 'linear',
      fill: 'both',
    })
    el.animate(springKeyframes('height', 32, finalH, MORPH.open.height), {
      duration: MORPH.open.height.duration * 1000,
      delay: MORPH.open.height.delay * 1000,
      easing: 'linear',
      fill: 'both',
    })
    /* 内容比外壳晚一点：官方先让环的样子停一瞬，再淡入内容 */
    el.firstElementChild?.animate(
      [{ opacity: 0, filter: 'blur(3px)' }, { opacity: 1, filter: 'blur(0px)' }],
      { duration: 180, delay: 180, easing: 'cubic-bezier(0.215, 0.61, 0.355, 1)', fill: 'both' },
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctxOpen, ctxClosing])

  /* 收回：从当前尺寸缩回圆环 —— 官方 close 弹簧，收完再卸节点。 */
  useEffect(() => {
    if (!ctxClosing) return
    const el = popRef.current
    if (!el) return
    const w = el.offsetWidth
    const h = el.offsetHeight
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setCtxClosing(false)
      setCtxOpen(false)
      return
    }
    const cardBg =
      (el.firstElementChild && getComputedStyle(el.firstElementChild).backgroundColor) ||
      'rgb(255,255,255)'
    el.firstElementChild?.animate(
      [{ opacity: 1 }, { opacity: 0 }],
      { duration: 120, easing: 'linear', fill: 'both' },
    )
    /* 外壳保持有底，直到缩到接近圆环尺寸才收掉 ——
       提前在 220ms 淡成透明的话，剩下的 400ms 里卡片看不见、
       圆环又还没回来，屏幕上就是一段空白。

       末段把底色过渡到**圆环轨迹的颜色**：卡片缩成小圆的那一刻，
       颜色已经和圆环一致，接着圆环淡入就完全接得上，
       不会出现「白圆 → 灰环」那一下跳色。 */
    /* 起点用「实心化的圆环色」而不是轨迹的 28% 透明度：轨迹本来就是淡的
       （那是个未填充的槽），拿它当卡片起始底色，渐变几乎看不出来。
       alpha 提到 0.55 才有肉眼可见的「灰 → 白」过渡。 */
    const ringTrail = 'rgba(25,26,32,0.55)'
    el.setAttribute('data-morphing', '')
    el.animate(
      [
        { borderRadius: '20px', backgroundColor: cardBg, boxShadow: '0 12px 32px rgba(0,0,0,0.16)' },
        { borderRadius: '20px', backgroundColor: cardBg, boxShadow: '0 6px 18px rgba(0,0,0,0.10)', offset: 0.7 },
        { borderRadius: '999px', backgroundColor: ringTrail, boxShadow: '0 0 0 rgba(0,0,0,0)' },
      ],
      { duration: 620, easing: 'linear', fill: 'both' },
    )
    el.animate(springKeyframes('width', w, 32, MORPH.close.width), {
      duration: MORPH.close.width.duration * 1000,
      delay: MORPH.close.width.delay * 1000,
      easing: 'linear',
      fill: 'both',
    })
    /* 用最长的那个动画（width，0.64s + 70ms 延迟）作为「收完」的时点，
       不依赖 onfinish —— 多条 fill:both 的动画同时跑时，
       先结束的那条会把 onfinish 的时序搞乱。 */
    el.animate(springKeyframes('height', h, 32, MORPH.close.height), {
      duration: MORPH.close.height.duration * 1000,
      delay: MORPH.close.height.delay * 1000,
      easing: 'linear',
      fill: 'both',
    })
    /* 圆环在卡片缩小的后半段交叉淡入：卡片还在、圆环已经隐隐出现，
       两者叠一下，就不会有任何一帧是空的。 */
    const ringEl = ringRef.current
    if (ringEl) {
      ringEl.animate([{ opacity: 0 }, { opacity: 1 }], {
        duration: 300,
        delay: 280,
        easing: 'cubic-bezier(0.215, 0.61, 0.355, 1)',
        fill: 'both',
      })
    }

    const total = Math.max(
      MORPH.close.width.delay * 1000 + MORPH.close.width.duration * 1000,
      MORPH.close.height.delay * 1000 + MORPH.close.height.duration * 1000,
    )
    window.setTimeout(() => {
      /* 先取消残留动画（fill:both 会把尺寸钉在 32px，
         下次展开时 offsetWidth 读到它就等于没动），
         再**同一帧**里卸卡片 + 还圆环。
         ⚠️ 这两个动作必须一起做：分开成两次状态更新的话，
         中间会有一帧「卡片已缩到 32、圆环还没显示」，
         用户看到的就是那一下闪空。 */
      el.getAnimations().forEach((a) => a.cancel())
      el.firstElementChild?.getAnimations().forEach((a) => a.cancel())

      const ringEl = ringRef.current
      if (ringEl) {
        /* 先取消交叉淡入的动画再清 inline opacity ——
           直接清会被动画的 fill:both 覆盖，圆环就停在半透明。 */
        ringEl.getAnimations().forEach((a) => a.cancel())
        ringEl.style.opacity = ''
      }
      setCtxClosing(false)
      setCtxOpen(false)
    }, total + 20)
  }, [ctxClosing])

  /* 圆环的进度比例；没有数据就不画圆钮（与官方「无数据不显示」一致） */
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
        <div className="lbx-ctxwrap" onMouseEnter={openCtx} onMouseLeave={closeCtx}>
          <button
            ref={ringRef}
            type="button"
            className="lbx-ctxring"
            aria-label={`上下文占用 ${Math.round(ratio * 100)}%`}
            title="上下文占用"
            /* 悬停即开（由外层 onMouseEnter 负责），点击不切换 ——
               官方的 PreviewCard 也是 hover 触发，并显式取消 trigger-press。 */
            onFocus={openCtx}
          >
            <svg viewBox="0 0 32 32" aria-hidden="true">
              <circle cx="16" cy="16" r="13" fill="none" strokeWidth="4" className="lbx-ctxring-trail" />
              <circle
                cx="16"
                cy="16"
                r="13"
                fill="none"
                strokeWidth="4"
                strokeLinecap="round"
                className="lbx-ctxring-path"
                strokeDasharray={`${2 * Math.PI * 13}`}
                strokeDashoffset={`${2 * Math.PI * 13 * (1 - ratio)}`}
                transform="rotate(-90 16 16)"
              />
            </svg>
          </button>
          {(ctxOpen || ctxClosing) && (
            <div
              ref={popRef}
              className="lbx-ctxpop"
              role="dialog"
              aria-label="上下文组成"
              onMouseEnter={openCtx}
              onMouseLeave={closeCtx}
            >
              {contextPanel}
            </div>
          )}
        </div>
      ) : null}
    </div>
  )
}

export default LeiBoxComposer
