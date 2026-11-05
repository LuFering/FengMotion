/**
 * 「更多」抽屉 —— 特效库 / 参考片库 / 我的素材 的统一入口。
 *
 * 为什么收进抽屉而不是留在导航栏：
 *   导航栏收起态只有 68px，三个库各占一行、字号压到 9px，
 *   六个图标挤在一起谁也认不清。收进一个入口后，
 *   抽屉里可以放宽排版、补一句说明，还能标出「当前所在」。
 *
 * 交互：不做遮罩式弹窗 —— 贴着导航栏右缘长出一个小浮层，
 *   垂直居中于「更多」那一项；点空白处 / Esc / 选中某项 都会关闭。
 * 展开态（216px）下样式不变 —— 弹出层只是「选择」，不改变侧栏宽度。
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { LIBRARY_VIEWS, type ViewId } from '@/shell/views'

function NavIcon({ name, className = 'ui-icon' }: { name: string; className?: string }) {
  return (
    <svg className={className} aria-hidden="true">
      <use href={`./assets/paba-icons.svg#${name}`} />
    </svg>
  )
}

/* 「更多」按钮的选择器：弹出层要对齐到它，而不是对齐到屏幕中点 */
const ANCHOR_SEL = '.nav-leaf.nav-library'
const EDGE = 12

export function LibraryDrawer({
  open, current, onClose, onPick,
}: {
  open: boolean
  current: ViewId
  onClose: () => void
  onPick: (id: ViewId) => void
}) {
  const firstRef = useRef<HTMLButtonElement>(null)
  const asideRef = useRef<HTMLElement>(null)
  const [top, setTop] = useState<number | null>(null)

  /* 把浮层的垂直中心对到「更多」按钮的中心，并夹在视口内 */
  useLayoutEffect(() => {
    if (!open) return
    const place = () => {
      const anchor = document.querySelector(ANCHOR_SEL)
      const h = asideRef.current?.offsetHeight ?? 0
      if (!anchor) return
      const r = anchor.getBoundingClientRect()
      const want = r.top + r.height / 2 - h / 2
      setTop(Math.max(EDGE, Math.min(want, window.innerHeight - h - EDGE)))
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [open])

  /* 打开时焦点落到第一项：键盘用户不用先 Tab 几次才能进去 */
  useEffect(() => {
    if (!open) return
    const t = window.setTimeout(() => firstRef.current?.focus(), 40)
    return () => window.clearTimeout(t)
  }, [open])

  /* Esc 关闭 */
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  /* 不做遮罩式大弹窗：入口在导航栏上，结果就贴着导航栏长出来。
     页面其余部分保持可交互（不设遮罩），点空白处或 Esc 关闭。 */
  return (
    <>
      <aside
        ref={asideRef}
        className="libd"
        role="dialog"
        aria-label="选择库"
        style={top == null ? { visibility: 'hidden' } : { top }}
      >
        <header className="libd-head">
          <h2>更多</h2>
          <p>素材、参考与技法，按用途分开存放。</p>
        </header>

        <ul className="libd-list">
          {LIBRARY_VIEWS.map((v, i) => (
            <li key={v.id}>
              <button
                ref={i === 0 ? firstRef : undefined}
                type="button"
                className="libd-item"
                data-on={current === v.id || undefined}
                onClick={() => onPick(v.id)}
              >
                <span className="libd-item-ico"><NavIcon name={v.icon} /></span>
                <span className="libd-item-main">
                  <b>{v.label}</b>
                  <small>{v.hint}</small>
                </span>
                {current === v.id && <span className="libd-item-cur">当前</span>}
              </button>
            </li>
          ))}
        </ul>
      </aside>
      <div className="libd-away" onClick={onClose} aria-hidden="true" />
    </>
  )
}
