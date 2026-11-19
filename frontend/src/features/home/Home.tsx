import { useHarnessSelection, setHarnessSelection } from '@/features/harness/hooks/useHarnessSelection'
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ChangeEvent } from 'react'
import { HARNESSES, DEFAULT_PREFS, prefsKey, loadPrefs, savePrefs, type ModelPrefs } from '@/features/harness/model/harnesses'
import { useHarnesses, availabilityOf, modelsOf } from '@/features/harness/hooks/useHarnesses'
import { shortenDir } from '@/features/home/model/homeFormat'
import { HomeComposer } from '@/features/home/components/HomeComposer'

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
  '做一条 15 秒香水广告，画面简洁、有质感',
  '做一个雨夜重逢的故事短片，氛围温暖',
  '把我的旅行素材剪成一条节奏轻快的短视频',
  '参考这条片子的风格，做一段音乐视觉动画',
  '做一条 30 秒科普视频，讲清什么是 Token',
  '把这段字幕放大一点，其他画面保持不变',
]

/**
 * 右侧首屏轮转：文案模块 → 视频，共 3 轮。
 * 每轮只换文案与强调色；视频先放占位片段（public/media/home），后续换品牌片即可。
 */
type HeroCycle = { l1: string; l2a: string; kw: string; accent: string; reel: string }

const HERO_CYCLES: HeroCycle[] = [
  { l1: '从一句话，', l2a: '到一条', kw: '片子', accent: '#3B8CF8', reel: './media/home/reel-1.mp4' },
  { l1: '从一个念头，', l2a: '到一场', kw: '好戏', accent: '#39B7A8', reel: './media/home/reel-2.mp4' },
  { l1: '从一段故事，', l2a: '到一部', kw: '作品', accent: '#E08A3C', reel: './media/home/reel-3.mp4' },
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

export type Attachment = { file: File; name: string; size: number; kind: 'file' | 'image' | 'video' }

/** 工作目录条目：label 是显示名（目录名），path 是完整路径（演示态可为 ~ 前缀示意） */
export interface Workdir { label: string; path: string }

/** 发送时交给上层的上下文：草稿 + 这次用的工作目录 + 引擎 */
export interface StartPayload {
  intent: 'create' | 'chat'
  draft: string
  attachments: { file: File; kind: 'file' | 'image' | 'video' }[]
  workdir: { label: string; path: string } | null
  harness: { id: string; name: string; model: string }
}

export function Home(props: {
  onStart?: (payload: StartPayload) => Promise<void>
  /** 真实项目列表 —— 工作目录下拉的目录来自它，路径与项目一一对应 */
  projects?: { id: string; name: string; path: string }[]
}) {
  const [ready, setReady] = useState(false)
  const [draft, setDraft] = useState('')
  const [startIntent, setStartIntent] = useState<'create' | 'chat'>('create')
  const [starting, setStarting] = useState(false)
  const [startError, setStartError] = useState('')
  const [menu, setMenu] = useState<null | 'workdir' | 'add' | 'harness' | 'intent'>(null)
  /* 工作目录。真实链路按 docs/dev/前后端协议 与后端 workspace 包的规划走：
     Electron 主进程 dialog.showOpenDialog（DSH 的 dsh-desktop:directory-pick 同款），
     前端只经适配器拿「显示名 + 路径」。
     列表 = 真实项目目录（上层传入，路径能对上项目，发送后会话才挂得进去）
          + 用户手动添加的目录（演示态存 localStorage；对不上项目就落未分组）。
     ⚠️ 不能再用虚构路径当种子：`~/workspace/fengmotion` 与项目真实路径对不上，
        选了目录发送，会话照样进未分组 —— 那等于目录选择器是假的。 */
  const [extraDirs, setExtraDirs] = useState<Workdir[]>(() => {
    try {
      const saved = localStorage.getItem('fengmotion:workdirs')
      if (saved) {
        const parsed: unknown = JSON.parse(saved)
        if (Array.isArray(parsed)) return parsed.filter((d): d is Workdir => !!d && typeof d.path === 'string' && typeof d.label === 'string')
      }
    } catch { /* localStorage 不可用则没有额外目录 */ }
    return []
  })
  const workdirs = useMemo<Workdir[]>(() => {
    const base = (props.projects ?? []).map((p) => ({ label: p.name, path: p.path }))
    const seen = new Set(base.map((d) => d.path))
    return [...base, ...extraDirs.filter((d) => !seen.has(d.path))]
  }, [props.projects, extraDirs])
  /* 首页初始化一律「未选择工作目录」：不继承上次的选择。
     这样「不选目录直接发送 → 会话落进未分组」这条路径才成立；
     目录列表本身仍持久化（用户不必每次重新录入）。 */
  const [workdirPath, setWorkdirPath] = useState<string | null>(null)
  const dirInputRef = useRef<HTMLInputElement>(null)
  const currentWorkdir = workdirs.find((d) => d.path === workdirPath) ?? null
  const addWorkdir = (label: string, path: string) => {
    setExtraDirs((list) => {
      const next = list.some((d) => d.path === path) ? list : [...list, { label, path }]
      try { localStorage.setItem('fengmotion:workdirs', JSON.stringify(next)) } catch { /* 忽略持久化失败 */ }
      return next
    })
    setWorkdirPath(path)
  }
  const selectWorkdir = (path: string) => {
    setWorkdirPath(path)
    setMenu(null)
  }
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const engineSelection = useHarnessSelection()
  const harnessId = engineSelection.harness
  const setHarnessId = (harness: string) => setHarnessSelection({ harness, model: undefined, reasoningEffort: undefined })
  const model = engineSelection.model ?? ''
  const setModel = (model: string) => setHarnessSelection({ model })
  /* 引擎弹窗两级导航：null=一级引擎列表，'deepseek'…=二级模型列表 */
  const [harnessPane, setHarnessPane] = useState<string | null>(null)
  /* 模型偏好：key = `${harnessId}:${model}`；持久化在 localStorage */
  const [prefs, setPrefs] = useState<Record<string, ModelPrefs>>(loadPrefs)
  /** 引擎清单与模型目录来自本机后端；每个引擎独立判断。 */
  const probe = useHarnesses()
  const harnessStateOf = (id: string) => availabilityOf(probe, id)
  /**
   * 模型列表以**后端目录**为准（`/api/harnesses/{id}/models`）。
   * 本地 `harness.models` 是产品侧写的名字，与 DSH 实际路由的模型不一致，
   * 拿它当可选列表会让人选到不存在的模型。
   */
  const modelsOfHarness = (id: string) => modelsOf(probe, id)

  /**
   * 当前选中的模型可能不在后端目录里（本地默认值 `deepseek-chat` 在 DSH 路由中并不存在）。
   *
   * 用**派生值**而不是 effect 里 setState：effect 里改状态会触发级联渲染
   * （react 规则 set-state-in-effect），而且派生更符合 React 的数据流方向。
   */
  const backendModels = modelsOfHarness(harnessId).models
  const effectiveModel =
    backendModels.length === 0 || backendModels.some((m) => m.id === model)
      ? model
      : (backendModels.find((m) => m.default) ?? backendModels[0]).id
  const readyCount = HARNESSES.filter((h) => harnessStateOf(h.id).state === 'available').length
  const prefKey = prefsKey(harnessId, model)
  const setPref = (patch: Partial<ModelPrefs>) => {
    setPrefs((all) => {
      const next = { ...all, [prefKey]: { ...all[prefKey], ...patch } }
      savePrefs(next)
      return next
    })
  }
  const currentPrefs: ModelPrefs = prefs[prefKey] ?? DEFAULT_PREFS
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

  const [dragging, setDragging] = useState(false)
  /* 按 MIME 判类型：拖放和粘贴拿不到 input 的 accept，只能看 File.type */
  const kindOf = (f: File): Attachment['kind'] =>
    f.type.startsWith('image/') ? 'image' : f.type.startsWith('video/') ? 'video' : 'file'

  /** 统一的附件入列口：文件选择、拖放、粘贴都走这里，上限 6 个 */
  const addFiles = (files: File[], forced?: Attachment['kind']) => {
    if (!files.length) return
    const picked = files.map((f) => ({ file: f, name: f.name, size: f.size, kind: forced ?? kindOf(f) }))
    setAttachments((prev) => [...prev, ...picked].slice(0, 6))
  }

  const pickFiles = (kind: Attachment['kind']) => (e: ChangeEvent<HTMLInputElement>) => {
    addFiles(Array.from(e.target.files ?? []), kind)
    e.target.value = ''
    setMenu(null)
  }

  const removeAttachment = (name: string, size: number) =>
    setAttachments((prev) => prev.filter((a) => !(a.name === name && a.size === size)))

  const send = async () => {
    if (starting) return
    if (!draft.trim() && !attachments.length) return
    if (notReady) {
      setToast(`${harness.name} 未接入：不会创建任务，请切回已配置引擎。`)
      return
    }
    if (startIntent === 'create' && currentWorkdir && !props.projects?.some((project) => project.path === currentWorkdir.path)) {
      setStartError('这个目录尚未关联视频项目。请在目录菜单选择“新建视频项目”或一个已有项目。')
      return
    }
    if (startIntent === 'chat' && attachments.length && !props.projects?.some((project) => project.path === currentWorkdir?.path)) {
      setToast('附件需要项目会话，请先选择已有项目的工作目录。')
      return
    }
    /* 准备项目/会话与草稿；实际提交由创作区输入框显式完成。 */
    if (props.onStart && (draft.trim() || attachments.length)) {
      setStarting(true)
      setStartError('')
      try { await props.onStart({
        intent: startIntent,
        draft,
        attachments: attachments.map(({ file, kind }) => ({ file, kind })),
        workdir: currentWorkdir,
        harness: { id: harness.id, name: harness.name, model: effectiveModel },
      }) } catch (error) {
        setStartError(error instanceof Error ? error.message : '准备失败，请重试。输入内容仍保留。')
      } finally { setStarting(false) }
      return
    }
    setToast('演示输入框：发送未接入，未创建任务。')
  }

  const harness = HARNESSES.find((h) => h.id === harnessId) ?? HARNESSES[0]
  /* 「能不能发送」必须按**真实探测结果**判定，不能用本地 harness.ready（那是演示数据）。
     DSH 未接入时这里是 true —— 与引擎弹窗里显示的「未接入」保持一致。 */
  const harnessState = harnessStateOf(harness.id)
  const notReady = harnessState.state !== 'available'
  const phrase = MIST_PHRASES[phraseIndex]
  const phraseChunks = phrase.match(/.{1,3}/gu) ?? [phrase]

  return (
    <div className="hf-page" data-ready={ready || undefined}>

      {/* 右上角：平台入口与仓库链接（取自产品介绍页 nav，去掉「开始创作」） */}
      <div className="hf-social" aria-label="关注与源码">
        <span className="hf-soc-note">欢迎关注作者 <em>(๑•ᴗ•๑)</em></span>
        {/* 小红书 / 抖音 / 快手 / B站 四个入口还没有真实地址（原来都是 href="#"，点了原地不动）。
            有链接再加回来；先只保留能用的 GitHub。下一轮体验优化审阅 · 小项 */}
        <a className="hf-gh" href="https://github.com/LuFering/FengMotion" target="_blank" rel="noopener">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 19c-4 1.2-4-2-5.5-2.5M15 21v-3.4a3 3 0 0 0-.9-2.4c3-.3 6.1-1.5 6.1-6.7a5.2 5.2 0 0 0-1.4-3.6 4.8 4.8 0 0 0-.1-3.6s-1.1-.3-3.6 1.4a12.4 12.4 0 0 0-6.4 0C6.2 1.2 5.1 1.5 5.1 1.5a4.8 4.8 0 0 0-.1 3.6A5.2 5.2 0 0 0 3.6 8.7c0 5.2 3.1 6.4 6.1 6.7a3 3 0 0 0-.9 2.3V21" /></svg>
          GitHub
        </a>
      </div>

      <section className="hf-hero">
        <div className="hf-media">
          <div className="hf-left-module" ref={moduleRef}>
            <input ref={fileRef} type="file" multiple hidden onChange={pickFiles('file')} />
            {/* 选文件夹：浏览器里 webkitdirectory 拿不到绝对路径（这是 Electron 主进程
                dialog.showOpenDialog 才有的能力，见 DSH dsh-desktop:directory-pick）。
                演示阶段先用名字兜底并如实提示；接入桌面壳后这里整个换掉。 */}
            <input ref={dirInputRef} type="file" {...({ webkitdirectory: "" } as Record<string, string>)} hidden
                   onChange={(e) => {
                     const dirName = e.target.files?.[0]?.webkitRelativePath?.split('/')[0]
                     if (dirName) addWorkdir(dirName, `~/${dirName}`)
                     setMenu(null)
                     setToast(dirName
                       ? `已添加「${shortenDir(dirName)}」（浏览器演示：完整路径要等桌面版）`
                       : '浏览器里拿不到文件夹路径，桌面版才能直接选择')
                     e.target.value = ''
                   }} />
            <input ref={imageRef} type="file" accept="image/*" multiple hidden onChange={pickFiles('image')} />
            <input ref={videoRef} type="file" accept="video/*" multiple hidden onChange={pickFiles('video')} />
            <div className="hf-brandline">
              <img src="./assets/brand/fengmotion-mark.png" alt="" />
              <span className="hf-brandname">FengMotion</span>
              <span className="hf-brandsep" aria-hidden="true">|</span>
              <div className="hf-entry-choice">
                <button type="button" className="hf-brandstart" disabled={starting} aria-haspopup="menu" aria-expanded={menu === 'intent'} onClick={() => setMenu(menu === 'intent' ? null : 'intent')}>
                  {startIntent === 'create' ? '开始创作' : '先聊想法'}<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4"/></svg>
                </button>
                {menu === 'intent' && <div className="hf-menu hf-entry-menu" role="menu" aria-label="开始方式">
                  <button type="button" role="menuitemradio" aria-checked={startIntent === 'create'} onClick={() => { setStartIntent('create'); setMenu(null); taRef.current?.focus() }}><span>制作视频</span><small>准备项目与需求</small></button>
                  <button type="button" role="menuitemradio" aria-checked={startIntent === 'chat'} onClick={() => { setStartIntent('chat'); setMenu(null); taRef.current?.focus() }}><span>先聊想法</span><small>讨论，不修改工程</small></button>
                </div>}
              </div>
            </div>
            <HomeComposer
              addFiles={addFiles}
              attachments={attachments}
              currentPrefs={currentPrefs}
              currentWorkdir={currentWorkdir}
              dirInputRef={dirInputRef}
              draft={draft}
              dragging={dragging}
              effectiveModel={effectiveModel}
              fileRef={fileRef}
              harness={harness}
              harnessId={harnessId}
              harnessPane={harnessPane}
              harnessState={harnessState}
              harnessStateOf={harnessStateOf}
              imageRef={imageRef}
              menu={menu}
              modelsOfHarness={modelsOfHarness}
              notReady={notReady}
              phrase={phrase}
              phraseChunks={phraseChunks}
              probe={probe}
              readyCount={readyCount}
              removeAttachment={removeAttachment}
              selectWorkdir={selectWorkdir}
              send={send}
              setDraft={setDraft}
              setDragging={setDragging}
              setHarnessId={setHarnessId}
              setHarnessPane={setHarnessPane}
              setMenu={setMenu}
              setModel={setModel}
              setPref={setPref}
              setWorkdirPath={setWorkdirPath}
              startError={startError}
              startIntent={startIntent}
              starting={starting}
              taRef={taRef}
              toast={toast}
              videoRef={videoRef}
              workdirPath={workdirPath}
              workdirs={workdirs}
            />
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
