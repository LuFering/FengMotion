import { useEffect, useRef, useState, type CSSProperties, type ChangeEvent } from 'react'

/**
 * 首页 · 第一屏
 *
 * 原样取自 public/preview/home-film-v3.html 的 nav + hero；
 * 首屏动效也按原逻辑搬：逐字入场 → 牵线 → 续写 → 下划线 → 印章 → 内容上浮。
 */
const CHAR_STEP = 95
const CURVE_START = 5 * CHAR_STEP + 220
const CURVE_MS = 620
const L2_START = CURVE_START + CURVE_MS + 260
const UNDER_START = L2_START + 5 * CHAR_STEP + 260
const READY_AT = UNDER_START + 500
const MIST_PHRASES = [
  '做一个订单跟踪仪表盘原型',
  '把这段口播稿拆成分镜脚本',
  '分析这份销售数据并给出结论',
  '给这个镜头换一种运镜方式',
  '帮我写一份产品周报',
  '复刻这个界面的布局和交互',
]

/**
 * 右侧首屏轮转：文案模块 → 视频，共 3 轮。
 * 每轮只换文案与强调色；视频先放占位片段（public/media/home），后续换品牌片即可。
 */
type HeroCycle = { l1: string; l2a: string; kw: string; accent: string; reel: string }

const HERO_CYCLES: HeroCycle[] = [
  { l1: '从一句话，', l2a: '到一条', kw: '片子', accent: '#3B8CF8', reel: '/media/home/reel-1.mp4' },
  { l1: '从一个念头，', l2a: '到一场', kw: '好戏', accent: '#39B7A8', reel: '/media/home/reel-2.mp4' },
  { l1: '从一段故事，', l2a: '到一部', kw: '作品', accent: '#E08A3C', reel: '/media/home/reel-3.mp4' },
]

const HERO_LEAD = '让 AI agent 用一行行代码，重新定义你内心的小巧思。'
const TEXT_HOLD = 4600
const FLIP_MS = 620
const VIDEO_HOLD = 10000

type HeroPhase = 'text' | 'textOut' | 'video' | 'videoOut'

function Chars({ text, cls, start }: { text: string; cls: string; start: number }) {
  return (
    <>
      {[...text].map((ch, i) => (
        <span key={`${cls}-${i}`} className={`hf-char ${cls}`}
              style={{ animationDelay: `${start + i * CHAR_STEP}ms` }}>
          {ch === ' ' ? '\u00A0' : ch}
        </span>
      ))}
    </>
  )
}

function HeroTitle({ copy, cycle }: { copy: HeroCycle; cycle: number }) {
  const titleRef = useRef<HTMLHeadingElement>(null)
  const inkRef = useRef<SVGSVGElement>(null)
  const curveRef = useRef<SVGPathElement>(null)
  const underRef = useRef<SVGPathElement>(null)

  // 每轮都要重测：换文案后字宽变了（「念头」「故事」比「一句话」宽），牵线与下划线必须重算
  useEffect(() => {
    const timers: number[] = []
    const measure = () => {
      const title = titleRef.current
      const ink = inkRef.current
      const curve = curveRef.current
      const under = underRef.current
      if (!title || !ink || !curve || !under) return
      // 逐字入场带 translateY，测量时会读到动画中间态；先冻结动画再量，避免牵线/下划线偏移
      title.classList.add('is-measuring')
      const host = title.getBoundingClientRect()
      const l1 = title.querySelectorAll<HTMLElement>('.hf-char-l1')
      const l2 = title.querySelectorAll<HTMLElement>('.hf-char-l2')
      const kw = title.querySelector<HTMLElement>('.hf-kw')
      if (!l1.length || !l2.length || !kw) return
      const last = l1[l1.length - 1].getBoundingClientRect()
      const first = l2[0].getBoundingClientRect()
      const kwRect = kw.getBoundingClientRect()
      const x1 = last.right - host.left + 4
      const y1 = last.top - host.top + last.height * .62
      const x2 = first.left - host.left - 8
      const y2 = first.top - host.top + first.height * .62
      curve.setAttribute('d', `M ${x1} ${y1} C ${x1 + 78} ${y1 + 30}, ${x2 - 70} ${y2 - 40}, ${x2} ${y2}`)
      const len = curve.getTotalLength()
      curve.style.strokeDasharray = String(len)
      curve.style.strokeDashoffset = String(len)
      ink.setAttribute('viewBox', `0 0 ${host.width} ${host.height}`)
      ink.style.width = `${host.width}px`
      ink.style.height = `${host.height}px`

      const ux1 = kwRect.left - host.left
      const ux2 = kwRect.right - host.left
      const uy = kwRect.bottom - host.top + 6
      under.setAttribute('d', `M ${ux1} ${uy} C ${ux1 + 14} ${uy + 7}, ${ux2 - 16} ${uy + 9}, ${ux2} ${uy + 2}`)
      const ulen = under.getTotalLength()
      under.style.strokeDasharray = String(ulen)
      under.style.strokeDashoffset = String(ulen)
      title.classList.remove('is-measuring')
    }

    // 等字体布局稳定后再测线，避免中文换行导致路径偏
    document.fonts?.ready.then(() => { measure() })
    timers.push(window.setTimeout(measure, 60))
    timers.push(window.setTimeout(() => curveRef.current?.classList.add('is-drawn'), CURVE_START))
    timers.push(window.setTimeout(() => underRef.current?.classList.add('is-drawn'), UNDER_START))
    return () => timers.forEach((t) => window.clearTimeout(t))
  }, [cycle])

  return (
    <h1 className="hf-title" ref={titleRef}>
      <span className="hf-l1"><Chars text={copy.l1} cls="hf-char-l1" start={0} /></span>
      <span className="hf-l2"><Chars text={copy.l2a} cls="hf-char-l2" start={L2_START} /><span className="hf-kw"><Chars text={copy.kw} cls="hf-char-l2" start={L2_START + 3 * CHAR_STEP} /></span></span>
      <svg className="hf-ink" ref={inkRef} aria-hidden="true">
        <path ref={curveRef} className="hf-curve" />
        <path ref={underRef} className="hf-under" />
      </svg>
      <span className="hf-seal" aria-hidden="true">
        <svg viewBox="0 0 54 54">
          <circle cx="27" cy="27" r="25" fill="none" stroke="currentColor" strokeWidth=".8" opacity=".7" />
          <circle cx="27" cy="27" r="21" fill="none" stroke="currentColor" strokeWidth=".4" opacity=".45" />
          <text x="27" y="25" textAnchor="middle">FENG</text>
          <text x="27" y="34" textAnchor="middle">MOTION</text>
        </svg>
      </span>
    </h1>
  )
}

type Attachment = { name: string; size: number; kind: 'file' | 'image' | 'video' }

type Harness = { id: string; name: string; short: string; mark: string; models: string[]; ready: boolean }

/** 执行引擎列表：只有 deepseek 标为已配置，其余如实标注「未接入」 */
const HARNESSES: Harness[] = [
  { id: 'deepseek', name: 'DeepSeek Harness', short: 'DeepSeek', mark: 'DS', models: ['deepseek-chat', 'deepseek-reasoner', 'deepseek-v4.1-flash'], ready: true },
  { id: 'claude', name: 'Claude Code', short: 'Claude', mark: 'CC', models: ['claude-sonnet-4', 'claude-opus-4'], ready: false },
  { id: 'codex', name: 'Codex', short: 'Codex', mark: 'CX', models: ['gpt-5-codex'], ready: false },
]

const fmtSize = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)}MB`
    : bytes >= 1024 ? `${Math.round(bytes / 1024)}KB`
      : `${bytes}B`


export function Home() {
  const [ready, setReady] = useState(false)
  const [draft, setDraft] = useState('')
  const [menu, setMenu] = useState<null | 'workdir' | 'add' | 'harness'>(null)
  const [workdir, setWorkdir] = useState('~/workspace/fengmotion')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [harnessId, setHarnessId] = useState(HARNESSES[0].id)
  const [model, setModel] = useState(HARNESSES[0].models[0])
  const [toast, setToast] = useState('')
  const [phraseIndex, setPhraseIndex] = useState(0)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const moduleRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const imageRef = useRef<HTMLInputElement>(null)
  const videoRef = useRef<HTMLInputElement>(null)
  const [cycle, setCycle] = useState(0)
  const [phase, setPhase] = useState<HeroPhase>('text')
  const [reduced, setReduced] = useState(false)

  // 页面锁一页 + 首轮就绪；墨线测量搬进 HeroTitle，每轮重跑
  useEffect(() => {
    document.documentElement.classList.add('home-one-page')
    document.body.classList.add('home-one-page')
    const timer = window.setTimeout(() => setReady(true), READY_AT)
    return () => {
      window.clearTimeout(timer)
      document.documentElement.classList.remove('home-one-page')
      document.body.classList.remove('home-one-page')
    }
  }, [])

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const sync = () => setReduced(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])

  // 轮转时间线：文案停留 → 翻出 → 视频 10s → 翻出 → 下一轮
  useEffect(() => {
    if (reduced) return
    const hold = phase === 'text' ? TEXT_HOLD : phase === 'video' ? VIDEO_HOLD : FLIP_MS
    const id = window.setTimeout(() => {
      if (phase === 'text') setPhase('textOut')
      else if (phase === 'textOut') setPhase('video')
      else if (phase === 'video') setPhase('videoOut')
      else { setCycle((c) => (c + 1) % HERO_CYCLES.length); setPhase('text') }
    }, hold)
    return () => window.clearTimeout(id)
  }, [phase, reduced])

  useEffect(() => {
    if (draft) return
    const id = window.setInterval(() => setPhraseIndex((i) => (i + 1) % MIST_PHRASES.length), 4800)
    return () => window.clearInterval(id)
  }, [draft])

  useEffect(() => {
    const el = taRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 172)}px`
  }, [draft])

  // 点击模块外或 Esc 关闭气泡菜单
  useEffect(() => {
    if (!menu) return
    const onDown = (e: MouseEvent) => {
      if (!moduleRef.current?.contains(e.target as Node)) setMenu(null)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(null) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [menu])

  useEffect(() => {
    if (!toast) return
    const id = window.setTimeout(() => setToast(''), 2600)
    return () => window.clearTimeout(id)
  }, [toast])

  const pickFiles = (kind: Attachment['kind']) => (e: ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? []).map((f) => ({ name: f.name, size: f.size, kind }))
    setAttachments((prev) => [...prev, ...picked].slice(0, 6))
    e.target.value = ''
    setMenu(null)
  }

  const removeAttachment = (name: string, size: number) =>
    setAttachments((prev) => prev.filter((a) => !(a.name === name && a.size === size)))

  const send = () => {
    if (!draft.trim() && !attachments.length) return
    setToast('演示输入框：发送未接入，未创建任务。')
  }

  const harness = HARNESSES.find((h) => h.id === harnessId) ?? HARNESSES[0]
  const phrase = MIST_PHRASES[phraseIndex]
  const phraseChunks = phrase.match(/.{1,3}/gu) ?? [phrase]

  return (
    <div className="hf-page" data-ready={ready || undefined}>

      <section className="hf-hero">
        <div className="hf-media">
          <div className="hf-left-module" ref={moduleRef}>
            <input ref={fileRef} type="file" multiple hidden onChange={pickFiles('file')} />
            <input ref={imageRef} type="file" accept="image/*" multiple hidden onChange={pickFiles('image')} />
            <input ref={videoRef} type="file" accept="video/*" multiple hidden onChange={pickFiles('video')} />
            <div className="hf-brandline">
              <img src="/assets/brand/fengmotion-mark.png" alt="" />
              <span className="hf-brandname">FengMotion</span>
              <span className="hf-brandsep" aria-hidden="true">|</span>
              <button type="button" className="hf-brandstart" onClick={() => taRef.current?.focus()}>开始创作</button>
            </div>
            <div className="hf-sample">
            <div className="hf-composer">
              {attachments.length > 0 && (
                <div className="hf-chips">
                  {attachments.map((a) => (
                    <span className="hf-chip" key={`${a.kind}-${a.name}-${a.size}`}>
                      <svg className="hf-chip-icon" viewBox="0 0 24 24" aria-hidden="true">
                        {a.kind === 'image'
                          ? <><rect x="3" y="4" width="18" height="16" rx="3" /><circle cx="9" cy="10" r="1.6" /><path d="M4 17l5-4 4 3 3-2 4 3" /></>
                          : a.kind === 'video'
                            ? <><rect x="3" y="5" width="18" height="14" rx="3" /><path d="M10 9l5 3-5 3z" /></>
                            : <><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /></>}
                      </svg>
                      <span className="hf-chip-name" title={a.name}>{a.name}</span>
                      <span className="hf-chip-size">{fmtSize(a.size)}</span>
                      <button type="button" onClick={() => removeAttachment(a.name, a.size)} aria-label={`移除 ${a.name}`}>
                        <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" /></svg>
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <div className="hf-ta">
                <textarea ref={taRef} rows={1} value={draft}
                          placeholder=""
                          onChange={(e) => setDraft(e.target.value)}
                          aria-label="输入框样本" />
                {!draft && (
                  <div className="hf-ph" aria-hidden="true" key={phrase}>
                    {phraseChunks.map((chunk, i) => (
                      <span key={`${phrase}-${i}`} style={{ animationDelay: `${60 + i * 85}ms` }}>
                        {chunk}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              {toast && <div className="hf-toast" role="status">{toast}</div>}
              <div className="hf-toolbar">
                <div className="hf-btnwrap">
                  <button className="hf-ibtn" type="button" title="添加附件" aria-expanded={menu === 'add'}
                          onClick={() => setMenu(menu === 'add' ? null : 'add')}>
                    <svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg>
                  </button>
                  {menu === 'add' && (
                    <div className="hf-menu">
                      <button type="button" onClick={() => fileRef.current?.click()}>
                        <span className="hf-mt"><b>文件</b><small>任意类型</small></span>
                      </button>
                      <button type="button" onClick={() => imageRef.current?.click()}>
                        <span className="hf-mt"><b>图片</b><small>png / jpg / webp</small></span>
                      </button>
                      <button type="button" onClick={() => videoRef.current?.click()}>
                        <span className="hf-mt"><b>视频</b><small>mp4 / mov / webm</small></span>
                      </button>
                    </div>
                  )}
                </div>
                <div className="hf-modewrap" data-open={menu === 'workdir' || undefined}>
                  <button className="hf-modechip hf-workdir-chip" type="button" aria-expanded={menu === 'workdir'}
                          onClick={() => setMenu(menu === 'workdir' ? null : 'workdir')}>
                    <svg className="hf-folder" viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg>
                    <span>工作目录</span>
                    <svg className="hf-chev" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6" /></svg>
                  </button>
                  {menu === 'workdir' && (
                    <div className="hf-menu hf-workdir-menu">
                      {[
                        ['~/workspace/fengmotion', 'FengMotion'],
                        ['~/workspace/video-production', '小凤 AI 口播片'],
                        ['~/workspace', 'workspace 根目录'],
                      ].map(([path, label]) => (
                        <button key={path} type="button" className={workdir === path ? 'is-sel' : undefined}
                                onClick={() => { setWorkdir(path); setMenu(null) }}>
                          <span>{label}</span><span className="hf-ck">✓</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <span className="hf-spacer" />
                <span className="hf-count">{draft.length || ''}</span>
                <div className="hf-btnwrap hf-harnesswrap">
                  <button className="hf-harness" type="button" aria-haspopup="dialog"
                          aria-expanded={menu === 'harness'} title="切换执行引擎"
                          onClick={() => setMenu(menu === 'harness' ? null : 'harness')}>
                    <span className="hf-harness-seg" data-off={!harness.ready || undefined}><i />{harness.short}</span>
                    <span className="hf-harness-div" aria-hidden="true" />
                    <span className="hf-harness-model">{model}</span>
                    <svg className="hf-chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
                  </button>
                  {menu === 'harness' && (
                    <div className="hf-harness-pop" role="dialog" aria-label="执行引擎">
                      <div className="hf-hp-head"><b>执行引擎</b><span>演示：只切换界面状态</span></div>
                      <div className="hf-hp-list" role="listbox" aria-label="引擎">
                        {HARNESSES.map((h) => (
                          <button key={h.id} type="button" className="hf-hp-item" role="option"
                                  aria-selected={h.id === harnessId}
                                  data-off={!h.ready || undefined}
                                  onClick={() => { setHarnessId(h.id); setModel(h.models[0]) }}>
                            <span className="hf-hp-logo" aria-hidden="true">{h.mark}</span>
                            <span className="hf-hp-txt">
                              <b>{h.name}</b>
                              <small>{h.ready ? '本机已配置' : '未接入，仅展示'}</small>
                            </span>
                            <span className="hf-hp-ck" aria-hidden="true">✓</span>
                          </button>
                        ))}
                      </div>
                      <div className="hf-hp-sep" />
                      <div className="hf-hp-head"><b>模型</b><span>{harness.short}</span></div>
                      <div className="hf-hp-list" role="listbox" aria-label="模型">
                        {harness.models.map((m) => (
                          <button key={m} type="button" className="hf-hp-item hf-hp-model" role="option"
                                  aria-selected={m === model} onClick={() => setModel(m)}>
                            <span className="hf-hp-radio" aria-hidden="true" />
                            <span className="hf-hp-txt"><b>{m}</b></span>
                            <span className="hf-hp-ck" aria-hidden="true">✓</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                <button className="hf-send" type="button" disabled={!draft.trim() && !attachments.length}
                        title={draft.trim() || attachments.length ? '示例输入框：发送未接入' : '发送'}
                        onClick={send} aria-label="发送">
                  <svg viewBox="0 0 24 24"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
                </button>
              </div>
            </div>
            <div className="hf-sample-hint">Enter 发送 · Shift + Enter 换行 · 附件只做展示，不上传</div>
            </div>
          </div>
        </div>

        <div className="hf-copy">
          <div className="hf-stage" style={{ '--hf-blue': HERO_CYCLES[cycle].accent, '--hf-accent': HERO_CYCLES[cycle].accent } as CSSProperties}>
            <div key={`text-${cycle}`}
                 className={`hf-panel hf-panel-text${phase === 'textOut' ? ' is-out' : ''}${phase === 'video' || phase === 'videoOut' ? ' is-hidden' : ''}`}>
              <HeroTitle copy={HERO_CYCLES[cycle]} cycle={cycle} />
              <p className="hf-lead">{HERO_LEAD}</p>
              {/* 视觉上已删除输入区；保留同高占位，维持标题/描述的原始纵向位置 */}
              <div className="hf-reserve" aria-hidden="true" />
            </div>

            {(phase === 'video' || phase === 'videoOut') && (
              <div key={`video-${cycle}`}
                   className={`hf-panel hf-video-panel${phase === 'videoOut' ? ' is-out' : ''}`} aria-hidden="true">
                <div className="hf-reel-frame">
                  <video className="hf-reel" src={HERO_CYCLES[cycle].reel}
                         autoPlay muted loop playsInline preload="auto" />
                  <span className="hf-reel-tag">演示片段 · 10s</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  )
}
