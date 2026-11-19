import type * as React from 'react'
import { useEffect } from 'react'
import { springKeyframes, MORPH } from '@/features/chat/components/leibox/leiboxMotion'

export interface UseContextPopoverArgs {
  ctxClosing: boolean
  ctxOpen: boolean
  hoverTimer: React.RefObject<number | null>
  popRef: React.RefObject<HTMLDivElement | null>
  ringRef: React.RefObject<HTMLButtonElement | null>
  setCtxClosing: React.Dispatch<React.SetStateAction<boolean>>
  setCtxOpen: React.Dispatch<React.SetStateAction<boolean>>
}

/** 输入框上下文圆环的悬停卡片：控制悬停开合，并负责圆环与卡片之间的展开、收回形变动画。 */
export function useContextPopover({ ctxClosing, ctxOpen, hoverTimer, popRef, ringRef, setCtxClosing, setCtxOpen }: UseContextPopoverArgs) {
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
  return { openCtx, closeCtx }
}
