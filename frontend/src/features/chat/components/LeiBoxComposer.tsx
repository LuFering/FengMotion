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
import '@/features/chat/components/leibox-composer.css'
import { type MountFn, writeComposerText } from '@/features/chat/components/leibox/leiboxEngine'
import { useContextPopover } from '@/features/chat/components/leibox/useContextPopover'
import { useLeiBoxMount } from '@/features/chat/components/leibox/useLeiBoxMount'

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

  useLeiBoxMount({ canStopRef, draftChangeRef, draftRef, flushRef, hostRef, hzRef, instanceRef, latestTextRef, modelCbRef, modelsRef, remountTick, selectedRef, setLocalEffort, setTextareaReady, stopRef, submitRef, textareaRef, thinkCbRef, userInputRef })

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
  const { openCtx, closeCtx } = useContextPopover({ ctxClosing, ctxOpen, hoverTimer, popRef, ringRef, setCtxClosing, setCtxOpen })

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
