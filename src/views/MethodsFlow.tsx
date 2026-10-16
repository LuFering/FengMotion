import { useState } from 'react'
import { METHODS } from '@/data/knowledge'

/**
 * 方法与流程 —— 一个片子从"这句话"到"一条过"的十个阶段与十三道门。
 *
 * 数据是 METHODS（stages / retrieval / checklist），以前只在首页被引用过一处 slug 文字，
 * 从没上过界面：
 *   · 10 个阶段，每阶段 1–2 道门（门 = 过不了就不许往下走）
 *   · 每道门有「产出」和「判据」—— 判据是能当场验的句子
 *   · 证据图是各阶段的真实产出（参考帧 / 英雄帧 / 合成截图）
 *   · 检索顺序 4 条、检查清单 A/B/C
 *
 * ⚠️ 这里呈现的是**方法本身**，不是某个项目的进度 —— 进度在工作台与项目总览里。
 */

function Icon({ name, className = 'ui-icon' }: { name: string; className?: string }) {
  return (
    <svg className={className} aria-hidden="true">
      <use href={`/assets/paba-icons.svg#${name}`} />
    </svg>
  )
}

export function MethodsFlow() {
  const [id, setId] = useState(METHODS.stages[0].id)
  const stage = METHODS.stages.find((s) => s.id === id) ?? METHODS.stages[0]
  const gates = METHODS.stages.reduce((n, s) => n + s.gates.length, 0)

  return (
    <div className="mf">
      <div className="mf-head">
        <h2>流程与质量保障</h2>
        <span className="mf-meta num">{METHODS.stages.length} 个阶段 · {gates} 道门 · 检查清单 {METHODS.checklist.length} 组</span>
      </div>

      {/* 十个阶段：一条竖轨串起来（.nsl-steps 那根连接线的竖用） */}
      <div className="mf-body">
        <div className="mf-stages">
          {METHODS.stages.map((s, i) => (
            <button key={s.id} type="button" className="mf-stage"
                    aria-current={s.id === stage.id ? 'true' : undefined}
                    onClick={() => setId(s.id)}>
              <i className="num">{i + 1}</i>
              <span>
                <b>{s.name}</b>
                <em>{s.lead}</em>
              </span>
              <span className="mf-stage-n num">{s.gates.length} 门</span>
            </button>
          ))}
        </div>

        <div className="mf-detail">
          <header className="mf-detail-hd">
            <h3>{stage.name}</h3>
            <p>{stage.lead}</p>
          </header>

          {/* 门：每道门一条，产出 + 判据 */}
          <ol className="mf-gates">
            {stage.gates.map((g) => (
              <li key={g.id} className="mf-gate" data-star={g.star ? '' : undefined}>
                <span className="mf-gate-id num">{g.id}</span>
                <div className="mf-gate-txt">
                  <b>{g.name}{g.star && <em>关键</em>}</b>
                  <p className="mf-gate-out"><span>产出</span>{g.out}</p>
                  <p className="mf-gate-judge"><Icon name="square-check" />{g.judge}</p>
                </div>
              </li>
            ))}
          </ol>

          {stage.ev && (
            <figure className="mf-ev">
              <img src={stage.ev} alt="" loading="lazy" />
              <figcaption>这一阶段的真实产出（{stage.ev.split('/').pop()}）</figcaption>
            </figure>
          )}
        </div>
      </div>

      {/* 检索顺序 + 检查清单 */}
      <div className="mf-foot">
        <section className="mf-block">
          <h3>先查哪儿 <em className="num">{METHODS.retrieval.length}</em></h3>
          <p className="mf-block-note">按顺序找，不许跳级 —— 本地调好的参数比网上的教程准。</p>
          <ol className="mf-retrieval">
            {METHODS.retrieval.map((r) => (
              <li key={r.n}>
                <i className="num">{r.n}</i>
                <b>{r.what}</b>
                {/* 源数据里「自研」这条的取值就是「—」，别渲染成一条孤零零的空横线 */}
                {r.where && !/^[—–\-]+$/.test(r.where.trim()) && <span className="num">{r.where}</span>}
                <em>{r.note}</em>
              </li>
            ))}
          </ol>
        </section>

        <section className="mf-block">
          <h3>检查清单 <em className="num">{METHODS.checklist.length} 组</em></h3>
          <p className="mf-block-note">交付前逐组过；B 组用运行时几何验，不是看源码。</p>
          <div className="mf-checklist">
            {METHODS.checklist.map((c) => (
              <div key={c.g} className="mf-check">
                <span className="mf-check-g num">{c.g}</span>
                <span className="mf-check-txt">
                  <b>
                    {c.name}
                    {/* 条数贴在标题旁，别甩到行尾当浮标 */}
                    {c.n != null && <em className="mf-check-n num">{c.n} 项</em>}
                  </b>
                  <em>{c.items}</em>
                </span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}
