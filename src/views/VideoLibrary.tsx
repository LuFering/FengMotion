import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { GENOMES } from '@/data/knowledge'
import type { Genome } from '@/data/knowledge'
import { fmtDur, fmtSize, readVideoDuration } from '@/data/sources'
import { PROJECTS } from '@/data/projects'
import type { ViewId } from '@/shell/views'

/** 案例研究数据沿用既有知识记录；适配层负责把范式术语转换为通用表达。 */
const CASES = [
  { id: 'film-1', file: '下载.mp4', index: '来源视频 01', duration: 660.54, size: 80_058_744, fps: '30.000 fps', genome: 'explainer', poster: '/reference/film-01-04s.jpg', proof: '/reference/evidence-video1.png', at: '00:04.8' },
  { id: 'film-2', file: '下载 2.mp4', index: '来源视频 02', duration: 885.70, size: 139_732_687, fps: '29.970 fps', genome: 'chat', poster: '/reference/film-02-00s.jpg', proof: '/reference/evidence-video2.png', at: '00:00.4' },
  { id: 'film-3', file: '下载1.mp4', index: '来源视频 03', duration: 1125.83, size: 83_821_981, fps: '30.001 fps', genome: 'book', poster: '/reference/film-03-02s.jpg', proof: '/reference/evidence-video3.png', at: '00:02.0' },
] as const
const CASE_ITEMS: { id: string; file: string; index: string; duration: number; size: number; fps: string; genome: Genome; poster: string; proof: string; at: string }[] = CASES.map((item) => ({ ...item, genome: GENOMES.find((g) => g.id === item.genome)! }))
const PROFILES = GENOMES.filter((g) => g.from === '规格')

type ImportedFilm = {
  id: string; name: string; size: number; duration: number; file: File; url: string
  source: '用户导入'; processing: '待解析'; review: '未产生'; availability: '启用' | '停用'
}
type Selection = { kind: 'case' | 'import' | 'profile'; id: string } | { kind: 'none'; id: '' }

function Icon({ name, className = 'ui-icon' }: { name: string; className?: string }) {
  return <svg className={className} aria-hidden="true"><use href={`/assets/paba-icons.svg#${name}`} /></svg>
}
/** 案例源笔记沿用镜头范式；通用产品层呈现为画面段/制作单元，原始源资料不改。 */
function generalCopy(text: string) {
  return text.replace(/平均镜长/g, '平均画面段长').replace(/按镜头制作/g, '按制作单元组织').replace(/镜头/g, '画面段')
}
function SectionTitle({ children, count, action }: { children: ReactNode; count?: string; action?: ReactNode }) {
  return <div className="rf-section-title"><b>{children}</b>{count && <em className="num">{count}</em>}{action && <span className="rf-title-action">{action}</span>}</div>
}
function ProjectRefs({ id, values, onToggle, disabled = false }: { id: string; values: string[]; onToggle: (id: string, project: string) => void; disabled?: boolean }) {
  return <div className="rf-projects"><div className="rf-projects-hd"><b>关联项目</b><span>仅本次会话有效</span></div><div className="rf-projects-list">
    {PROJECTS.map((p) => { const active = values.includes(p.id); return <button key={p.id} type="button" aria-pressed={active}
      disabled={disabled && !active} title={disabled && !active ? '停用后不可新增引用' : undefined} onClick={() => onToggle(id, p.id)}>
      <Icon name={active ? 'square-check' : 'square'} />{p.name}</button> })}
  </div></div>
}

export function VideoLibrary({ onOpen }: { onOpen?: (v: ViewId) => void } = {}) {
  const [imports, setImports] = useState<ImportedFilm[]>([])
  const [selection, setSelection] = useState<Selection>({ kind: 'none', id: '' })
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'active' | 'pending' | 'disabled'>('active')
  const [caseMode, setCaseMode] = useState(false)
  const [refs, setRefs] = useState<Record<string, string[]>>({})
  const [drag, setDrag] = useState(false)
  const [notice, setNotice] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const objectUrls = useRef(new Set<string>())
  const profiles = PROFILES
  const cases = CASE_ITEMS
  const activeImports = imports.filter((f) => f.availability === '启用')
  // 「待解析」是处理维度、与可用维度正交：停用的条目仍处于待解析（合同 §1.1 五维模型）
  const pendingImports = imports.filter((f) => f.processing === '待解析')
  const disabledImports = imports.filter((f) => f.availability === '停用')
  const selectedImport = selection.kind === 'import' ? imports.find((f) => f.id === selection.id) : undefined
  const selectedCase = selection.kind === 'case' ? cases.find((f) => f.id === selection.id) : undefined
  const selectedProfile = selection.kind === 'profile' ? profiles.find((f) => f.id === selection.id) : undefined
  const filteredImports = useMemo(() => {
    const term = query.trim().toLocaleLowerCase()
    return imports.filter((f) => {
      const stateOK = filter === 'disabled'
        ? f.availability === '停用'
        : filter === 'pending'
          ? f.processing === '待解析'
          : f.availability === '启用'
      return stateOK && (!term || f.name.toLocaleLowerCase().includes(term))
    })
  }, [imports, filter, query])
  const filteredCases = useMemo(() => cases.filter((f) => caseMode && (!query.trim() || `${f.file} ${f.genome.name} ${f.genome.persona}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))), [cases, caseMode, query])
  const visibleIds = new Set([
    ...(caseMode ? filteredCases.map((f) => f.id) : filteredImports.map((f) => f.id)),
    ...profiles.map((f) => f.id),
  ])
  const currentSelectionMissing = selection.kind !== 'none' && !visibleIds.has(selection.id)
  useEffect(() => {
    if (!currentSelectionMissing) return
    if (caseMode && filteredCases[0]) setSelection({ kind: 'case', id: filteredCases[0].id })
    else if (!caseMode && filteredImports[0]) setSelection({ kind: 'import', id: filteredImports[0].id })
    else setSelection({ kind: 'none', id: '' })
  }, [caseMode, currentSelectionMissing, filteredCases, filteredImports])
  useEffect(() => {
    if (selection.kind !== 'none') return
    if (caseMode && filteredCases[0]) setSelection({ kind: 'case', id: filteredCases[0].id })
    else if (!caseMode && filteredImports[0]) setSelection({ kind: 'import', id: filteredImports[0].id })
  }, [caseMode, filteredCases, filteredImports, selection.kind])


  useEffect(() => () => { objectUrls.current.forEach((url) => URL.revokeObjectURL(url)); objectUrls.current.clear() }, [])

  async function addFiles(list: FileList | File[]) {
    const added: ImportedFilm[] = []
    let skipped = 0
    for (const file of Array.from(list)) {
      if (!/^video\//i.test(file.type) && !/\.(mp4|mov|mkv|webm|avi|m4v)$/i.test(file.name)) { skipped++; continue }
      const url = URL.createObjectURL(file)
      objectUrls.current.add(url)
      added.push({ id: `local-${crypto.randomUUID()}`, name: file.name, size: file.size, duration: await readVideoDuration(file), file, url,
        source: '用户导入', processing: '待解析', review: '未产生', availability: '启用' })
    }
    if (!added.length) { setNotice(skipped ? '未导入文件：仅支持常见视频格式。' : ''); return }
    setImports((old) => [...added, ...old]); setSelection({ kind: 'import', id: added[0].id }); setFilter('active')
    setNotice(`已读取 ${added.length} 段视频${skipped ? `；${skipped} 个非视频文件已跳过` : ''}。文件尚未上传到服务器。`)
  }
  function toggleRef(id: string, project: string) {
    const old = refs[id] ?? []
    setRefs((state) => ({ ...state, [id]: old.includes(project) ? old.filter((x) => x !== project) : [...old, project] }))
  }
  function changeAvailability(film: ImportedFilm) {
    const disable = film.availability === '启用'
    const linked = refs[film.id] ?? []
    if (!window.confirm(disable
      ? `停用「${film.name}」？保留现有 ${linked.length} 个项目关联，但不再允许新增。仅本次会话有效。`
      : `启用「${film.name}」？仅本次会话有效。`)) return
    setImports((all) => all.map((item) => item.id === film.id ? { ...item, availability: disable ? '停用' : '启用' } : item))
    if (selection.kind === 'import' && selection.id === film.id && (disable || filter === 'disabled')) {
      setSelection({ kind: 'none', id: '' })
    }
  }
  function removeImport(film: ImportedFilm) {
    const linked = refs[film.id] ?? []
    if (!window.confirm(`移除「${film.name}」并解除 ${linked.length} 个项目关联？本机原文件不会删除。仅本次会话有效。`)) return
    setImports((all) => all.filter((item) => item.id !== film.id)); setRefs((all) => { const next = { ...all }; delete next[film.id]; return next })
    objectUrls.current.delete(film.url); URL.revokeObjectURL(film.url)
    if (selection.kind === 'import' && selection.id === film.id) setSelection({ kind: 'none', id: '' })
  }

  return <div className="rf">
    <header className="rf-head"><div className="rf-head-copy"><h2>参考片库</h2><p>导入视频、研究已有案例，并复用其中的做法。</p></div>
      <div className="rf-summary num"><span><b>{imports.length}</b> 已导入</span><i /><span><b>{pendingImports.length}</b> 待解析</span><i /><span><b>{cases.length}</b> 拆解案例</span><i /><span><b>{profiles.length}</b> 片型画像</span></div><span className="spacer" />
      <button className="mini-strong" type="button" onClick={() => input.current?.click()}><Icon name="upload" />导入参考片</button>
      <input ref={input} type="file" multiple accept="video/*" hidden onChange={(e) => { if (e.currentTarget.files) void addFiles(e.currentTarget.files); e.currentTarget.value = '' }} />
    </header>
    <div className="rf-capability"><Icon name="circle-alert" /><span><b>解析未接入。</b>用户导入的视频暂不能自动拆解；「案例研究」标签中的 3 个案例来自既有报告，不属于当前导入。</span><button className="mini rf-disabled" type="button" disabled title="解析未接入">开始解析</button></div>
    {notice && <div className="rf-notice" role="status">{notice}</div>}

    <div className="rf-layout">
      <main className="rf-library">
        <div className="rf-local-tabs" role="tablist" aria-label="参考片库视图">
          <button type="button" role="tab" aria-selected={!caseMode} onClick={() => { setCaseMode(false); setQuery(''); setFilter('active'); setSelection({ kind: 'none', id: '' }) }}>导入管理 <em className="num">{imports.length}</em></button>
          <button type="button" role="tab" aria-selected={caseMode} onClick={() => { setCaseMode(true); setQuery(''); setSelection({ kind: 'none', id: '' }) }}>案例研究 <em className="num">{cases.length}</em></button>
        </div>
        {!caseMode ? <section className="rf-section"><SectionTitle count={`${imports.length} 项`} action={<span className="rf-session-label">关联、停用、移除：仅本次会话有效</span>}>我导入的参考片</SectionTitle>
          <div className="rf-toolbar"><div className="rf-filters">{([
            ['active', '有效', activeImports.length], ['pending', '待解析', pendingImports.length], ['disabled', '已停用', disabledImports.length],
          ] as const).map(([id, label, count]) => <button key={id} type="button" aria-pressed={filter === id} onClick={() => { setFilter(id); setSelection({ kind: 'none', id: '' }) }}>{label}<em className="num">{count}</em></button>)}</div>
            <label className="rf-search"><Icon name="search" /><input className="rf-search-input" value={query} onChange={(e) => { setQuery(e.target.value); setSelection({ kind: 'none', id: '' }) }} placeholder="搜索文件名 / 案例" aria-label="搜索参考片" /></label>
          </div>
          <div className={`rf-upload-zone${drag ? ' is-drag' : ''}`} onDragOver={(e) => { e.preventDefault(); setDrag(true) }} onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDrag(false) }} onDrop={(e) => { e.preventDefault(); setDrag(false); void addFiles(e.dataTransfer.files) }}>
            {filteredImports.length ? <div className="rf-import-list">{filteredImports.map((film) => <button key={film.id} type="button" className="rf-import-row"
              aria-current={selection.kind === 'import' && selection.id === film.id ? 'true' : undefined} onClick={() => setSelection({ kind: 'import', id: film.id })}>
              <span className="rf-import-thumb"><video src={film.url} muted playsInline preload="metadata" /><i>本地预览</i></span>
              <span className="rf-import-copy"><b title={film.name}>{film.name}</b><em className="num">{fmtSize(film.size)} · {fmtDur(film.duration)}</em></span>
              <span className="rf-state" data-state={film.availability}
                    title={film.availability === '停用' ? '已停用；在右侧检查器里可重新启用' : undefined}>
                {film.availability === '启用' ? film.processing : film.availability}
              </span>
            </button>)}<button className="rf-add-more" type="button" onClick={() => input.current?.click()}><Icon name="upload" />继续导入</button></div> :
              <div className="rf-import-empty"><span className="rf-upload-icon"><Icon name="upload" /></span><b>{imports.length ? '当前筛选没有参考片' : '还没有导入参考片'}</b><p>{imports.length ? '切换筛选或搜索词。' : '选择一个视频文件，或直接拖到这个区域。'}</p><button className="mini" type="button" onClick={() => input.current?.click()}>选择视频</button></div>}
          </div><div className="rf-count num">显示 {filteredImports.length} / {imports.length} 个已导入参考片</div>
        </section> : <section className="rf-section"><SectionTitle count={`${filteredCases.length} / ${cases.length}`}>已有拆解案例</SectionTitle>
          <p className="rf-section-note">来自拆解报告的 3 条真实视频来源及抽帧证据；原视频没有打包进应用。</p>
          {filteredCases.length ? <div className="rf-case-grid">{filteredCases.map((item) => <button key={item.id} type="button" className="rf-case-card"
            aria-current={selection.kind === 'case' && selection.id === item.id ? 'true' : undefined} onClick={() => setSelection({ kind: 'case', id: item.id })}>
            <span className="rf-case-poster"><img src={item.poster} alt="" loading="lazy" /><em>{item.index}</em></span>
          <span className="rf-case-body"><b>{generalCopy(item.genome.name)}</b><em className="num">{item.file} · {fmtDur(item.duration)}</em><span>{generalCopy(item.genome.persona)}</span><i>拆解报告可查</i></span>
          </button>)}</div> :  <div className="rf-case-empty">当前没有可显示的内容。</div>}
        </section>}

        {!caseMode && <div className="rf-import-footer">添加文件仅在本次会话有效；原文件仍在本机，但不会上传到 FengMotion。</div>}

        <section className="rf-section rf-profiles"><SectionTitle count={`${profiles.length} 套`}>片型画像 · 抽象经验</SectionTitle>
          <p className="rf-section-note">不是参考视频或单条视频的解析结果。</p>
          <div className="rf-profile-list">{profiles.map((profile) => <button key={profile.id} type="button" className="rf-profile-row"
            aria-current={selection.kind === 'profile' && selection.id === profile.id ? 'true' : undefined} onClick={() => setSelection({ kind: 'profile', id: profile.id })}>
            <span className="rf-profile-mark"><Icon name="film" /></span><span className="rf-profile-copy"><b>{generalCopy(profile.name)}</b><em>{generalCopy(profile.persona)} · {generalCopy(profile.method.lead)}</em></span>
            <span className="rf-profile-metrics num">{profile.fp.slice(0, 3).map((x) => `${generalCopy(x.k)} ${x.v}`).join(' · ')}</span><Icon name="chevron-right" className="ui-icon rf-chevron" />
          </button>)}</div>
        </section>
      </main>

      <aside className="rf-inspector" aria-live="polite">
        {selectedImport ? <><SectionTitle count={selectedImport.availability === '启用' ? '待解析' : '已停用'}>参考片检查器</SectionTitle>
          <div className="rf-video-preview"><video src={selectedImport.url} controls muted playsInline preload="metadata" /></div>
          <h3 className="rf-inspector-title" title={selectedImport.name}>{selectedImport.name}</h3><p className="rf-source-line">用户导入 · 本地文件</p>
          <dl className="rf-facts"><div><dt>处理状态</dt><dd>待解析</dd></div><div><dt>审核状态</dt><dd>未产生</dd></div><div><dt>可用状态</dt><dd>{selectedImport.availability}</dd></div>
            <div><dt>文件大小</dt><dd className="num">{fmtSize(selectedImport.size)}</dd></div><div><dt>视频时长</dt><dd className="num">{fmtDur(selectedImport.duration)}</dd></div><div><dt>解析产物</dt><dd>尚未产生</dd></div></dl>
          <p className="rf-inline-note">解析未接入；没有关键帧或分析结果。</p>
          <ProjectRefs id={selectedImport.id} values={refs[selectedImport.id] ?? []} onToggle={toggleRef} disabled={selectedImport.availability === '停用'} />
          <div className="rf-actions"><button className="mini rf-disabled" type="button" disabled title="解析未接入">开始解析</button>
            <button className="mini mini-quiet" type="button" onClick={() => changeAvailability(selectedImport)}>{selectedImport.availability === '启用' ? '停用' : '启用'}</button>
            <button className="mini mini-quiet" type="button" onClick={() => removeImport(selectedImport)}>移除</button></div>
        </> : selectedCase ? <><SectionTitle count="拆解报告">案例检查器</SectionTitle>
          <div className="rf-video-preview rf-case-preview"><img src={selectedCase.poster} alt={`${selectedCase.file} ${selectedCase.at} 抽帧`} /><em>来源视频抽帧 · {selectedCase.at}</em></div>
          <h3 className="rf-inspector-title">{generalCopy(selectedCase.genome.name)}</h3><p className="rf-source-line">{selectedCase.index} · {selectedCase.file} · {generalCopy(selectedCase.genome.persona)}</p>
          <dl className="rf-facts"><div><dt>视频时长</dt><dd className="num">{fmtDur(selectedCase.duration)}</dd></div><div><dt>文件大小</dt><dd className="num">{fmtSize(selectedCase.size)}</dd></div>
            <div><dt>画面规格</dt><dd className="num">1920 × 1080 · {selectedCase.fps}</dd></div><div><dt>音轨</dt><dd>AAC · 44.1 kHz · 立体声</dd></div><div><dt>报告状态</dt><dd>拆解报告可查</dd></div><div><dt>应用内原片</dt><dd>未打包</dd></div></dl>
          <section className="rf-inspector-section"><SectionTitle>实测指标</SectionTitle><dl className="rf-metric-list">{selectedCase.genome.fp.map((x) => <div key={x.k}><dt>{generalCopy(x.k)}</dt><dd className="num">{x.v}</dd></div>)}</dl></section>
          <section className="rf-inspector-section"><SectionTitle>拆解证据</SectionTitle><a className="rf-evidence-link" href={selectedCase.proof} target="_blank" rel="noreferrer">
            <img src={selectedCase.proof} alt="" loading="lazy" /><span>查看时间序列抽帧联系表</span><Icon name="chevron-right" className="ui-icon" /></a><p className="rf-inline-note">报告抽帧证据，不是原片播放器画面。</p></section>
          <section className="rf-inspector-section"><SectionTitle>从案例提取的做法</SectionTitle><p className="rf-method-lead">{generalCopy(selectedCase.genome.method.name)} · {generalCopy(selectedCase.genome.method.lead)}</p>
            <ol className="rf-method-steps">{selectedCase.genome.method.steps.map((step, i) => <li key={step.name}><i className="num">{i + 1}</i><span><b>{generalCopy(step.name)}</b><em>{generalCopy(step.judge)}</em></span></li>)}</ol>
            <button className="mini" type="button" onClick={() => onOpen?.('knowledge')}>去创作技法库找可复用技法 <Icon name="chevron-right" /></button></section>
          <ProjectRefs id={selectedCase.id} values={refs[selectedCase.id] ?? []} onToggle={toggleRef} />
        </> : selectedProfile ? <><SectionTitle count="经验参数">片型画像</SectionTitle><div className="rf-profile-cover"><Icon name="film" /><span>抽象规格<br />不对应单条视频</span></div>
          <h3 className="rf-inspector-title">{generalCopy(selectedProfile.name)}</h3><p className="rf-source-line">片型画像 · {generalCopy(selectedProfile.persona)}</p><p className="rf-method-lead">{generalCopy(selectedProfile.method.lead)}</p>
          <section className="rf-inspector-section"><SectionTitle>参数与特征</SectionTitle><dl className="rf-metric-list">{selectedProfile.fp.map((x) => <div key={x.k}><dt>{generalCopy(x.k)}</dt><dd className="num">{x.v}</dd></div>)}</dl>
            <ul className="rf-traits">{selectedProfile.traits.map((x) => <li key={x}>{generalCopy(x)}</li>)}</ul><p className="rf-inline-note">{generalCopy(selectedProfile.note)}</p></section>
        </> : <div className="rf-inspector-empty"><Icon name="film" /><b>{caseMode ? '选择一个拆解案例' : imports.length ? '当前筛选没有参考片' : '暂无导入的视频'}</b><p>{caseMode ? '从左侧案例卡中选一项，查看报告证据和提取做法。' : '选择视频或拖入文件后，这里会显示文件信息。已有案例在「案例研究」标签中查看。'}</p></div>}
      </aside>
    </div>
  </div>
}
