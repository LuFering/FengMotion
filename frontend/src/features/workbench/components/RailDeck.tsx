import { useEffect, useRef, useState, type ReactNode } from 'react'

/* ── 左栏：场景列表（paba .fw-ing）────────────────────────── */

/* ── 牌堆 ────────────────────────────────────────────────────────
   待决定与已确认共用同一套交互（原来只有待决定有，已确认是一行行平铺的记录）：
   牌堆态：下方 ‹ › 切换最前卡（循环，中间圆点指示位置、可点选），点主卡散开成列表；
   列表态：每张小卡右侧 › 键开弹窗看详情，控制区只剩聚拢键；
   形态切换用 FLIP（切换前量位置、切换后反向位移再过渡回自然位置），
   与切换动效同一套过渡（transform/背景/阴影/标题色）。
   卡片尺寸固定：小卡高度写死、内容裁切（标题单行省略、提示最多两行），
   最前卡矮、后层卡长时也不再从牌堆底下漏字。

   两处只有三件事不同，都由 props 决定：圆点语义、卡片高度（记事的正文只有一行）、
   弹窗正文。所以抽成一个组件，而不是抄两份 —— 抄两份迟早会漂移。 */
export type DeckEntry = { id: string; title: string; hint: string
  /** 单张卡自己的圆点语义；不给就随整摞的 dotStatus */
  s?: 'done' | 'waiting' | 'running' | 'failed' | 'idle'
  /** 文件卡的卡面：有缩略图就用它，没有就落到 icon（按格式认） */
  thumb?: string
  icon?: ReactNode }

export function RailDeck<T extends DeckEntry>({ items, dotStatus, variant, leavingId, removingId, renderModal }: {
  items: T[]
  dotStatus: 'waiting' | 'done' | 'idle'
  /** decision / record = 文字卡（决定与记录）；file = 文件卡（卡面就是那个文件） */
  variant: 'decision' | 'record' | 'file'
  /** 父级给出结论后触发滑出 / 右滑淡出；动画结束后父级再把这条从 items 里去掉 */
  leavingId?: string | null
  removingId?: string | null
  /** › 打开的弹窗正文。ctx.source 是这条当前所在的形态 —— 两种形态退场动画不同 */
  renderModal: (item: T, ctx: { close: () => void; source: 'stack' | 'list' }) => ReactNode
}) {
  const [listOpen, setListOpen] = useState(false)
  const [frontId, setFrontId] = useState<string | null>(null)
  const [modal, setModal] = useState<T | null>(null)
  const deckRef = useRef<HTMLDivElement | null>(null)
  const flipSnap = useRef<{ rects: Map<string, { left: number; top: number }>; height: number } | null>(null)
  useEffect(() => {
    if (!modal) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setModal(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [modal])
  const effectiveFrontId = frontId && items.some((d) => d.id === frontId) ? frontId : null
  const frontCardId = effectiveFrontId ?? items[0]?.id
  const frontIndex = frontCardId ? items.findIndex((d) => d.id === frontCardId) : 0
  const ordered = frontCardId
    ? [...items.filter((d) => d.id === frontCardId), ...items.filter((d) => d.id !== frontCardId)]
    : items
  const stepFront = (dir: 1 | -1) => {
    if (items.length <= 1) return
    setFrontId(items[(frontIndex + dir + items.length) % items.length].id)
  }
  /* 牌堆态 DOM 顺序固定为原始顺序，只用 data-pos 换前后——切卡时不挪节点，
     否则被挪的节点会丢过渡（实测：旧卡 30ms 就跳到最终位置，新卡却正常过渡）。

     叠几层：作者定稿最多 5 张。原来 pos > 2 一律压成 pos=2 且完全透明，于是
     5 张卡看着只有 2 层，点圆点跳到第 4 张时外观和第 1 张一模一样，只有字在变 ——
     看不出自己在哪。现在改成按脸位（rank）递进，但**封顶 MAX_STACK**：
       · rank 1 / 2 照旧错开（10px / 16px），带纸边阴影；
       · rank 3 / 4 继续往外退、逐渐变淡，凑满「看得见的 5 张」；
       · rank >= 5 既不叠也不再露出纸边（data-hidden），只留一个隐藏节点。
     保留隐藏节点是有意的：DOM 里每张卡都在，切卡只是换 data-pos，节点不增删，
     transition 才有东西可过渡；删掉节点那一次切换会闪、会丢动画。 */
  const MAX_STACK = 5
  const nonFront = items.filter((d) => d.id !== frontCardId)
  const stackCards = items.map((d) => {
    const rank = d.id === frontCardId ? 0 : 1 + nonFront.findIndex((x) => x.id === d.id)
    const pos = rank <= 2 ? rank : 2
    return {
      d, pos, rank,
      depth: Math.min(rank, MAX_STACK - 1),
      under: rank > 2 && rank < MAX_STACK,
      hidden: rank >= MAX_STACK,
    }
  })
  /* 散开成列表时用 ordered（当前卡在前、其余按原始顺序接上），不用 items ——
     实测：用原始顺序时，用户在牌堆第 5 张点开列表，自己看的那张却排在列表第 1 位，
     和圆点显示的位置对不上。散开是从"这一张"展开的，列表就该从这一张开始。 */
  const shown = listOpen
    ? ordered.map((d, i) => ({ d, pos: undefined as number | undefined, rank: i, depth: i, under: false, hidden: false }))
    : stackCards
  const captureFlip = () => {
    const deckEl = deckRef.current
    if (!deckEl) return
    const rects = new Map<string, { left: number; top: number }>()
    deckEl.querySelectorAll('.fw-deck-card').forEach((el) => {
      const id = (el as HTMLElement).dataset.id
      if (!id) return
      const r = el.getBoundingClientRect()
      rects.set(id, { left: r.left, top: r.top })
    })
    flipSnap.current = { rects, height: deckEl.getBoundingClientRect().height }
  }
  const toggleList = (next: boolean) => { captureFlip(); setListOpen(next) }
  useEffect(() => {
    const snap = flipSnap.current
    const deckEl = deckRef.current
    if (!snap || !deckEl) return
    flipSnap.current = null
    const cards = [...deckEl.querySelectorAll('.fw-deck-card')] as HTMLElement[]
    const newH = deckEl.getBoundingClientRect().height
    cards.forEach((el) => {
      const old = snap.rects.get(el.dataset.id || '')
      if (!old) return
      const r = el.getBoundingClientRect()
      el.style.transition = 'none'
      el.style.transform = `translate(${old.left - r.left}px, ${old.top - r.top}px)`
    })
    void deckEl.offsetHeight
    cards.forEach((el) => { el.style.transition = ''; el.style.transform = '' })
    deckEl.style.transition = 'height .3s ease'
    deckEl.style.height = `${snap.height}px`
    void deckEl.offsetHeight
    deckEl.style.height = `${newH}px`
    const clear = () => { deckEl.style.transition = ''; deckEl.style.height = '' }
    deckEl.addEventListener('transitionend', clear, { once: true })
    window.setTimeout(clear, 350)
  }, [listOpen])
  if (items.length === 0) return null
  return (
    <>
      <div className={`fw-deck fw-deck--${variant}${listOpen ? ' is-list' : ''}`} ref={deckRef}>
        {shown.map(({ d, pos, depth, under, hidden }) => {
          const front = !listOpen && pos === 0
          /* 文件卡：整张卡就是那个文件本身 —— 图片/视频给画面，没有画面的格式
             给格式图标。不再挂文件名和「引用 · 可商用」那一行：这是一摞素材的
             缩略浏览，卡上一写字，画面就被压掉三成，而且这些字段（授权、审核、
             时长）在预览弹窗里已经有完整一份，卡上再抄一遍是重复。
             点卡即预览（不做「散开成列表」——那是决定卡用来翻多条记录的形态）。 */
          if (variant === 'file') {
            return (
              <div key={d.id} data-id={d.id} className="fw-deck-card"
                   data-pos={pos}
                   data-depth={depth}
                   data-under={under || undefined}
                   data-hidden={hidden || undefined}
                   style={{ '--depth': String(depth) } as React.CSSProperties}
                   aria-hidden={!front ? true : undefined}
                   aria-label={d.title}
                   onClick={front ? () => setModal(d) : undefined}>
                <span className="fw-file-face">
                  {d.thumb ? <img src={d.thumb} alt="" /> : <span className="fw-file-ph">{d.icon}</span>}
                </span>
              </div>
            )
          }
          return (
            <div key={d.id} data-id={d.id} className="fw-rail-decision fw-deck-card"
                 data-pos={pos}
                 data-depth={depth}
                 data-under={under || undefined}
                 data-hidden={hidden || undefined}
                 style={{ '--depth': String(depth) } as React.CSSProperties}
                 data-leaving={leavingId === d.id || undefined}
                 data-removing={removingId === d.id || undefined}
                 aria-hidden={!listOpen && !front ? true : undefined}
                 onClick={!listOpen && front ? () => toggleList(true) : undefined}>
              <span className="fm-dot" data-s={d.s ?? dotStatus} />
              <span className="fw-rail-decision-main">
                <b>{d.title}</b>
                <small>{d.hint}</small>
              </span>
              <button type="button" className="fw-deck-marker" aria-label={`查看${d.title}详情`}
                      onClick={(e) => { e.stopPropagation(); setModal(d) }}>›</button>
            </div>
          )
        })}
      </div>
      {/* 只有一张卡时整组控件不出现：‹ › 渲染出来也是 disabled、点了没反应，
          圆点更是只有一个高亮长条 —— 没有选择可做的时候，别摆出选择的架势。 */}
      {(listOpen || items.length > 1) && (
        <div className="fw-deck-controls">
          {listOpen ? (
            <button type="button" className="fw-deck-gather" onClick={() => toggleList(false)}>聚拢 ↑</button>
          ) : (
            <span className="fw-deck-switch">
              <button type="button" className="fw-deck-switch-btn" aria-label="上一张"
                      onClick={() => stepFront(-1)}>‹</button>
              <span className="fw-deck-dots">
                {items.map((d) => (
                  <button key={d.id} type="button" className="fw-deck-dot"
                          data-active={d.id === items[frontIndex]?.id || undefined}
                          aria-label={`看${d.title}`} onClick={() => setFrontId(d.id)} />
                ))}
              </span>
              <button type="button" className="fw-deck-switch-btn" aria-label="下一张"
                      onClick={() => stepFront(1)}>›</button>
            </span>
          )}
        </div>
      )}
      {modal && (
        <div className="fw-modal-backdrop" onClick={() => setModal(null)}>
          <div className="fw-modal" role="dialog" aria-modal="true" aria-label={`${modal.title}详情`}
               onClick={(e) => e.stopPropagation()}>
            {renderModal(modal, { close: () => setModal(null), source: listOpen ? 'list' : 'stack' })}
          </div>
        </div>
      )}
    </>
  )
}
