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

import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { HARNESSES } from '@/features/harness/model/harnesses'
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

function writeComposerText(textarea: HTMLTextAreaElement, text: string): boolean {
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
  /**
   * 停止当前生成。
   *
   * <p><strong>注意官方实现</strong>：它只看 `busy` 决定画停止键，
   * 并不检查 `onStop` 是否存在（bundle 里是 `A ? 停止键 : 发送键`，
   * 点击时 `A ? onStop?.() : submit()`）。所以「不传 onStop」并不能隐藏停止键，
   * 只会得到一个点了没反应的按钮。</p>
   *
   * <p>因此本组件把语义拆开：{@link canStop} 为真时才把 busy 传给官方组件，
   * 让停止键只在确实能停的时候出现。</p>
   */
  onStop?: () => void
  /**
   * 当前是否真的能停止。
   *
   * <p>与 busy 分开：工程任务（改工程/渲染/工作流）运行时要显示「忙碌、不可重复提交」，
   * 但不能给停止键 —— 那类任务走后端任务通道，会话流停不了它。
   * 为 false 时本组件不把 busy 透给官方组件，官方因此画发送键（禁用态）。</p>
   */
  canStop?: boolean
  /** 正在停止：官方据此把停止键切成「停止中」并禁用重复点击 */
  stopping?: boolean
  /**
   * 用户产生了真实输入（键盘/粘贴）。
   *
   * <p>用来作废「刚发送」标记：发送成功后官方输入框会迟来一次 flush，
   * 需要拦；但用户**主动重新输入同一句话**时不能拦，
   * 否则草稿存不下、那句话也没法作为新一轮发送。区分靠输入事件时序。</p>
   */
  onUserInput?: () => void
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
  harnesses?: Array<{ id: string; name: string; iconUrl?: string; available?: boolean; models?: Array<{ id: string; name: string; reasoningEfforts?: string[] }> }>
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
  selectedEffort?: string | null
  modelTrigger?: 'pill' | 'square'
  showContextRing?: boolean
  /** 外部绑定的草稿内容（支持受控还原与清空） */
  draft?: string
  /** 文本变化回调（支持外部草稿库实时监听） */
  onDraftChange?: (text: string) => void
  /** 即时刷写回调（切页、失焦、发送前强刷，避免防抖遗漏） */
  onFlush?: (text: string) => void
}


/**
 * 胶囊的环绕光与两级抽屉样式。
 *
 * 必须注入到官方组件的 Shadow DOM 里 —— 这些类名作用在它渲染出来的节点上，
 * 外部样式表穿不进去。光效沿用首页输入框那套（conic-gradient + mask xor
 * 裁成 2px 描边 + drop-shadow 发光），不用 box-shadow 是因为渐变要跑起来。
 */
const PILL_CSS = `
/* External SVG images keep brand colors; monochrome Codex follows dark mode. */
[data-theme="dark"] img.fm-model-logo[src*="/openai.svg"] { filter:invert(1); }
@property --lbx-hz-spin { syntax: '<angle>'; initial-value: 0deg; inherits: false; }
.lbx-hz-glow { position: relative; display: inline-flex; }
.lbx-hz-glow-ring {
  position: absolute; inset: -2px; border-radius: 999px; padding: 2px;
  pointer-events: none;
  background: conic-gradient(from var(--lbx-hz-spin),
    transparent 0deg, transparent 130deg,
    color-mix(in srgb, var(--lbx-engine-color, #4D6BFE) 45%, transparent) 200deg,
    var(--lbx-engine-color, #4D6BFE) 265deg,
    #fff 292deg,
    var(--lbx-engine-color, #4D6BFE) 315deg,
    color-mix(in srgb, var(--lbx-engine-color, #4D6BFE) 45%, transparent) 350deg,
    transparent 360deg);
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  -webkit-mask-composite: xor;
  mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  mask-composite: exclude;
  filter: drop-shadow(0 0 5px color-mix(in srgb, var(--lbx-engine-color, #4D6BFE) 90%, transparent))
          drop-shadow(0 0 11px color-mix(in srgb, var(--lbx-engine-color, #4D6BFE) 60%, transparent));
  animation: lbx-hz-spin-cw 2.8s linear infinite;
}
@keyframes lbx-hz-spin-cw { to { --lbx-hz-spin: 360deg; } }
@media (prefers-reduced-motion: reduce) { .lbx-hz-glow-ring { animation: none; } }

/* One engine token colors the whole pill; the clockwise orbit is unchanged. */
.fm-model-trigger:not(.fm-model-square) {
  background:color-mix(in srgb,var(--lbx-engine-color) 5%,var(--theme-bg,#fff)) !important;
  border-color:color-mix(in srgb,var(--lbx-engine-color) 28%,var(--theme-border,#e5e7eb)) !important;
  box-shadow:0 0 8px color-mix(in srgb,var(--lbx-engine-color) 18%,transparent) !important;
}
.fm-model-trigger:focus-visible { outline-color:var(--lbx-engine-color) !important; }
/* 角度在主文档注册，光沿胶囊边缘顺时针绕行。 */
.fm-model-trigger::after {
  background: conic-gradient(from var(--lbx-model-angle), transparent 0deg, transparent 145deg, color-mix(in srgb,var(--lbx-engine-color) 45%,#fff) 235deg, var(--lbx-engine-color) 300deg, #fff 330deg, var(--lbx-engine-color) 348deg, transparent 360deg) !important;
  animation: lbx-model-flow 3.4s linear infinite !important;
}
@keyframes lbx-model-flow { from { --lbx-model-angle: 0deg; } to { --lbx-model-angle: 360deg; } }
@media (prefers-reduced-motion: reduce) { .fm-model-trigger::after { animation: none !important; } }

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
.lbx-hz-row--on { background: color-mix(in srgb, var(--lbx-engine-color, #4D6BFE) 14%, transparent); }
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
  selectedEffort,
  modelTrigger = 'pill',
  showContextRing = true,
  draft,
  onDraftChange,
  onFlush,
  onStop,
  canStop = false,
  stopping = false,
  onUserInput,
}: LeiBoxComposerProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const instanceRef = useRef<ReturnType<MountFn> | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const latestTextRef = useRef<string>(draft ?? '')
  const draftRef = useRef(draft)
  draftRef.current = draft
  const draftChangeRef = useRef(onDraftChange)
  draftChangeRef.current = onDraftChange
  const flushRef = useRef(onFlush)
  flushRef.current = onFlush
  /* 停止回调：挂载 effect 只跑一次，闭包会捕获旧的 onStop，
     所以和 flush/submit 一样用 ref 转发最新值。 */
  const stopRef = useRef(onStop)
  const userInputRef = useRef(onUserInput)
  userInputRef.current = onUserInput
  stopRef.current = onStop
  const canStopRef = useRef(canStop)
  canStopRef.current = canStop
  const [localEffort, setLocalEffort] = useState('medium')
  /* 绑定完成时用一次 setState 触发重渲染，好让下面「每次渲染都校验」的
     草稿回填 effect 立刻有机会跑一次（官方组件异步挂载，光靠 draft 变化不够）。 */
  const [, setTextareaReady] = useState(false)
  /* 递增即触发官方组件重新挂载：用于「发送键 ⇄ 停止键」切换
     （官方没有暴露重新绑定回调的接口）。 */
  const [remountTick, setRemountTick] = useState(0)
  const effectiveEffort = selectedEffort ?? localEffort
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
  const hzRef = useRef({ harnesses, harness, onHarnessChange, modelsByHarness, effectiveEffort, modelTrigger, showContextRing })
  hzRef.current = { harnesses, harness, onHarnessChange, modelsByHarness, effectiveEffort, modelTrigger, showContextRing }
  const modelCbRef = useRef(onModelChange)
  modelCbRef.current = onModelChange
  const thinkCbRef = useRef(onThinkingChange)
  thinkCbRef.current = onThinkingChange

  useEffect(() => {
    let disposed = false
    let themeObserver: MutationObserver | null = null
    let anchorObserver: ResizeObserver | null = null
    let anchorMutation: MutationObserver | null = null
    let anchorFrame = 0
    const host = hostRef.current
    if (!host) return

    const positionContextRing = () => {
      cancelAnimationFrame(anchorFrame)
      anchorFrame = requestAnimationFrame(() => {
        if (disposed) return
        const shadow = host.querySelector('[data-motion-surface]')?.shadowRoot
        const anchor = shadow?.querySelector('button[aria-label^="Context"]')
        if (!anchor) { host.removeAttribute('data-context-anchored'); return }
        const base = host.getBoundingClientRect()
        const rect = anchor.getBoundingClientRect()
        if (!rect.width || !rect.height) { host.removeAttribute('data-context-anchored'); return }
        host.style.setProperty('--lbx-context-left', `${rect.left - base.left}px`)
        host.style.setProperty('--lbx-context-top', `${rect.top - base.top}px`)
        host.setAttribute('data-context-anchored', '')
      })
    }

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
        selectedHarnessId: hzRef.current.harness ?? null,
        selectedEffort: hzRef.current.effectiveEffort,
        modelTrigger: hzRef.current.modelTrigger,
        showContextRing: hzRef.current.showContextRing,
        modelsByHarness: hzRef.current.modelsByHarness ?? {},
        onHarnessChange: (id: string) => hzRef.current.onHarnessChange?.(id),
        onModelChange: (id: string) => modelCbRef.current?.(id),
        onSelectionChange: (selection: { harnessId: string; modelId: string }) => {
          hzRef.current.onHarnessChange?.(selection.harnessId)
          modelCbRef.current?.(selection.modelId)
        },
        onEffortChange: (level: string) => { setLocalEffort(level); thinkCbRef.current?.(level) },
        onValueChange: (level: string) => thinkCbRef.current?.(level),
        onSubmit: (payload: LeiBoxSubmitPayload) => {
          if (payload?.text?.trim()) {
            flushRef.current?.(payload.text.trim())
            submitRef.current?.(payload)
          }
        },
        /* 能停时：busy=true + onStop → 官方画可点的停止键。
           不能停（工程任务在跑）：先传 busy=false 画发送键，
           再由下面的 effect 把它禁用并改说明文案 —— 直接传 busy=true 会画停止键，
           即使禁用也会让人以为「这个能停」。 */
        ...(canStopRef.current
          ? { busy: true, onStop: () => stopRef.current?.(), stopping: false }
          : { busy: false }),
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

        const resolveEffectiveTheme = (): 'dark' | 'light' | 'tactile' => {
          const docTheme = document.documentElement.getAttribute('data-theme')
          if (docTheme === 'dark' || docTheme === 'tactile' || docTheme === 'light') return docTheme
          const hostEl = hostRef.current
          const closestTheme = hostEl?.closest('[data-theme]')?.getAttribute('data-theme')
          if (closestTheme === 'dark' || closestTheme === 'tactile' || closestTheme === 'light') return closestTheme
          const closestMode = hostEl?.closest('[data-mode]')?.getAttribute('data-mode')
          if (closestMode === 'dark') return 'dark'
          return 'dark' // 工作台默认纯黑模式兜底
        }

        const syncTheme = () => {
          const theme = resolveEffectiveTheme()
          composer.dataset.theme = theme
          composer.classList.toggle('dark', theme === 'dark')
          const vars = theme === 'dark'
            ? { bg: '#121316', elevated: '#16171b', fg: '#ededed', secondary: '#9a9a9a', border: 'rgba(255,255,255,0.08)', hover: 'rgba(255,255,255,0.06)' }
            : theme === 'tactile'
              ? { bg: '#eae6da', elevated: '#ddd8c9', fg: '#22231f', secondary: '#55534a', border: 'rgba(34,35,31,0.18)', hover: '#ded9cd' }
              : { bg: '#ffffff', elevated: '#ffffff', fg: '#1f2937', secondary: '#667085', border: '#e5e7eb', hover: '#f1f3f6' }
          for (const [name, value] of Object.entries({
            '--theme-bg': vars.bg,
            '--theme-elevated': vars.elevated,
            '--theme-fg': vars.fg,
            '--theme-text-secondary': vars.secondary,
            '--theme-border': vars.border,
            '--theme-hover': vars.hover,
          })) {
            composer.style.setProperty(name, value)
          }
        }
        syncTheme()
        themeObserver = new MutationObserver(syncTheme)
        themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })

        /* 注入经过三种主题适配与高度/圆角精修的样式规则 */
        const themeStyle = document.createElement('style')
        themeStyle.textContent = `
          /* ── 紧凑型外框与圆角恢复：由方形改回优雅流线型大圆角卡片，大幅压缩上下高度 ── */
          [data-message-composer-surface] {
            border-radius: var(--lbx-composer-radius, 20px) !important;
            transition: background-color 160ms ease, border-color 160ms ease, box-shadow 160ms ease !important;
          }
          [data-message-composer-surface] > div {
            padding: 8px 12px 6px 12px !important;
          }

          /* ── 压缩输入区域最小高度：从 60px 缩为 36px ── */
          textarea.composer-textarea {
            min-height: 36px !important;
            height: 36px !important;
            line-height: 20px !important;
            font-size: 13px !important;
            padding: 0 !important;
          }
          /* 镜像高亮渲染层同步高度 */
          [data-message-composer-surface] [style*="min-height: 60px"],
          [data-message-composer-surface] [style*="minHeight: 60px"] {
            min-height: 36px !important;
            line-height: 20px !important;
            font-size: 13px !important;
          }

          /* ── 底部操作工具行（加号、权限、模型、发送）微调紧凑 ── */
          [data-message-composer-surface] .composer-footer,
          [data-message-composer-surface] .mt-2.flex.items-center,
          [data-message-composer-surface] div:has(> button[aria-label="发送消息"]),
          [data-message-composer-surface] div:has(> button[aria-label="Stop"]) {
            margin-top: 4px !important;
          }

          /* ── 主题模式 1：深色模式（dark） ── */
          [data-theme="dark"] [data-message-composer-surface] {
            background: #15161a !important;
            color: #ededed !important;
            border: 1px solid rgba(255, 255, 255, 0.09) !important;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(255, 255, 255, 0.04) !important;
          }
          [data-theme="dark"] [data-message-composer-surface]:focus-within {
            border-color: rgba(59, 140, 248, 0.45) !important;
            box-shadow: 0 6px 24px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(59, 140, 248, 0.25) !important;
          }
          [data-theme="dark"] textarea.composer-textarea {
            color: #ededed !important;
          }
          [data-theme="dark"] textarea.composer-textarea::placeholder,
          [data-theme="dark"] .composer-textarea--empty {
            color: #6e6e6e !important;
          }
          /* 占位文字高亮层深色适配 */
          [data-theme="dark"] .text-gray-400,
          [data-theme="dark"] span:has(+ textarea) {
            color: #6e6e6e !important;
          }
          /* 加号按钮深色 */
          [data-theme="dark"] button[aria-label*="添加"],
          [data-theme="dark"] button[aria-label*="Add"],
          [data-theme="dark"] .group\\/add {
            background: rgba(255, 255, 255, 0.06) !important;
            color: #9a9a9a !important;
          }
          [data-theme="dark"] button[aria-label*="添加"]:hover,
          [data-theme="dark"] button[aria-label*="Add"]:hover,
          [data-theme="dark"] .group\\/add:hover {
            background: rgba(255, 255, 255, 0.12) !important;
            color: #ededed !important;
          }
          /* 权限选择器按钮深色 */
          [data-theme="dark"] button:has(span.sr-only):not([aria-label*="添加"]):not([aria-label*="发送"]) {
            color: #9a9a9a !important;
          }
          [data-theme="dark"] button:has(span.sr-only):not([aria-label*="添加"]):not([aria-label*="发送"]):hover {
            color: #ededed !important;
          }
          /* 发送按钮深色禁用态 */
          [data-theme="dark"] button[aria-label="发送消息"]:disabled {
            background: rgba(255, 255, 255, 0.08) !important;
            color: rgba(255, 255, 255, 0.25) !important;
          }

          /* ── 主题模式 2：触感/纸感模式（tactile） ── */
          [data-theme="tactile"] [data-message-composer-surface] {
            background: #ddd8c9 !important;
            color: #22231f !important;
            border: 1px solid rgba(34, 35, 31, 0.18) !important;
            box-shadow: 0 2px 8px rgba(34, 35, 31, 0.08) !important;
          }
          [data-theme="tactile"] [data-message-composer-surface]:focus-within {
            border-color: rgba(217, 169, 43, 0.6) !important;
            box-shadow: 0 4px 12px rgba(34, 35, 31, 0.12) !important;
          }
          [data-theme="tactile"] textarea.composer-textarea {
            color: #22231f !important;
          }
          [data-theme="tactile"] textarea.composer-textarea::placeholder {
            color: #8a8676 !important;
          }
          [data-theme="tactile"] button[aria-label*="添加"],
          [data-theme="tactile"] button[aria-label*="Add"],
          [data-theme="tactile"] .group\\/add {
            background: rgba(34, 35, 31, 0.08) !important;
            color: #55534a !important;
          }

          /* ── 主题模式 3：浅色模式（light）保持默认设计不用改 ── */

          /* ── 弹出菜单（权限菜单与添加菜单）在所有主题下均有实色背景 ── */
          .morph-menu-content {
            background: var(--theme-elevated, #16171b) !important;
            color: var(--theme-fg, #ededed) !important;
            border: 1px solid var(--theme-border, rgba(255,255,255,0.1)) !important;
            border-radius: 14px !important;
            box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45) !important;
          }
          [data-theme="tactile"] .morph-menu-content {
            background: #eae6da !important;
            color: #22231f !important;
            border: 1px solid rgba(34, 35, 31, 0.18) !important;
            box-shadow: 0 8px 24px rgba(34, 35, 31, 0.15) !important;
          }
          [data-theme="light"] .morph-menu-content {
            background: #ffffff !important;
            color: #1f2937 !important;
            border: 1px solid #e5e7eb !important;
            box-shadow: 0 8px 24px rgba(0, 0, 0, 0.1) !important;
          }

          ${hzRef.current.showContextRing ? '' : '.composer-model-tools > div:has(button[aria-label^="Context"]) { display: none !important; }'}
        `
        shadow.appendChild(themeStyle)

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
        if (!anchorObserver) {
          anchorObserver = new ResizeObserver(positionContextRing)
          if (host) anchorObserver.observe(host)
          const tools = shadow.querySelector('.composer-model-tools')
          if (tools) anchorObserver.observe(tools)
          const model = shadow.querySelector('.fm-model-trigger')
          if (model) anchorObserver.observe(model)
          anchorMutation = new MutationObserver(positionContextRing)
          anchorMutation.observe(shadow, { childList: true, subtree: true })
          window.addEventListener('resize', positionContextRing)
        }
        positionContextRing()

        /* ── 核心：绑定内部 Shadow DOM 原生 textarea，实现双向受控与草稿桥接 ── */
        const textarea = shadow.querySelector('textarea.composer-textarea') as HTMLTextAreaElement | null
        if (textarea) {
          textareaRef.current = textarea
          setTextareaReady(true)
          if (draftRef.current && typeof draftRef.current === 'string') {
            latestTextRef.current = draftRef.current
            writeComposerText(textarea, draftRef.current)
          }

          const handleInput = () => {
            const val = textarea.value
            latestTextRef.current = val
            /* 程序化同步（清空/回填草稿）产生的 input 不是用户操作：
               不能推进输入轮次，否则「刚发送」标记会被自己清空动作作废，
               迟来的 flush 又把已发文字写回草稿。 */
            if (!programmaticWrite) userInputRef.current?.()
            draftChangeRef.current?.(val)
          }
          const handleBlur = () => {
            flushRef.current?.(textarea.value)
          }
          textarea.addEventListener('input', handleInput)
          textarea.addEventListener('blur', handleBlur)
        }

        return true
      }

      /* 先隐藏 → 替换 → 显示，三步在同一帧内完成，用户看不到中间态。
         ⚠️ 但隐藏必须**无论如何都恢复**：官方舞台是 600px 的可见画布，
         我们只替换掉它。若 flatten 失败而 host 仍停在 hidden，
         整个输入框就都不可见、不可点 —— 用户看到一块空白，键盘也无法聚焦
         （真机复现过：textarea 存在但 visibility:hidden，点击落到外层容器）。
         所以这里用 try/finally 保证恢复，并允许多帧重试。 */
      const host = hostRef.current
      if (host) host.style.visibility = 'hidden'
      let frames = 0
      const restore = () => {
        const h = hostRef.current
        if (h) h.style.visibility = ''
      }
      const attempt = () => {
        frames += 1
        let ok = false
        try {
          ok = flatten()
        } catch {
          ok = false
        }
        if (ok) {
          restore()
          return
        }
        /* 失败原因几乎都是「官方组件还没把 stage/composer 渲染出来」——
           它是异步挂载的，rAF 一帧未必够。用 rAF 连试若干帧，
           再退到定时重试，总共约 2 秒；仍不行才放弃并恢复可见
           （宁可露出官方原样舞台，也不能让输入框永久不可见）。 */
        if (frames < 12) {
          requestAnimationFrame(attempt)
        }
      }
      requestAnimationFrame(attempt)
      /* 定时兜底：不依赖 rAF（后台标签页里 rAF 会被节流甚至暂停） */
      const retryTimer = window.setInterval(() => {
        if (flatten()) {
          window.clearInterval(retryTimer)
          restore()
        }
      }, 200)
      window.setTimeout(() => {
        window.clearInterval(retryTimer)
        restore()
      }, 2200)
    }).catch((error: unknown) => {
      /* 加载失败要说清楚：静默留一个空框会让人以为输入框坏了 */
      if (hostRef.current) {
        hostRef.current.textContent = `输入框加载失败：${error instanceof Error ? error.message : '未知错误'}`
      }
    })

    return () => {
      disposed = true
      themeObserver?.disconnect()
      anchorObserver?.disconnect()
      anchorMutation?.disconnect()
      cancelAnimationFrame(anchorFrame)
      window.removeEventListener('resize', positionContextRing)
      host.removeAttribute('data-context-anchored')
      if (textareaRef.current) {
        flushRef.current?.(textareaRef.current.value)
      }
      instanceRef.current?.destroy?.()
      instanceRef.current = null
      textareaRef.current = null
      setTextareaReady(false)
    }
    /* remountTick：停止能力变化时重建官方组件，才能切换发送/停止键。 */
  }, [remountTick])

  /**
   * 把外部草稿写回官方组件的 textarea。
   *
   * <p><strong>为什么故意不写依赖数组</strong>：官方组件是异步挂载的，
   * textarea 在 shadow DOM 里出现的时间不确定。若只在 [draft] 变化时执行，
   * 「刷新后草稿从 localStorage 恢复」这一场景就会漏掉 —— 那时 draft 早在
   * 绑定完成前就有值了，effect 执行时 textareaRef 还是 null，之后不再重跑，
   * 结果就是「草稿在存储里、输入框却空着」（真机实测复现）。
   * 每次渲染都校验一次代价极小（一次字符串比较），且能保证在 textarea
   * 就绪的那一刻补上；正常输入时两者相等，不会覆盖用户正在打的字。</p>
   */
  useEffect(() => {
    const textarea = textareaRef.current
    if (!textarea || draft === undefined) return
    if (textarea.value === draft) return
    latestTextRef.current = draft
    writeComposerText(textarea, draft)
    /* 草稿被外部清空（发送成功）时，官方输入框里可能还留着原文。
       不同步清掉的话，它的 blur / unmount 回调会把旧文字 flush 回草稿，
       用户下次进来就看到「已经发出去的话还在输入框里」。 */
    if (draft === '' && textarea.value !== '') {
      writeComposerText(textarea, '')
    }
  })

  useEffect(() => {
    instanceRef.current?.update?.({ busy: canStop ? busy : false, stopping })
  }, [busy, stopping, canStop])

  /**
   * 工程任务运行中（busy 为真但停不了）时，锁住整个输入框。
   *
   * <p>为什么用官方的 `disabled` 而不是自己改按钮：官方把它映射成宿主元素的
   * `inert`，是整体不可交互的语义 —— 既阻止重复提交，也不会画出一个
   * 看着能停、实际停不了的停止键。取消入口在下方任务面板。</p>
   */
  useEffect(() => {
    const locked = Boolean(busy) && !canStop
    instanceRef.current?.update?.({ disabled: locked })
    const host = hostRef.current
    if (host) {
      if (locked) {
        host.title = '工程任务进行中，取消入口在下方任务面板'
        host.setAttribute('data-locked-by-task', '')
      } else {
        host.removeAttribute('title')
        host.removeAttribute('data-locked-by-task')
      }
    }
  }, [busy, canStop, remountTick])

  /**
   * onStop 从无到有（或反之）时，必须重新挂载官方组件才能切换「发送/停止」键：
   * mount 时没传 onStop 的话，update() 也无法补上这个回调。
   * 只在布尔状态翻转时重挂，避免每次渲染都重建输入框。
   */
  const prevCanStopRef = useRef(canStop)
  useEffect(() => {
    if (prevCanStopRef.current === canStop) return
    prevCanStopRef.current = canStop
    /* 官方实例没有暴露「重新绑定回调」的入口，只能重建。
       重建前把当前文本留住，重建后由草稿回填 effect 写回去。 */
    const text = textareaRef.current?.value ?? draftRef.current ?? ''
    instanceRef.current?.destroy?.()
    instanceRef.current = null
    textareaRef.current = null
    setTextareaReady(false)
    latestTextRef.current = text
    draftRef.current = text
    /* 触发挂载 effect 重跑：用一个递增 key 无法在这里做到，
       改为直接调用内部的挂载函数 —— 见下方 remount 状态。 */
    setRemountTick((n) => n + 1)
  }, [canStop])

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
      selectedHarnessId: harness ?? null,
      selectedEffort: effectiveEffort,
      modelTrigger,
      showContextRing,
      modelsByHarness: modelsByHarness ?? {},
    })
  }, [harnesses, harness, modelsByHarness, effectiveEffort, modelTrigger, showContextRing])

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
    <div ref={hostRef} className="lbx-host" data-ready={undefined}
      style={{ '--lbx-engine-color': HARNESSES.find((h) => h.id === (harness === 'dsh-sdk' ? 'deepseek' : harness))?.color ?? 'var(--fg)' } as CSSProperties}>
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
