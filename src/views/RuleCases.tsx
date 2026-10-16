import { useMemo, useState } from 'react'
import { RULES, RULE_GROUPS } from '@/data/knowledge'

/**
 * 判例 —— 27 条从**实际被驳回的地方**长出来的规矩，每条带用户原话。
 *
 * 这是这份项目里最该被看见的数据：规则不是凭空写的，是从"这里不对、改回去"
 * 里总结出来的。所以每条都按 **规矩 / 当时的事 / 怎么验 / 原话** 四段摆开。
 *
 * ⚠️ 原话是用户的原话（数据里就存着），不做修饰、不做总结。
 */

function Icon({ name, className = 'ui-icon' }: { name: string; className?: string }) {
  return (
    <svg className={className} aria-hidden="true">
      <use href={`/assets/paba-icons.svg#${name}`} />
    </svg>
  )
}

export function RuleCases() {
  const [group, setGroup] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<string | null>(RULES[0]?.id ?? null)

  const list = useMemo(() => {
    const key = q.trim()
    return RULES.filter((r) =>
      (!group || r.groupCn === group) &&
      (!key || r.title.includes(key) || r.rule.includes(key) || r.case.includes(key) || r.quotes.some((x) => x.includes(key))))
  }, [group, q])

  const withQuotes = RULES.filter((r) => r.quotes.length > 0).length

  return (
    <div className="rc">
      <div className="rc-head">
        <h2>反馈与规则</h2>
        <span className="rc-meta num">{RULES.length} 条 · {RULE_GROUPS.length} 组 · 带原话 {withQuotes} 条</span>
        <span className="spacer" />
        <label className="fm-search">
          <Icon name="search" />
          <input value={q} placeholder="搜规矩 / 当时的事 / 原话" aria-label="搜索判例"
                 onChange={(e) => setQ(e.target.value)} />
        </label>
      </div>

      {/* 分组：按 RULE_GROUPS 的顺序，不按出现顺序（数据里那是乱的） */}
      <div className="rc-groups">
        <button type="button" aria-pressed={group === null} onClick={() => setGroup(null)}>
          全部<em className="num">{RULES.length}</em>
        </button>
        {RULE_GROUPS.map((g) => {
          const n = RULES.filter((r) => r.groupCn === g).length
          return (
            <button key={g} type="button" aria-pressed={group === g}
                    onClick={() => setGroup(group === g ? null : g)}>
              {g}<em className="num">{n}</em>
            </button>
          )
        })}
      </div>

      <div className="rc-list">
        {list.map((r) => {
          const isOpen = open === r.id
          return (
            <article key={r.id} className="rc-item" data-open={isOpen ? '' : undefined}>
              <button className="rc-item-hd" type="button"
                      aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : r.id)}>
                <span className="rc-no num">{r.id}</span>
                <b>{r.title}</b>
                <span className="rc-tag">{r.groupCn}</span>
                {r.quotes.length > 0 && <span className="rc-quote-n num">{r.quotes.length} 句话</span>}
                <Icon name={isOpen ? 'minus' : 'plus'} />
              </button>

              {isOpen && (
                <div className="rc-item-body">
                  <div className="rc-field">
                    <span className="rc-k">规矩</span>
                    <p>{r.rule}</p>
                  </div>
                  <div className="rc-field">
                    <span className="rc-k">当时的事</span>
                    <p>{r.case}</p>
                  </div>
                  <div className="rc-field">
                    <span className="rc-k">怎么验</span>
                    <p className="rc-check"><Icon name="square-check" />{r.check}</p>
                  </div>
                  {r.quotes.length > 0 && (
                    <div className="rc-field">
                      <span className="rc-k">原话</span>
                      <div className="rc-quotes">
                        {r.quotes.map((t) => <q key={t}>{t}</q>)}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </article>
          )
        })}
        {!list.length && <p className="kn-none">没有匹配的判例。</p>}
      </div>
    </div>
  )
}
