import { useEffect, useMemo, useRef, useState } from 'react'
import { CARDS, CATS, GENOMES, HOME_REEL, SOURCES } from '@/data/knowledge'
import type { Genome, ShotCard } from '@/data/knowledge'

/**
 * 首页 —— 展示**知识层**，不是工作流。
 *
 * 四块：① 创作入口 ② 镜头卡库（轮播 + 网格）③ 视频类型 ④ 制作方法
 *
 * 两条展示原则：
 *   · **画面占满，文字压到两行** —— 卡的主体是图/视频，不是说明
 *   · **只展示精选** —— 全铺拖垮首屏，也淹没重点（精选名单在 data 层，将来后端下发）
 *
 * ⚠️ 通用件一律用 @/styles/fm-components.css 的组件，不在本页重造：
 *     .fm-sheet 创作纸片   .fm-cand 图+文卡片   .fm-step 卡点行   .fm-tag 标签
 *     home.css 里只有首页独有的排布（网格容器 / 轮播 / 悬停聚焦）。
 */

/** 时长只报一个数 —— 括号里的帧数/分段是详情页的事，卡上放不下也不该放 */
export function durText(dur: string): string {
  const head = dur.split('（')[0].trim()
  const m = head.match(/(约|~|≈)?\s*\d+(?:\.\d+)?(?:\s*[–—-]\s*\d+(?:\.\d+)?)?\s*s/)
  const t = (m ? m[0] : head.split(/[+，,·]/)[0]).trim()
  return t.replace(/\s+/g, ' ').replace(/^(约|~|≈)\s+/, '$1') || '—'
}

function Icon({ name, className = 'ui-icon' }: { name: string; className?: string }) {
  return (
    <svg className={className} aria-hidden="true">
      <use href={`/assets/paba-icons.svg#${name}`} />
    </svg>
  )
}

/** 区块头：图标 + 标题 —————— 数据 + 入口
    编号（01–04）与大写英文副标都去掉了：四块是并列的知识面，不是步骤序列，
    编号只会假装有先后。图标留作索引（它确实指代内容），标题后一小段线把
    视线牵到右侧的数据/入口 —— 四个头仍在同一条视觉线上，但不再套同一副模板。 */
function Heading({ icon, title, meta, action }:
  { icon: string; title: string
    meta?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="fm-heading">
      <span className="fm-hd-idx" aria-hidden="true">
        <Icon name={icon} className="ui-icon" />
      </span>
      <h2>{title}</h2>
      <span className="fm-hd-rule" aria-hidden="true" />
      {meta ? <span className="fm-hd-meta num">{meta}</span> : null}
      {meta && action ? <span className="fm-hd-sep" aria-hidden="true" /> : null}
      {action}
    </div>
  )
}

/** 三挡示例 —— 点一下换一句**示范写法**（不是模板）。
    每句都对应一类真能做的片子，用户照着改就能开工。 */
const PRESETS = [
  { id: 'idea',    label: '短片构思', icon: 'sparkles',
    ph: '雨夜车站，两位多年未见的朋友重逢。写一段故事，再拆成三个镜头。' },
  { id: 'product', label: '产品广告', icon: 'clapperboard',
    ph: '给一台便携咖啡机做 15 秒广告：开场拍水流特写，中间拆三个卖点，最后落版。' },
  { id: 'story',   label: '故事分镜', icon: 'file-text',
    ph: '把《静夜思》改成 6 个镜头的分镜：从空镜一路推到人物特写，节奏先慢后快。' },
] as const

const BY_ID = new Map(CARDS.map((c) => [c.id, c]))

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi)

export function Home({ onOpenProject, onStart }:
  { onOpenProject: (view: string) => void
    /** 带着输入框里的想法进工作台（不再只是跳转 —— 想法要真的落进对话输入框） */
    onStart?: (prompt: string) => void }) {
  const [prompt, setPrompt] = useState('')
  const [preset, setPreset] = useState('idea')
  const taRef = useRef<HTMLTextAreaElement>(null)

  /** 从别处切到某个片型的做法：切 tab + 滚过去（顶部留 84px 给页头） */
  /* 带子里 ← → 走格（在容器上兜住，格子自己的方向键也走这条路） */
  const stripKeys = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
    const all = [...e.currentTarget.querySelectorAll('.fm-mcard')] as HTMLElement[]
    const i = all.indexOf(document.activeElement as HTMLElement)
    if (i < 0) return
    e.preventDefault()
    all[Math.min(all.length - 1, Math.max(0, i + (e.key === 'ArrowRight' ? 1 : -1)))]?.focus()
  }

  /* 「看做法」只是导航：滚到做法区，**不再**给下面那张画框/点亮 ——
     两段互不关联，指针在哪一段只有那一段动。 */
  const showMethod = () => {
    const el = methodRef.current
    if (!el) return
    window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 84, behavior: 'smooth' })
  }

  /* 标签页切走 → 停掉正在播的预览（paba 的 visibilitychange 处理） */
  useEffect(() => {
    const onHide = () => {
      if (!document.hidden) return
      document.querySelectorAll('video').forEach((v) => v.pause())
    }
    document.addEventListener('visibilitychange', onHide)
    return () => document.removeEventListener('visibilitychange', onHide)
  }, [])

  const methodRef = useRef<HTMLElement>(null)
  const [fading, setFading] = useState(false)
  const fadeTimer = useRef<number | undefined>(undefined)
  /** 换示例：先淡出、换字、再淡入 —— paba .hm-partner-example.is-fading 的做法 */
  const pickPreset = (id: string) => {
    if (id === preset) return
    setFading(true)
    window.clearTimeout(fadeTimer.current)
    fadeTimer.current = window.setTimeout(() => { setPreset(id); setFading(false) }, 180)
  }

  /* 轮播用有动作预览的那批 —— 轮播的价值就在"当前项会动" */
  const reelCards = useMemo(
    () => HOME_REEL.map((id) => BY_ID.get(id)).filter((c): c is ShotCard => !!c?.motion),
    [],
  )
  const example = PRESETS.find((p) => p.id === preset)?.ph ?? ''

  return (
    <div className="hm-content" data-view="home">

      {/* ═══ ⓪ 页头 —— 身份 + 一句承诺，左对齐 ══════════════════
          之前居中放一个 logo：它只报名字，和下面左对齐的内容形成两条轴。
          现在锁定版贴内容左缘，旁边直接接这句产品承诺 —— 首屏第一眼读到的是
          「这产品替你做哪件事」，而不是一个标志。 */}
      <header className="fm-hero">
        <img className="fm-hero-lockup" src="/assets/brand/fengmotion-lockup.png"
             alt="FengMotion" width={1040} height={237} />
        <p className="fm-hero-line">把一个想法，拆成镜头、动效和成片。</p>
      </header>

      {/* ═══ ① 创作入口（.fm-sheet 纸片）════════════════════════ */}
      <form className="fm-sheet" onSubmit={(e) => {
        e.preventDefault()
        const v = prompt.trim()
        if (!v) return
        if (onStart) onStart(v)
        else onOpenProject('production')
      }}>
        <div className="fm-new-top">
          <label htmlFor="fm-prompt">创作想法</label>
          {/* 空态只留「示例句」一个信号：0/4000 和示例句并置，会让人分不清
              现在到底有没有内容。有输入才出现计数。 */}
          {prompt.length > 0 && <span className="num">{prompt.length} / 4000</span>}
        </div>

        <div className="fm-new-editor">
          {!prompt && (
            <div className="fm-new-ph">
              {/* 「示例」是个**动作**：点一下把示范写法填进输入框，光标落到句尾。
                  只标一个灰字说明不了它是示例，也没法用起来。 */}
              <button type="button" className="fm-new-ph-fill"
                      title="把这条示例填进输入框"
                      onClick={() => {
                        setPrompt(example)
                        requestAnimationFrame(() => {
                          const ta = taRef.current
                          if (!ta) return
                          ta.focus()
                          ta.setSelectionRange(example.length, example.length)
                        })
                      }}>
                <Icon name="plus" />示例
              </button>
              <span className={'fm-new-ph-text' + (fading ? ' is-fading' : '')}
                    aria-hidden="true">{example}</span>
            </div>
          )}
          <textarea id="fm-prompt" rows={2} maxLength={4000} required
                    aria-label="创作想法" ref={taRef}
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)} />
        </div>

        <div className="fm-new-foot">
          <div className="fm-new-presets" role="group" aria-label="创作示例">
            {PRESETS.map((p) => (
              <button key={p.id} type="button" className="fm-chip"
                      aria-pressed={preset === p.id}
                      onClick={() => pickPreset(p.id)}>
                <Icon name={p.icon} />{p.label}
              </button>
            ))}
          </div>
          <div className="fm-new-actions">
            {!prompt.trim() && <span className="fm-new-hint">先写一句想法</span>}
            {/* 「生成」说得太满（这里并不生成，是把想法交给工作台分镜）；
                换成「开始分镜」，按下的结果和按钮上的字一致。 */}
            <button type="submit" className="fm-pill-go" disabled={!prompt.trim()}>
              <Icon name="clapperboard" /><span>开始分镜</span>
            </button>
          </div>
        </div>
      </form>

      {/* ═══ ① 镜头卡库（轮播）═══════════════════════════════════
          全页唯一的「大胆」：一整条会动的镜头带。其余区块都为它让路。 */}
      <section className="fm-sec">
        <Heading icon="clapperboard" title="镜头卡库"
                 meta={<>{CARDS.length} 张 · {CATS.length - 1} 类</>}
                 action={
                   <button onClick={() => onOpenProject('knowledge')}>
                     全部<Icon name="chevron-right" className="ui-icon fm-go-arrow" />
                   </button>
                 } />

        {/* 轮播：当前项撑开 + 浮起 + 点亮 + 播放，其余压暗收窄（可拖 / 可滚 / 可点箭头） */}
        <Reel cards={reelCards} onOpen={() => onOpenProject('knowledge')} />
      </section>

      {/* ═══ ② 视频类型 —— 文字索引，不放缩略图 ═══════════════════
          和下面「制作方法」是同一批片型：这里回答「有哪几种、各自什么特征」，
          用可数的指纹说话；画面留给胶片带 —— 两段不再各铺一遍图。 */}
      <section className="fm-sec fm-sec-pair">
        <Heading icon="shapes" title="视频类型"
                 meta={<>{GENOMES.length} 种 · {GENOMES.filter((g) => g.from === '实测').length} 种来自参考拆解实测</>}
                 action={
                   <button onClick={() => onOpenProject('reference')}>
                     看拆解<Icon name="chevron-right" className="ui-icon fm-go-arrow" />
                   </button>
                 } />

        <div className="fm-types">
          {GENOMES.map((g) => (
            <TypeRow key={g.id} g={g} onOpen={showMethod} />
          ))}
        </div>
      </section>

      {/* ═══ ③ 制作方法 —— 片型胶片带（媒体在这一段）═════════════
          卡 = 媒体（16:10，悬停播动作预览 + 拖动擦洗）+ 角标 + 标题 + 一行小字；
          没有面板、没有步骤列表、没有 tab —— 六个片型平铺，图说话。 */}
      <section className="fm-sec" ref={methodRef}>
        <Heading icon="workflow" title="制作方法"
                 meta={<>{GENOMES.length} 种片型 · 各一套做法</>}
                 action={
                   <button onClick={() => onOpenProject('methods')}>
                     完整流程<Icon name="chevron-right" className="ui-icon fm-go-arrow" />
                   </button>
                 } />

        <div className="fm-strip" onKeyDown={stripKeys}>
          {GENOMES.map((g) => (
            <MethodCard key={g.id} g={g} onOpen={() => onOpenProject('knowledge')} />
          ))}
        </div>
      </section>

      {/* ═══ ④ 动效来源 —— 页尾一行，不再单独占一块 ══════════════
          它解释「动效从哪来」，是脚注不是展区：一行小 logo + 名字收住整页，
          页尾因此不再断在卡片后面留一块死白。 */}
      <footer className="fm-src-line">
        <span className="fm-src-line-label">动效来源</span>
        {SOURCES.map((s) => (
          <a key={s.id} className="fm-src-mini" href={s.url} target="_blank" rel="noreferrer noopener"
             style={{ ['--tone' as string]: s.tone }}
             title={`${s.name} · ${s.what}（${s.count}）`}>
            <img src={s.logo} alt="" loading="lazy" />
            <b>{s.name}</b>
          </a>
        ))}
        <span className="fm-src-line-note">全部开源 · 点开是各自的在线画廊</span>
      </footer>
    </div>
  )
}

/* ── 悬停预览：两段共用同一台引擎 ═══════════════════════════════
   规则来自 paba（懒赋 src / 指着才播 / 离开 400ms 后归零 / 触屏不触发），
   但**形态是我们自己的**：这张带子里它服务于"聚光 + 擦洗"两个交互。 */
function HoverVideo({ src, poster, live, className, videoRef }:
  { src?: string; poster?: string; live: boolean; className: string
    videoRef?: React.RefObject<HTMLVideoElement | null> }) {
  const inner = useRef<HTMLVideoElement>(null)
  const v = videoRef ?? inner
  useEffect(() => {
    const el = v.current
    if (!el) return
    if (live) { el.play().catch(() => {}) ; el.classList.add('is-playing') }
    else {
      el.pause(); el.classList.remove('is-playing')
      const t = window.setTimeout(() => { el.currentTime = 0 }, 400)   // 400ms 后归零
      return () => window.clearTimeout(t)
    }
  }, [live, src])
  if (!src) return null
  /* eslint-disable-next-line jsx-a11y/media-has-caption */
  return (
    <video ref={v} className={className} src={live ? src : undefined}   /* 要播才赋 src */
           poster={poster} muted loop playsInline preload="none" />
  )
}

/* ── 视频类型的一行（文字索引）────────────────────────────────
   名称 + 三条可数的指纹 + 入口。没有缩略图：媒体归下面的胶片带，
   这一行只负责把「有哪几种、各自什么特征」讲清楚。 */
function TypeRow({ g, onOpen }: { g: Genome; onOpen: () => void }) {
  return (
    <button className="fm-type" type="button" onClick={onOpen}
            aria-label={`看${g.name}怎么做`}>
      <b>{g.name}{g.from === '实测' && <i className="fm-type-real">实测</i>}</b>
      <span className="fm-type-fp">
        {g.fp.slice(0, 3).map((f) => (
          <i key={f.k}>{f.k.split(' ')[0]}<em>{f.v}</em></i>
        ))}
      </span>
      <span className="fm-type-do">
        {g.method.name}<Icon name="chevron-right" className="ui-icon fm-go-arrow" />
      </span>
    </button>
  )
}

/* ── 片型卡（胶片带里的一格）═══════════════════════════════════
   指着它：这一格**变宽**（像镜头拉近），其余压暗；动作预览开始播；
   画面底部浮出四条短标（步骤轨，一条一条亮起来，不是一坨文字）；
   在画面上**左右拖动** = 擦洗动作预览（手指到哪一帧就停哪一帧）；
   ← → 键在带子里走动。 */
function MethodCard({ g, onOpen }: { g: Genome; onOpen: () => void }) {
  const [over, setOver] = useState(false)
  const [scrub, setScrub] = useState<number | null>(null)
  const v = useRef<HTMLVideoElement>(null)
  const drag = useRef<{ left: number; w: number; x0: number; moved: boolean } | null>(null)
  const swallowed = useRef(false)
  const motion = g.method.mediaMotion
  const dragging = useRef(false)
  /* 只有"指针真的在这一格上"才播 —— 上面那段指着它不会让它动 */
  const live = over && !!motion

  useEffect(() => {
    const el = v.current
    if (!el) return
    if (scrub != null) return                                  // 擦洗时交给指针，别抢
    if (live) { el.play().catch(() => {}) ; el.classList.add('is-playing') }
    else {
      el.pause(); el.classList.remove('is-playing')
      const t = window.setTimeout(() => { el.currentTime = 0 }, 400)
      return () => window.clearTimeout(t)
    }
  }, [live, scrub, motion])

  return (
    <button className="fm-mcard" type="button"
            data-over={over ? '' : undefined}
            data-scrubbing={scrub != null ? '' : undefined}
            onPointerEnter={(e) => { if (e.pointerType !== 'touch') setOver(true) }}
            /* 拖动中不认"离开"：手指从画面上滑出去不算离开卡片 */
            onPointerLeave={() => { if (dragging.current) return; setOver(false) }}
            onPointerCancel={() => { drag.current = null; dragging.current = false; setScrub(null) }}
            onFocus={() => setOver(true)} onBlur={() => setOver(false)}
            onClick={(e) => { if (swallowed.current) { e.preventDefault(); return } onOpen() }}
            aria-label={`${g.name}：${g.method.name}`}>
      <span className="fm-mcard-art"
            onPointerDown={(e) => {
              if (e.button !== 0 || !motion || !v.current) return
              const r = e.currentTarget.getBoundingClientRect()
              drag.current = { left: r.left, w: r.width, x0: e.clientX, moved: false }
              dragging.current = false
            }}
            onPointerMove={(e) => {
              const d = drag.current
              if (!d || !v.current) return
              if (!d.moved && Math.abs(e.clientX - d.x0) > 3) { d.moved = true; dragging.current = true }
              if (!d.moved) return
              const p = Math.min(1, Math.max(0, (e.clientX - d.left) / d.w))
              setScrub(p)
              v.current.pause()
              v.current.currentTime = p * (v.current.duration || 3)   // 手指到哪帧就哪帧
            }}
            onPointerUp={() => {
              const d = drag.current
              drag.current = null
              dragging.current = false
              if (!d?.moved) return
              swallowed.current = true                                 // 这一次别再当点击
              window.setTimeout(() => { swallowed.current = false }, 60)
              window.setTimeout(() => setScrub(null), 320)              // 松手后进度条慢慢退
              v.current?.play().catch(() => {})
            }}>
        {g.method.media && <img src={g.method.media} alt="" loading="lazy" />}
        <HoverVideo src={motion} poster={g.method.media} live={live}
                    videoRef={v} className="fm-mcard-motion" />
        <span className="fm-mcard-tag">{g.name}</span>
        <span className="fm-mcard-seek" style={{ ['--p' as string]: scrub ?? 0 }} />
        <span className="fm-mcard-track">
          {g.method.steps.map((st, i) => (
            <i key={st.name} style={{ ['--row' as string]: i }}>
              <em>{i + 1}</em>{st.k}
            </i>
          ))}
        </span>
      </span>
      <span className="fm-mcard-foot">
        <b>{g.method.name}</b>
        <em>{g.method.lead}</em>
      </span>
    </button>
  )
}

function Reel({ cards, onOpen }: { cards: ShotCard[]; onOpen: () => void }) {
  const [active, setActive] = useState(0)
  /** 用户是否刚操作过 —— 决定用哪套过渡节奏 */
  const [touched, setTouched] = useState(false)
  /** 指针在轮播里 —— 停播。不然画面会在手底下自己跑走 */
  const [inside, setInside] = useState(false)
  /** 正在拖拽 —— 只为了给容器换光标 */
  const [dragging, setDragging] = useState(false)
  const trackRef = useRef<HTMLDivElement>(null)
  const cardRefs = useRef<(HTMLButtonElement | null)[]>([])
  /** 几何量 + 当前位移，拖动时要拿它当基准 */
  const geo = useRef({ slim: 96, wide: 384, gap: 9, offset: 0 })
  const drag = useRef<{ x: number; moved: boolean } | null>(null)
  const suppress = useRef(false)      // 拖完别把点击当点击
  const wheelAt = useRef(0)
  const items = cards
  const last = items.length - 1

  // 自动推进：按镜头时长停留（长镜头停得久）。
  // ⚠️ 用户操作过之后停一会儿再恢复自动 —— 否则刚悬停就被推走。
  // ⚠️ 指针在轮播内 / 系统开了「减弱动效」→ 不排下一拍。
  useEffect(() => {
    if (!items.length || inside) return
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    const dwell = Math.max(2600, (parseFloat(items[active]?.dur) || 4) * 600)
    const t = setTimeout(() => {
      setTouched(false)                    // 恢复自动跟随
      setActive((i) => (i + 1) % items.length)
    }, touched ? dwell + 2600 : dwell)
    return () => clearTimeout(t)
  }, [active, items, touched, inside])

  /* 让当前项居中，但**不允许留空档**：
     首项居中会把整条推到右半边（左边一片空），末项同理 —— paba 那边是滚动条
     遮住的，我们直接看得见。所以偏移量夹在 [0, 轨道全长 − 视口] 之间，到边就贴边。
     宽度从 CSS 变量读（--reel-slim / --reel-wide / gap），不在 JS 里另写一份常量：
     改样式时两边不会对不上。 */
  useEffect(() => {
    const track = trackRef.current
    const box = track?.parentElement
    if (!track || !box) return
    const cs = getComputedStyle(track)
    const slim = parseFloat(cs.getPropertyValue('--reel-slim')) || 96
    const wide = parseFloat(cs.getPropertyValue('--reel-wide')) || 384
    const gap = parseFloat(cs.gap) || 9
    const total = items.length * slim + Math.max(0, items.length - 1) * gap + (wide - slim)
    const raw = active * (slim + gap) - (box.clientWidth - wide) / 2
    const offset = Math.min(Math.max(raw, 0), Math.max(0, total - box.clientWidth))
    geo.current = { slim, wide, gap, offset }
    if (!drag.current) track.style.transform = `translateX(${-offset}px)`
  }, [active, items.length])

  const go = (i: number) => { setTouched(true); setActive(clamp(i, 0, last)) }
  const step = (d: number) => go(active + d)
  const pick = (i: number) => { if (!drag.current) go(i) }
  if (!items.length) return null

  return (
    <div className="fm-reel"
         data-drag={dragging ? '' : undefined}
         onMouseEnter={() => setInside(true)}
         onMouseLeave={() => setInside(false)}
         onWheel={(e) => {
           if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return    // 竖向留给页面
           const now = performance.now()
           if (now - wheelAt.current < 240) return
           wheelAt.current = now
           step(e.deltaX > 0 ? 1 : -1)
         }}
         onKeyDown={(e) => {
           const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
           if (!d) return
           e.preventDefault()
           const n = clamp(active + d, 0, last)
           go(n)
           cardRefs.current[n]?.focus()
         }}
         onPointerDown={(e) => {
           if (e.button !== 0) return
           drag.current = { x: e.clientX, moved: false }
           trackRef.current?.setAttribute('data-still', '')
           e.currentTarget.setPointerCapture?.(e.pointerId)
         }}
         onPointerMove={(e) => {
           const d = drag.current, track = trackRef.current
           if (!d || !track) return
           const dx = e.clientX - d.x
           if (Math.abs(dx) > 4 && !d.moved) { d.moved = true; setDragging(true) }
           if (d.moved) track.style.transform = `translateX(${-geo.current.offset + dx}px)`
         }}
         onPointerUp={(e) => {
           const d = drag.current, track = trackRef.current
           if (!d || !track) return
           const dx = e.clientX - d.x
           drag.current = null
           setDragging(false)
           track.removeAttribute('data-still')
           if (!d.moved) return                       // 没拖动 → 当成点击，交给卡片
           suppress.current = true                    // 拖完别再把这一次当点击
           const n = Math.round(dx / (geo.current.slim + geo.current.gap))
           if (n) go(active - n)
           else track.style.transform = `translateX(${-geo.current.offset}px)`
         }}>
      <div className="fm-reel-track" ref={trackRef}
           data-following={touched ? undefined : ''}>
        {items.map((card, i) => (
          <button
            key={card.id}
            className="fm-reel-card"
            type="button"
            ref={(el) => { cardRefs.current[i] = el }}
            data-active={i === active ? '' : undefined}
            onMouseEnter={() => pick(i)}
            onFocus={() => pick(i)}
            onClick={() => {
              if (suppress.current) { suppress.current = false; return }
              onOpen()
            }}
            aria-label={card.name}
          >
            <span className="fm-reel-art">
              <img src={card.poster} alt="" loading="lazy" draggable={false} />
              {card.motion && (
                <video className="fm-reel-video"
                       /* src 只给当前项 —— paba 的懒加载：不要播的东西不赋 src */
                       src={i === active ? card.motion : undefined}
                       muted loop playsInline preload="none"
                       ref={(v) => {
                         // 当前项播放，其余暂停归零 —— 和 paba 的 .is-playing 同义
                         if (!v) return
                         if (i === active) { v.classList.add('is-playing'); v.play().catch(() => {}) }
                         else { v.pause(); v.classList.remove('is-playing'); v.currentTime = 0 }
                       }} />
              )}
            </span>
            <span className="fm-reel-info">
              <b>{card.name}</b>
              <span>
                <span>{card.catCn}</span><span>·</span>
                <span>{durText(card.dur)}</span>
              </span>
            </span>
          </button>
        ))}
      </div>

      {/* 箭头：看得见的控件（首/末项置灰 —— 边界一眼可见，不是暗的按钮） */}
      <button type="button" className="fm-reel-nav" data-dir="prev"
              aria-label="上一张镜头" disabled={active === 0}
              onClick={() => step(-1)}>
        <Icon name="arrow-left" />
      </button>
      <button type="button" className="fm-reel-nav" data-dir="next"
              aria-label="下一张镜头" disabled={active === last}
              onClick={() => step(1)}>
        <Icon name="arrow-right" />
      </button>
    </div>
  )
}
