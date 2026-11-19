import type * as React from 'react'
import { useEffect } from 'react'
import { loadEngine, writeComposerText, isProgrammaticWrite } from '@/features/chat/components/leibox/leiboxEngine'
import { composerThemeCss, PILL_CSS } from '@/features/chat/components/leibox/leiboxStyles'
import type { LeiBoxSubmitPayload } from '@/features/chat/components/LeiBoxComposer'

export interface UseLeiBoxMountArgs {
  canStopRef: React.RefObject<boolean>
  draftChangeRef: React.RefObject<((text: string) => void) | undefined>
  draftRef: React.RefObject<string | undefined>
  flushRef: React.RefObject<((text: string) => void) | undefined>
  hostRef: React.RefObject<HTMLDivElement | null>
  hzRef: React.RefObject<{ harnesses: { id: string; name: string; iconUrl?: string; available?: boolean; models?: Array<{ id: string; name: string; reasoningEfforts?: string[] }> }[] | undefined; harness: string | undefined; onHarnessChange: ((id: string) => void) | undefined; modelsByHarness: Record<string, { id: string; label?: string }[]> | undefined; effectiveEffort: string; modelTrigger: 'pill' | 'square'; showContextRing: boolean }>
  instanceRef: React.RefObject<{ destroy?: () => void; update?: (options: Record<string, unknown>) => void } | null>
  latestTextRef: React.RefObject<string>
  modelCbRef: React.RefObject<((modelId: string) => void) | undefined>
  modelsRef: React.RefObject<{ id: string; label?: string }[] | undefined>
  remountTick: number
  selectedRef: React.RefObject<string | undefined>
  setLocalEffort: React.Dispatch<React.SetStateAction<string>>
  setTextareaReady: React.Dispatch<React.SetStateAction<boolean>>
  stopRef: React.RefObject<(() => void) | undefined>
  submitRef: React.RefObject<((payload: LeiBoxSubmitPayload) => void) | undefined>
  textareaRef: React.RefObject<HTMLTextAreaElement | null>
  thinkCbRef: React.RefObject<((level: string) => void) | undefined>
  userInputRef: React.RefObject<(() => void) | undefined>
}

/**
 * 挂载 LeiBox 官方输入框并适配到本页：传入引擎、模型与回调，压平演示舞台、同步主题与样式，
 * 定位上下文圆环，桥接内部输入框与草稿；remountTick 变化时整体重建。
 */
export function useLeiBoxMount({ canStopRef, draftChangeRef, draftRef, flushRef, hostRef, hzRef, instanceRef, latestTextRef, modelCbRef, modelsRef, remountTick, selectedRef, setLocalEffort, setTextareaReady, stopRef, submitRef, textareaRef, thinkCbRef, userInputRef }: UseLeiBoxMountArgs) {
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
        themeStyle.textContent = composerThemeCss(hzRef.current.showContextRing)
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
            if (!isProgrammaticWrite()) userInputRef.current?.()
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
  return {  }
}
