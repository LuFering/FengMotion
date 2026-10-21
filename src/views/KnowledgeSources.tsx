import { useMemo, useRef, useState } from 'react'
import {
  KIND_CN, SEED_SOURCES, fmtDur, fmtSize, guessKind, isBuiltin, readVideoDuration,
  statusLabel, yieldsLine,
  type KSource, type SourceKind,
} from '@/data/sources'
import type { ViewId } from '@/shell/views'

/**
 * 知识源 —— 导入台。这里只干三件事：**导入、看解析出了什么、管理来源**。
 *
 * 与其余「知识」视图的区别：那些是**看产物**（卡/判例/流程），这一页是**管入口**。
 *
 * ⚠️ 两条如实声明（别让界面说谎）：
 *   · 解析（skill / 视频）是后端能力，**未接入** → 新导入的一律落「待解析」，
 *     操作里给「重新解析」，点了也只是回到待解析，不模拟进度条。
 *   · 新导入的条目只在内存里（本次会话），**没落盘**。
 */

function Icon({ name, className = 'ui-icon' }: { name: string; className?: string }) {
  return (
    <svg className={className} aria-hidden="true">
      <use href={`/assets/paba-icons.svg#${name}`} />
    </svg>
  )
}

const KIND_ICON: Record<SourceKind, string> = { skill: 'panels-top-left', url: 'link', video: 'film' }

export function KnowledgeSources({ onOpen }: { onOpen: (v: ViewId) => void }) {
  const [extra, setExtra] = useState<KSource[]>([])
  /** 对**所有**来源的本地改写（含内置来源）—— 以前只改 extra，导致对内置来源点了没反应 */
  const [over, setOver] = useState<Record<string, Partial<KSource>>>({})
  const [curId, setCurId] = useState(SEED_SOURCES[0].id)

  const all = useMemo(
    () => [...extra, ...SEED_SOURCES].map((s) => ({ ...s, ...(over[s.id] ?? {}) })),
    [extra, over],
  )
  const [url, setUrl] = useState('')
  const [drag, setDrag] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const cur = all.find((s) => s.id === curId) ?? all[0]

  const total = useMemo(() => {
    const n = { cards: 0, rules: 0, methods: 0, clips: 0 }
    for (const s of all) {
      if (s.status !== 'ready') continue
      n.cards += s.yields.cards ?? 0
      n.rules += s.yields.rules ?? 0
      n.methods += s.yields.methods ?? 0
      n.clips += s.yields.clips ?? 0
    }
    return n
  }, [all])

  /** 新导入的条目：只进内存，状态一律 pending（解析要后端） */
  async function addFiles(files: FileList | File[]) {
    const added: KSource[] = []
    for (const f of Array.from(files)) {
      const kind = guessKind(f.name)
      const duration = kind === 'video' ? await readVideoDuration(f) : undefined
      added.push({
        id: `new-${f.name}-${f.size}`,
        kind,
        name: f.name,
        what: kind === 'video' ? '新导入的参考视频' : '新导入的 skill 包',
        status: 'pending',
        yields: {},
        size: f.size,
        duration,
        addedAt: '本次会话',
      })
    }
    if (!added.length) return
    setExtra((p) => [...added, ...p])
    setCurId(added[0].id)
  }

  function addUrl() {
    const u = url.trim()
    if (!u) return
    const id = `new-url-${u}`
    setExtra((p) => [{
      id, kind: 'url', name: u.replace(/^https?:\/\//, '').split('/')[0],
      ref: u.replace(/^https?:\/\//, ''), what: '新导入的网址', status: 'pending',
      yields: {}, addedAt: '本次会话',
    }, ...p])
    setCurId(id)
    setUrl('')
  }

  /** 改写对**任何**来源都生效（内置来源也能真的停用）；移除只针对本次导入的条目 */
  const patch = (id: string, f: Partial<KSource>) =>
    setOver((p) => ({ ...p, [id]: { ...(p[id] ?? {}), ...f } }))
  const remove = (id: string) => {
    if (isBuiltin(id)) return
    setExtra((p) => p.filter((s) => s.id !== id))
    if (curId === id) setCurId(SEED_SOURCES[0].id)
  }

  return (
    <div className="ks">
      <div className="ks-head">
        <h2>资源接入</h2>
        <span className="ks-meta num">
          {all.length} 个来源 · 已入账 {total.cards} 张卡 · {total.rules} 条判例 · {total.methods} 套流程 · {total.clips} 段参考片
          <span className="ks-meta-note">（另有 201 个场景 / 81 个模板记在来源备注里，未并入合计）</span>
        </span>
      </div>

      {/* 导入区：拖入文件 / 选文件 / 粘网址 */}
      <section className="ks-import">
        {/* 虚线只包住真正的投放目标 */}
        <div className={`ks-drop${drag ? ' is-drag' : ''}`}
             onDragOver={(e) => { e.preventDefault(); setDrag(true) }}
             onDragLeave={() => setDrag(false)}
             onDrop={(e) => { e.preventDefault(); setDrag(false); void addFiles(e.dataTransfer.files) }}>
          <Icon name="upload" className="ui-icon ks-import-ico" />
          <div className="ks-import-txt">
            <b>把 skill 包或参考视频拖进来</b>
            <span>.zip / .md / 文件夹 / 视频</span>
          </div>
          <button className="mini-strong" type="button" onClick={() => fileRef.current?.click()}>
            选择文件
          </button>
          <input ref={fileRef} type="file" multiple hidden
                 accept=".zip,.md,.txt,.json,.mp4,.mov,.mkv,.webm"
                 onChange={(e) => { if (e.target.files) void addFiles(e.target.files); e.target.value = '' }} />
        </div>

        <div className="ks-or"><span>或</span></div>

        <div className="ks-url">
          <Icon name="link" />
          <input value={url} placeholder="粘贴网址（skill 仓库 / 卡片库页面）"
                 aria-label="粘贴网址" onChange={(e) => setUrl(e.target.value)}
                 onKeyDown={(e) => { if (e.key === 'Enter') addUrl() }} />
          <button className="mini-strong" type="button" onClick={addUrl} disabled={!url.trim()}>加入</button>
        </div>

        <p className="ks-warn" title="解析是后端能力，接入后才有产物">
          <Icon name="circle-alert" />
          解析需要后端（未接入）：新导入的先入库、标「待解析」；条目只在本次会话里。
        </p>
      </section>

      <div className="ks-body">
        {/* 来源列表 */}
        <div className="ks-list">
          <div className="ks-list-hd">
            <span className="ks-hd-main">
              <i /><span>来源</span><span className="ta-r">解析产物</span><span className="ta-r">状态</span>
            </span>
            <span />
          </div>
          {all.map((s) => (
            <div key={s.id} className="ks-row" data-cur={s.id === cur.id ? '' : undefined}
                 data-s={s.status}>
              <button className="ks-row-main" type="button" onClick={() => setCurId(s.id)}>
                <span className="ks-logo">
                  {s.logo ? <img src={s.logo} alt="" /> : <Icon name={KIND_ICON[s.kind]} />}
                </span>
                <span className="ks-row-name">
                  <b>{s.name}</b>
                  <em title={`${KIND_CN[s.kind]}${s.ref ? ` · ${s.ref}` : ''}`}>
                    {KIND_CN[s.kind]}{s.ref && s.ref !== s.name ? ` · ${s.ref}` : ''}
                  </em>
                </span>
                <span className="ks-row-y num" title={yieldsLine(s.yields)}>{yieldsLine(s.yields) || '—'}</span>
                <span className="ks-row-st" data-s={s.status}>{statusLabel(s)}</span>
              </button>
              {!isBuiltin(s.id) && (
                <span className="ks-row-acts">
                  <button type="button" disabled title="解析需要后端（未接入）">重新解析</button>
                  <button type="button" onClick={() => remove(s.id)}>移除</button>
                </span>
              )}
            </div>
          ))}
          {!all.length && <p className="ks-none">还没有任何来源。</p>}
        </div>

        {/* 详情：这条来源解析出了什么 */}
        <aside className="ks-detail">
          <header className="ks-detail-hd">
            <span className="ks-logo ks-logo-lg">
              {cur.logo ? <img src={cur.logo} alt="" /> : <Icon name={KIND_ICON[cur.kind]} />}
            </span>
            <div>
              <h3>{cur.name}</h3>
              <p className="num">{KIND_CN[cur.kind]}{cur.ref ? ` · ${cur.ref}` : ''}</p>
            </div>
            <span className="ks-st" data-s={cur.status}>{statusLabel(cur)}</span>
          </header>

          <p className="ks-what">{cur.what}</p>

          <dl className="ks-facts">
            {cur.addedAt && <div><dt>入库</dt><dd className="num">{cur.addedAt}</dd></div>}
            {cur.size != null && <div><dt>大小</dt><dd className="num">{fmtSize(cur.size)}</dd></div>}
            {cur.duration != null && <div><dt>时长</dt><dd className="num">{fmtDur(cur.duration)}</dd></div>}
          </dl>

          {/* 产物：能点的就跳到对应的库 */}
          <section className="ks-sec">
            <h4>解析产物</h4>
            {cur.status === 'pending' ? (
              <p className="ks-wait">
                还没有产物 —— 解析要后端。接入后这里会列出：卡 / 判例 / 流程 / 画面段。
              </p>
            ) : (
              <div className="ks-yields">
                {(cur.yields.cards ?? 0) > 0 && (
                  <button type="button" onClick={() => onOpen('knowledge')}>
                    <b className="num">{cur.yields.cards}</b><span>张画面卡</span>
                    <Icon name="chevron-right" className="ui-icon ks-go" />
                  </button>
                )}
                {(cur.yields.rules ?? 0) > 0 && (
                  <button type="button" onClick={() => onOpen('rules')}>
                    <b className="num">{cur.yields.rules}</b><span>条判例</span>
                    <Icon name="chevron-right" className="ui-icon ks-go" />
                  </button>
                )}
                {(cur.yields.methods ?? 0) > 0 && (
                  <button type="button" onClick={() => onOpen('methods')}>
                    <b className="num">{cur.yields.methods}</b><span>套流程</span>
                    <Icon name="chevron-right" className="ui-icon ks-go" />
                  </button>
                )}
                {(cur.yields.clips ?? 0) > 0 && (
                  <button type="button" onClick={() => onOpen('reference')}>
                    <b className="num">{cur.yields.clips}</b><span>段参考片</span>
                    <Icon name="chevron-right" className="ui-icon ks-go" />
                  </button>
                )}
                {cur.yields.note && (
                  <span className="ks-yield-note" title="这一项在来源里，不单独成页">
                    <b className="num">{cur.yields.note.split(' ')[0]}</b>
                    <span>{cur.yields.note.split(' ').slice(1).join(' ')}</span>
                  </span>
                )}
              </div>
            )}
          </section>

          <section className="ks-sec">
            <h4>操作</h4>
            <div className="ks-acts">
              {/* 解析未接入：按目标形态画出来，但明确不可用，不做"点了没反应" */}
              <button className="mini" type="button" disabled title="解析需要后端（未接入）">
                <Icon name="refresh-cw" />重新解析
              </button>
              <button className="mini mini-quiet" type="button"
                      onClick={() => patch(cur.id, { status: cur.status === 'disabled' ? 'ready' : 'disabled' })}>
                <Icon name={cur.status === 'disabled' ? 'play' : 'pause'} />
                {cur.status === 'disabled' ? '启用' : '停用'}
              </button>
              {!isBuiltin(cur.id) && (
                <button className="mini" type="button" onClick={() => remove(cur.id)}>
                  <Icon name="trash-2" />移除
                </button>
              )}
            </div>
            <p className="ks-foot num" title="数据不动，只是默认不显示">
              停用只影响显示，数据不动。
            </p>
          </section>
        </aside>
      </div>
    </div>
  )
}
