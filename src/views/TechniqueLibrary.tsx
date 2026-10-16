import { useMemo, useState, type ReactNode } from 'react'
import { CARDS, CARD_DETAILS, CATS, HOME_REEL } from '@/data/knowledge'
import type { ViewId } from '@/shell/views'

/**
 * 创作技法库 —— 回答「哪种表现手法适合当前创作，怎么理解、试用并应用它」。
 *
 * 原「镜头卡库」的两个问题：
 *   · 通用层出现了范式词（镜头）—— 换范式就得改导航，所以改名。
 *   · 只能筛选 + 看详情 + 停用，是资料浏览器，不是创作能力库。
 *
 * 现在一张技法卡按四层组织，首屏只解决「这是什么、适不适合我、接下来能做什么」：
 *   ① 效果认知（预览 / 动效循环）
 *   ② 适用判断（用途、类别、时长、能量）
 *   ③ 执行信息（意图 / 动效核心 / 参数表 / 已知坑 —— 默认收起）
 *   ④ 实际应用（复制配方是真的；应用到制作单元要工作台联动，未接入所以置灰）
 *
 * ⚠️ 数据来自 references/shots/**.md 原文：157 张卡、10 类、60 张有预览图、20 张有动效。
 *    停用 / 移除只在本次会话内（等后端）。"不适用情形"源数据里没有，界面不编。
 */

/** CATS 里带一条 id=all 的「全部」，分类行自己渲染它 —— 这里剔掉，否则出现两个「全部」 */
const CAT_LIST = CATS.filter((c) => c.id !== 'all')

function Icon({ name, className = 'ui-icon' }: { name: string; className?: string }) {
  return (
    <svg className={className} aria-hidden="true">
      <use href={`/assets/paba-icons.svg#${name}`} />
    </svg>
  )
}

/** 时长只取开头那一段，免得 50 字长句塞进小格子 */
function shortDur(d: string) {
  const head = d.split(/[（；，,]/)[0].trim()
  if (/^n\s*\/?\s*a$/i.test(head)) return '技法卡'
  return head.length > 16 ? head.slice(0, 15) + '…' : head
}
/** 能量去掉括号里的解释 */
function shortEnergy(e: string) {
  const v = e.replace(/（[^）]*）/g, '').trim()
  return /^n\s*\/?\s*a$/i.test(v) ? '—' : v
}

/** 极小的 markdown 渲染：- 列表 / **强调** / `代码` —— 不引第三方 */
function RichText({ text }: { text: string }) {
  const inline = (s: string): ReactNode[] =>
    s.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean).map((seg, i) => {
      if (seg.startsWith('**') && seg.endsWith('**')) return <b key={i}>{seg.slice(2, -2)}</b>
      if (seg.startsWith('`') && seg.endsWith('`')) return <code key={i}>{seg.slice(1, -1)}</code>
      return <span key={i}>{seg}</span>
    })

  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)
  const blocks: ReactNode[] = []
  let bullets: string[] = []
  const flush = () => {
    if (!bullets.length) return
    blocks.push(
      <ul key={`u${blocks.length}`} className="kn-md-ul">
        {bullets.map((b, i) => <li key={i}>{inline(b)}</li>)}
      </ul>,
    )
    bullets = []
  }
  for (const l of lines) {
    if (l.startsWith('- ') || l.startsWith('* ')) bullets.push(l.slice(2))
    else { flush(); blocks.push(<p key={`p${blocks.length}`} className="kn-md-p">{inline(l)}</p>) }
  }
  flush()
  return <div className="kn-md">{blocks}</div>
}

/** 可收起的详情段：默认收起，标题上带一句摘要，不铺文字 */
function Sec({ title, meta, children }: { title: string; meta?: string; children: ReactNode }) {
  return (
    <details className="kn-sec">
      <summary>
        <Icon name="chevron-right" className="ui-icon kn-sec-chev" />
        <span className="kn-sec-t">{title}</span>
        {meta && <em className="num kn-sec-m">{meta}</em>}
      </summary>
      <div className="kn-sec-body">{children}</div>
    </details>
  )
}

export function TechniqueLibrary({ onOpen }: { onOpen: (v: ViewId) => void }) {
  const [cat, setCat] = useState('all')
  const [q, setQ] = useState('')
  const [status, setStatus] = useState<'all' | 'off'>('all')
  const [curId, setCurId] = useState(CARDS[0].id)
  const [hoverCard, setHoverCard] = useState<string | null>(null)
  /** 管理动作：只在本次会话内生效（等后端） */
  const [off, setOff] = useState<Set<string>>(new Set())
  const [gone, setGone] = useState<Set<string>>(new Set())
  const [showOff, setShowOff] = useState(false)
  const [copied, setCopied] = useState(false)

  const featured = useMemo(() => new Set(HOME_REEL), [])

  /** 同一份可见集合：所有统计、分类计数、来源计数、详情都只认它 */
  const visible = useMemo(
    () => CARDS.filter((c) => !gone.has(c.id) && (showOff || !off.has(c.id))),
    [gone, off, showOff],
  )
  const list = useMemo(() => {
    const key = q.trim().toLowerCase()
    return visible.filter((c) =>
      (cat === 'all' || c.cat === cat) &&
      (status === 'all' || off.has(c.id)) &&
      (!key || c.name.toLowerCase().includes(key) || c.title.includes(key) ||
        c.fit.includes(key) || c.tags.some((t) => t.toLowerCase().includes(key))))
  }, [visible, cat, q, status, off])

  const cur = visible.find((c) => c.id === curId) ?? visible[0] ?? null
  const det = cur ? CARD_DETAILS[cur.id] : undefined
  const curOff = cur ? off.has(cur.id) : false

  const catCount = useMemo(() => {
    const m = new Map<string, number>()
    for (const c of visible) m.set(c.cat, (m.get(c.cat) ?? 0) + 1)
    return m
  }, [visible])
  const withPoster = visible.filter((c) => c.poster).length
  const withMotion = visible.filter((c) => c.motion).length

  function toggleOff(id: string) {
    setOff((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n })
  }
  /** 移除：先选好下一张可见卡，再移除，避免详情与计数脱节 */
  function removeCard(id: string) {
    const next = visible.find((c) => c.id !== id) ?? null
    setGone((p) => new Set(p).add(id))
    if (next) setCurId(next.id)
  }
  /** 复制配方是真的：把参数表与动效核心写进剪贴板 */
  function copyRecipe() {
    if (!cur || !det) return
    const params = det.params.map((p) => `${p.k}：${p.v}${p.note ? `（${p.note}）` : ''}`).join('\n')
    const text = [
      `技法：${cur.name}`,
      `一句话：${cur.title}`,
      `适用：${cur.fit}`,
      `时长：${cur.dur}`,
      `能量：${cur.energy}`,
      '',
      det.coreTitle || '动效核心',
      det.core,
      '',
      '参数表',
      params,
      det.refimpl ? `\n参考实现：${det.refimpl}` : '',
    ].join('\n')
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    })
  }

  return (
    <div className="tec">
      <div className="tec-head">
        <h2>创作技法库</h2>
        <span className="tec-meta num">
          {visible.length} 张 · {CAT_LIST.length} 类 · 有预览图 {withPoster} · 有动效 {withMotion}
          {off.size > 0 && ` · 停用 ${off.size}`}
        </span>
        <span className="spacer" />
        <label className="ac-check">
          <input type="checkbox" checked={showOff} onChange={(e) => setShowOff(e.target.checked)} />
          显示已停用
        </label>
        <button className="tec-src" type="button" onClick={() => onOpen('sources')}>
          <Icon name="import" />来源：镜刻 · {visible.length} 张
        </button>
        <label className="fm-search">
          <Icon name="search" />
          <input value={q} placeholder="搜技法名 / 一句话 / 适用" aria-label="搜索技法"
                 onChange={(e) => setQ(e.target.value)} />
        </label>
      </div>

      <div className="tec-cats">
        <button type="button" aria-pressed={cat === 'all' && status === 'all'}
                onClick={() => { setCat('all'); setStatus('all') }}>
          全部<em className="num">{visible.length}</em>
        </button>
        {CAT_LIST.map((c) => (
          <button key={c.id} type="button" aria-pressed={cat === c.id} onClick={() => setCat(c.id)}>
            {c.cn}<em className="num">{catCount.get(c.id) ?? 0}</em>
          </button>
        ))}
        <span className="tec-cats-sep" />
        <button type="button" aria-pressed={status === 'off'}
                onClick={() => setStatus(status === 'off' ? 'all' : 'off')}>
          已停用<em className="num">{off.size}</em>
        </button>
      </div>

      <div className="tec-body">
        <div className="tec-grid">
          {list.map((c) => (
            <button key={c.id} type="button" className="tec-card"
                    data-off={off.has(c.id) ? '' : undefined}
                    aria-current={c.id === cur?.id ? 'true' : undefined}
                    onPointerEnter={() => { setCurId(c.id); setHoverCard(c.id) }}
                    onPointerLeave={() => setHoverCard(null)}
                    onFocus={() => setCurId(c.id)}
                    onClick={() => setCurId(c.id)}
                    title={c.title}>
              <span className="tec-cover">
                {c.poster
                  ? <img src={c.poster} alt="" loading="lazy" />
                  : (
                    <span className="tec-cover-ph" data-cat={c.cat}>
                      <span className="tec-ph-mark" aria-hidden="true">{c.catCn.slice(0, 1)}</span>
                      <em>{c.catCn}</em>
                      <i>无预览图</i>
                    </span>
                  )}
                {hoverCard === c.id && c.motion && (
                  <video className="tec-cover-mo" src={c.motion} muted loop playsInline autoPlay preload="none" />
                )}
                {featured.has(c.id) && !off.has(c.id) && <span className="tec-pick">精选</span>}
                {c.motion && <span className="tec-mo-tag">动效</span>}
                {off.has(c.id) && <span className="tec-off">已停用</span>}
              </span>
              <span className="tec-card-body">
                <b>{c.name}</b>
                <span className="tec-one">{c.title}</span>
                <span className="tec-fp num">
                  <em>{shortDur(c.dur)}</em>
                  <em>{shortEnergy(c.energy)}</em>
                  <em>{c.catCn}</em>
                </span>
              </span>
            </button>
          ))}
          {!list.length && <p className="tec-none">没有匹配的技法 —— 换个词，或把筛选切回「全部」。</p>}
        </div>

        <aside className="tec-detail" aria-live="polite">
          {!cur ? (
            <p className="tec-none">库里没有可见的技法 —— 取消筛选，或把停用的显示出来。</p>
          ) : (
            <>
              {/* ① 效果认知 */}
              <span className="tec-detail-art">
                {cur.poster
                  ? <img src={cur.poster} alt="" />
                  : (
                    <span className="tec-cover-ph tec-cover-lg" data-cat={cur.cat}>
                      <span className="tec-ph-mark" aria-hidden="true">{cur.catCn.slice(0, 1)}</span>
                      <em>{cur.catCn}</em>
                      <i>这张技法没有预览图（源卡库里就没有）</i>
                    </span>
                  )}
                {cur.motion && (
                  <video className="tec-motion" src={cur.motion} muted loop playsInline autoPlay preload="metadata" />
                )}
                {cur.motion && <span className="tec-play">动作预览 · 循环播放</span>}
              </span>

              <h3>{cur.name}</h3>
              <p className="tec-title">{cur.title}</p>

              {/* ② 适用判断 */}
              <section className="tec-sec">
                <h4>适不适合我</h4>
                <dl className="tec-fit">
                  <div><dt>适用</dt><dd>{cur.fit || '源卡库未写'}</dd></div>
                  <div><dt>类别</dt><dd>{cur.catCn}</dd></div>
                  <div><dt>时长</dt><dd className="num">{shortDur(cur.dur)}</dd></div>
                  <div><dt>能量</dt><dd>{shortEnergy(cur.energy)}</dd></div>
                  {cur.tags.length > 0 &&
                    <div><dt>标签</dt><dd className="num">{cur.tags.join(' · ')}</dd></div>}
                </dl>
                <p className="tec-fit-note">源数据里没有"不适用情形"，这里的适用描述是卡库原文，不是系统判断。</p>
              </section>

              {/* ③ 执行信息（默认收起） */}
              <section className="tec-sec">
                <h4>执行信息</h4>
                {det?.intention && (
                  <Sec title="意图" meta={`${det.intention.length} 字`}>
                    <p className="tec-intent">{det.intention}</p>
                  </Sec>
                )}
                {det?.core && (
                  <Sec title={det.coreTitle || '动效核心'}
                       meta={`${det.core.split('\n').filter((l) => l.trim().startsWith('-')).length} 条`}>
                    <RichText text={det.core} />
                  </Sec>
                )}
                {det && det.params.length > 0 && (
                  <Sec title="参数表" meta={`${det.params.length} 行`}>
                    <table className="kn-params">
                      <tbody>
                        {det.params.map((p) => (
                          <tr key={p.k}><th>{p.k}</th><td className="num">{p.v}</td><td>{p.note}</td></tr>
                        ))}
                      </tbody>
                    </table>
                  </Sec>
                )}
                {det && det.pitfalls.length > 0 && (
                  <Sec title="已知坑" meta={`${det.pitfalls.length} 条`}>
                    <ul className="kn-pits">
                      {det.pitfalls.map((p, i) => <li key={i}>{p}</li>)}
                    </ul>
                  </Sec>
                )}
                {det?.refimpl && (
                  <Sec title="参考实现">
                    <p className="num tec-refimpl">{det.refimpl}</p>
                  </Sec>
                )}
              </section>

              {/* ④ 实际应用 */}
              <section className="tec-sec">
                <h4>接下来</h4>
                <div className="tec-acts">
                  <button className="mini" type="button" onClick={copyRecipe}>
                    <Icon name={copied ? 'square-check' : 'copy'} />
                    {copied ? '已复制配方' : '复制配方'}
                  </button>
                  <button className="mini" type="button" disabled title="应用到制作单元需要工作台联动（未接入）">
                    <Icon name="arrow-right" />应用到制作单元
                  </button>
                  <button className="mini mini-quiet" type="button" onClick={() => toggleOff(cur.id)}>
                    <Icon name={curOff ? 'play' : 'pause'} />{curOff ? '启用' : '停用'}
                  </button>
                  <button className="mini mini-quiet" type="button" onClick={() => removeCard(cur.id)}>
                    <Icon name="trash-2" />移除
                  </button>
                </div>
                <p className="tec-foot">
                  停用 / 移除只在本次会话生效，刷新后恢复；移除会把它从库里摘掉，但不动源卡库文件。
                </p>
              </section>
            </>
          )}
        </aside>
      </div>
    </div>
  )
}
