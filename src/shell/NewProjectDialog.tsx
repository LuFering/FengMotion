import { useEffect, useState } from 'react'
import { GENOMES } from '@/data/genomes'
import { type ProjectSummary } from '@/data/projects'

function Icon({ name, className = 'ui-icon' }: { name: string; className?: string }) {
  return (
    <svg className={className} aria-hidden="true">
      <use href={`./assets/paba-icons.svg#${name}`} />
    </svg>
  )
}

/** 目标时长的几挡 —— 都是这个产品真会做的片子长度（60s 口播 / 152s 成片 / 3 分钟长视频） */
const DURATIONS = [60, 90, 152, 180, 240]

/**
 * 新建项目（纸层对话卡）。
 *
 * 三个输入都能落到真实产线上：片型 = 首页那六个片型（决定默认做法），
 * 目标时长 = 分镜表的目标（PRODUCTION_FACTS 里 152s / 273.6s 同源）。
 *
 * ⚠️ 演示适配器：创建只写内存、不建目录 —— 卡片底部如实说明，
 *    建出来的项目带「未落盘」标记，总览页也按"还没开工"渲染。
 */
export function NewProjectDialog({ open, onClose, onCreate }: {
  open: boolean
  onClose: () => void
  onCreate: (input: { name: string; genome: string; targetDuration: number }) => ProjectSummary
}) {
  const [name, setName] = useState('')
  const [genome, setGenome] = useState(GENOMES[0].id)
  const [duration, setDuration] = useState(152)

  useEffect(() => {
    if (!open) return
    setName('')
    setGenome(GENOMES[0].id)
    setDuration(152)
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [open, onClose])

  if (!open) return null

  const g = GENOMES.find((x) => x.id === genome)

  return (
    <div className="pj-scrim" onPointerDown={onClose} role="presentation">
      <div className="pj-modal" role="dialog" aria-modal="true" aria-label="新建项目"
           onPointerDown={(e) => e.stopPropagation()}>
        <header className="pj-modal-hd">
          <Icon name="folder-plus" />
          <h2>新建项目</h2>
          <span className="spacer" />
          <button className="iconbtn" type="button" title="关闭" onClick={onClose}>
            <Icon name="x" />
          </button>
        </header>

        <form className="pj-modal-body" onSubmit={(e) => { e.preventDefault(); onCreate({ name, genome, targetDuration: duration }) }}>
          <label className="pj-field">
            <span>项目名</span>
            <input value={name} autoFocus placeholder="例如：Token 科普视频"
                   onChange={(e) => setName(e.target.value)} />
          </label>

          <div className="pj-field">
            <span>片型</span>
            <div className="pj-genomes">
              {GENOMES.map((x) => (
                <button key={x.id} type="button" aria-pressed={genome === x.id}
                        title={`${x.method.name} · ${x.method.lead}`}
                        onClick={() => setGenome(x.id)}>
                  {x.name}
                </button>
              ))}
            </div>
          </div>

          <div className="pj-field">
            <span>目标时长</span>
            <div className="pj-durs">
              {DURATIONS.map((d) => (
                <button key={d} type="button" aria-pressed={duration === d}
                        onClick={() => setDuration(d)}>
                  <b className="num">{d}</b>s
                </button>
              ))}
            </div>
          </div>

          <p className="pj-preview">
            {name.trim() ? `${name.trim()}` : '未命名项目'}
            {g && <em> · {g.method.name}</em>}
          </p>

          <footer className="pj-modal-ft">
            <button className="mini" type="button" onClick={onClose}>取消</button>
            <button className="mini mini-strong" type="submit" disabled={!name.trim()}>
              <Icon name="plus" />创建项目
            </button>
          </footer>
        </form>
      </div>
    </div>
  )
}
