import { useMemo, useState } from 'react'
import { PRODUCTION_FACTS, STORYBOARD, UNITS, type Unit } from '@/data/productionData'
import { statusOf } from '@/shell/status'
import { RATES, charsOf, durOf, readout, STATE_LABEL } from '@/data/voiceTiming'
import type { ProjectSummary } from '@/data/projects'

/**
 * 脚本与口播 —— 「一个脚本、两版对照、口播挨个过一遍」。
 *
 * 数据全部来自真实项目文件（productionData.ts）：
 *   · V3 分镜脚本：73 段 × 9 幕，每段有旁白 / 画面 / 动效 / 衔接 / 时码
 *   · 旧版成片：30 个镜头（UNITS），7 个已经映射回 V3 段
 *
 * ⚠️ 口播诊断里那条 **4.5 字/秒** 是**明写的假设**（常规中文讲解 240–300 字/分），
 *    不是从数据里算出来的 —— 所以界面上把它写出来，让人能反驳。
 *    ASR 未接入，所以不做"念错没念错"的判断，只做"这些字要读多久"的算术。
 */

/* 口播时长诊断的算术在 @/data/voiceTiming —— 与「音频与时间」共用同一份 */

export function ScriptVoice({ project }: { project: ProjectSummary }) {
  const [mode, setMode] = useState<'v3' | 'legacy'>('v3')
  const [段, set段] = useState('1')
  const [q, setQ] = useState('')
  const [幕Filter, set幕Filter] = useState<string | null>(null)
  const [rate, setRate] = useState<number>(4.5)
  const [onlyOver, setOnlyOver] = useState(false)

  const 幕s = useMemo(() => [...new Set(STORYBOARD.map((e) => e.幕))], [])

  /* 还没落盘的项目（演示新建的）：没有脚本可看 —— 如实说，不拿别的项目的脚本顶 */
  if (project.planned) {
    return (
      <div className="sv">
        <div className="sv-head"><h2>内容编排</h2></div>
        <div className="pj-pick">
          <svg className="ui-icon" aria-hidden="true"><use href="/assets/paba-icons.svg#file-text" /></svg>
          <h2>这个项目还没有脚本</h2>
          <p>
            「{project.name}」是演示新建的项目（内存里有、磁盘上没目录）。
            脚本要等接上 Agent 后由它写出第一版分镜；现在这里不会拿别的项目的内容冒充。
          </p>
        </div>
      </div>
    )
  }

  const total = useMemo(() => {
    const dur = STORYBOARD.reduce((n, e) => n + durOf(e), 0)
    const chars = STORYBOARD.reduce((n, e) => n + charsOf(e.旁白), 0)
    const over = STORYBOARD.filter((e) => readout(e, rate).state === 'over').length
    return { dur, chars, over, need: chars / rate }
  }, [rate])

  const list = useMemo(() => {
    const key = q.trim()
    return STORYBOARD.filter((e) =>
      (!幕Filter || e.幕 === 幕Filter) &&
      (!onlyOver || readout(e, rate).state === 'over') &&
      (!key || e.旁白.includes(key) || e.段 === key || e.画面.includes(key) || e.动效.includes(key)))
  }, [q, 幕Filter, onlyOver, rate])

  const cur = STORYBOARD.find((e) => e.段 === 段) ?? STORYBOARD[0]
  const curRead = readout(cur, rate)
  /** 旧版成片里哪些镜头映射到了这一段（storyboardId 是真实映射，7/30 有） */
  const mappedUnits = UNITS.filter((u) => u.storyboardId === cur.段)
  const mapped = UNITS.filter((u) => u.storyboardId).length
  /** 每一幕的超时合计（幕头用） */
  const 幕Over = (mu: string) => STORYBOARD.filter((e) => e.幕 === mu)
    .reduce((n, e) => { const r = readout(e, rate); return n + Math.max(0, r.diff) }, 0)

  return (
    <div className="sv">
      <div className="sv-head">
        <h2>内容编排</h2>
        <div className="sv-modes" role="tablist" aria-label="版本">
          <button type="button" role="tab" aria-selected={mode === 'v3'}
                  onClick={() => setMode('v3')}>V3 分镜脚本 <em className="num">{STORYBOARD.length} 段</em></button>
          <button type="button" role="tab" aria-selected={mode === 'legacy'}
                  onClick={() => setMode('legacy')}>旧版成片 <em className="num">{UNITS.length} 镜</em></button>
        </div>
        <span className="spacer" />
        {mode === 'v3' && (
          <label className="fm-search">
            <svg className="ui-icon" aria-hidden="true"><use href="/assets/paba-icons.svg#search" /></svg>
            <input value={q} placeholder="搜旁白 / 画面 / 段号" aria-label="搜索脚本"
                   onChange={(e) => setQ(e.target.value)} />
          </label>
        )}
      </div>

      {mode === 'v3' ? (
        <>
          {/* 合计一行：口播总账（都是算术，不是估计） */}
          <div className="sv-total">
            <span><em>旁白</em><b className="num">{total.chars} 字</b></span>
            <span><em>分镜已排 / 目标</em><b className="num">{total.dur.toFixed(0)}s <i>/ {PRODUCTION_FACTS.v3TargetDuration}s</i></b></span>
            <span>
              <em>需要（按 <span className="sv-rate">
                {RATES.map((r) => (
                  <button key={r} type="button" aria-pressed={rate === r} onClick={() => setRate(r)}>{r}</button>
                ))}
              </span> 字/秒）</em>
              <b className="num">{total.need.toFixed(0)}s</b>
            </span>
            <span data-warn={total.need > total.dur ? '' : undefined}>
              <em>差</em>
              <b className="num">{total.need > total.dur ? `+${(total.need - total.dur).toFixed(0)}s 超出` : `${(total.dur - total.need).toFixed(0)}s 富余`}</b>
            </span>
            <span>
              <em>超时（段数）<button className="sv-onlyover" type="button" aria-pressed={onlyOver}
                     onClick={() => setOnlyOver((v) => !v)}>只看超时</button></em>
              <b className="num" data-warn={total.over ? '' : undefined}>{total.over} / {STORYBOARD.length}</b>
            </span>
          </div>

          <div className="sv-body">
            {/* 左：段列表（按幕分组） */}
            <div className="sv-list">
              {幕Filter && (
                <button className="sv-filter" type="button" onClick={() => set幕Filter(null)}>
                  只看「{幕Filter}」<em>×</em>
                </button>
              )}
              {幕s.map((mu) => {
                const rows = list.filter((e) => e.幕 === mu)
                if (!rows.length) return null
                return (
                  <section key={mu}>
                    <button className="sv-mu" type="button"
                            onClick={() => set幕Filter((v) => (v === mu ? null : mu))}>
                      <span>{mu}</span>
                      <em className="num">{rows.length} 段</em>
                      {幕Over(mu) > 0.5 && <em className="sv-mu-over num">+{幕Over(mu).toFixed(1)}s</em>}
                    </button>
                    {rows.map((e) => {
                      const r = readout(e, rate)
                      return (
                        <button key={e.段} type="button" className="sv-row"
                                aria-current={e.段 === 段 ? 'true' : undefined}
                                onClick={() => set段(e.段)}>
                          <i className="num">{e.段}</i>
                          <span className="sv-row-txt">
                            <b>{e.旁白 || '（无旁白）'}</b>
                            <em className="num">{e.时间码}s</em>
                          </span>
                          <i className="sv-flag" data-state={r.state}
                             title={`${STATE_LABEL[r.state]}：${r.n} 字 / 需 ${r.need.toFixed(1)}s / 给 ${r.d.toFixed(1)}s`}>
                            {r.state === 'over' ? `+${r.diff.toFixed(1)}` : ''}
                          </i>
                        </button>
                      )
                    })}
                  </section>
                )
              })}
              {!list.length && <p className="sv-none">没有匹配的段。</p>}
            </div>

            {/* 右：这一段的口播 + 诊断 + 画面/动效/衔接 */}
            <div className="sv-detail">
              <header className="sv-detail-hd">
                <span className="sv-seg num">段 {cur.段}</span>
                <span className="num">{cur.时间码}s</span>
                <span className="num">{cur.时长}</span>
                <span className="sv-flag" data-state={curRead.state}>{STATE_LABEL[curRead.state]}</span>
                <span className="spacer" />
                <span className="sv-mu-tag">{cur.幕}</span>
              </header>

              <p className="sv-line">{cur.旁白 || '（这一段没有旁白）'}</p>

              <div className="sv-diag">
                <span><em>字数</em><b className="num">{curRead.n}</b></span>
                <span><em>按 {rate} 字/秒</em><b className="num">{curRead.need.toFixed(1)}s</b></span>
                <span><em>画面段给</em><b className="num">{curRead.d.toFixed(1)}s</b></span>
                <span data-warn={curRead.diff > 0.8 ? '' : undefined}>
                  <em>差</em>
                  <b className="num">{curRead.diff > 0 ? `+${curRead.diff.toFixed(1)}s` : `${curRead.diff.toFixed(1)}s`}</b>
                </span>
                {/* 一条对照条：镜头时长 vs 需要的时长 */}
                <span className="sv-bar-wrap">
                  <span className="sv-bar" role="img"
                        aria-label={`画面段 ${curRead.d.toFixed(1)} 秒，需要 ${curRead.need.toFixed(1)} 秒`}>
                    <i className="sv-bar-shot" style={{ width: `${Math.min(100, (curRead.d / Math.max(curRead.d, curRead.need)) * 100)}%` }} />
                    <i className="sv-bar-need" data-over={curRead.need > curRead.d ? '' : undefined}
                       style={{ width: `${Math.min(100, (curRead.need / Math.max(curRead.d, curRead.need)) * 100)}%` }} />
                  </span>
                  <span className="sv-bar-legend">
                    <i className="sv-lg-shot" />画面段 {curRead.d.toFixed(1)}s
                    <i className="sv-lg-need" data-over={curRead.need > curRead.d ? '' : undefined} />需要 {curRead.need.toFixed(1)}s
                  </span>
                </span>
              </div>

              <dl className="sv-meta">
                <div><dt>画面</dt><dd>{cur.画面}</dd></div>
                <div><dt>动效</dt><dd>{cur.动效}</dd></div>
                <div><dt>衔接</dt><dd>{cur.衔接}</dd></div>
                <div>
                  <dt>映射</dt>
                  <dd>
                    {mappedUnits.length
                      ? <>这一段的旁白用在成片画面段 {mappedUnits.map((u) => `${u.id}（${u.start?.toFixed(1)}–${((u.start ?? 0) + u.duration).toFixed(1)}s）`).join('、')} 上</>
                      : '还没排进成片（V3 脚本是完整 73 段，成片只剪了其中一部分）'}
                    <span className="num sv-map-note"> · 成片 {UNITS.length} 镜里对上 V3 的 {mapped} 镜</span>
                  </dd>
                </div>
              </dl>
            </div>
          </div>
        </>
      ) : (
        /* ── 旧版成片：30 个镜头的脚本面（note = 当初的意图） ── */
        <div className="sv-legacy">
          <p className="sv-legacy-note">
            这是正在播的那版成片（{PRODUCTION_FACTS.legacyCutDuration.toFixed(0)}s · {PRODUCTION_FACTS.timelineClips} 段剪辑）。
            每一镜的「意图」是当时写下的，右列是它对应到 V3 分镜的哪一段。
          </p>
          <div className="sv-legacy-grid">
            {UNITS.map((u: Unit) => {
              const st = statusOf(u.status)
              const seg = u.storyboardId ? STORYBOARD.find((e) => e.段 === u.storyboardId) : null
              return (
                <div key={u.id} className="sv-shot">
                  <span className="sv-shot-frame">
                    {u.frame ? <img src={u.frame} alt="" loading="lazy" /> : <em>无帧</em>}
                  </span>
                  <span className="sv-shot-txt">
                    <b>{u.id} · {u.label}</b>
                    <em className="num">{u.start?.toFixed(1)}–{((u.start ?? 0) + u.duration).toFixed(1)}s</em>
                    <span className="sv-shot-note">{u.note}</span>
                    {seg
                      ? <button className="sv-shot-map" type="button"
                                onClick={() => { set段(seg.段); setMode('v3') }}>
                          → V3 段 {seg.段}：{seg.旁白.slice(0, 18)}…
                        </button>
                      : <span className="sv-shot-map is-none">V3 分镜未映射</span>}
                  </span>
                  <span className="fm-dot" data-s={st.s} title={st.label} />
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
