import { useEffect, useMemo, useState } from 'react'
import { STAGE_LABEL, type ProjectSummary } from '@/data/projects'
import { SearchField } from '@/components/SearchField'

/**
 * 项目管理 · 一级 —— **项目列表**（「列表 → 项目 → 子视图」的第一层）
 *
 * ── 做法：用 paba 的机制，装本产品的字段 ────────────────────
 *   .hm-project 封面 16:9            封面 + 进度槽（paba 的 .fm-slot）
 *   <b>名</b> + <time>              名 + 场数 · 时长 · 阶段
 *   悬停浮出操作条                   打开 / 更多（更多里是**真的能用的**项目动作）
 *   hm-opening 打开中态              同左 —— 点开有真实间隔，正需要它
 *
 * ⚠️ 演示语义：列表来自 useProjects()（内存），重命名/删除**只改内存**，
 *    所以每个动作做完都给一句实话。接上后端后这里换成 API，结构不变。
 */

function Icon({ name, className = 'ui-icon' }: { name: string; className?: string }) {
  return (
    <svg className={className} aria-hidden="true">
      <use href={`./assets/paba-icons.svg#${name}`} />
    </svg>
  )
}

/** paba 用 HM.dateFormat；这里同义 */
function fmtDate(iso: string) {
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
  if (d <= 0) return '今天'
  if (d === 1) return '昨天'
  if (d < 30) return `${d} 天前`
  return `${Math.floor(d / 30)} 个月前`
}

export function WorkbenchCatalog({ projects, onOpen, onNew, onRename, onRemove }: {
  projects: ProjectSummary[]
  onOpen: (id: string) => void
  onNew: () => void
  onRename: (id: string, name: string) => void
  onRemove: (id: string) => void
}) {
  const [q, setQ] = useState('')
  /** 正在打开的项目 id —— 对应 paba 的 .hm-opening（有真实间隔，所以要这个态） */
  const [opening, setOpening] = useState<string | null>(null)
  const [menu, setMenu] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [confirming, setConfirming] = useState<string | null>(null)
  const [notice, setNotice] = useState('')

  const list = useMemo(() => {
    const key = q.trim().toLowerCase()
    const hit = key ? projects.filter((p) => p.name.toLowerCase().includes(key)) : projects
    return [...hit].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }, [q, projects])

  const open = (id: string) => {
    setOpening(id)
    // 让「打开中」态看得见 —— 真实项目要读盘/建索引，这里给同样的手感
    setTimeout(() => onOpen(id), 260)
  }

  const say = (msg: string) => {
    setNotice(msg)
    window.setTimeout(() => setNotice(''), 3600)
  }

  /* 菜单：Esc 或点空白关掉 */
  useEffect(() => {
    if (!menu) return
    const close = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(null) }
    const blur = () => setMenu(null)
    window.addEventListener('keydown', close)
    window.addEventListener('pointerdown', blur)
    return () => { window.removeEventListener('keydown', close); window.removeEventListener('pointerdown', blur) }
  }, [menu])

  const commitRename = (p: ProjectSummary) => {
    onRename(p.id, draft)
    setRenaming(null); setMenu(null)
    say(`演示：名字只改了界面，${p.path} 这个目录没动`)
  }

  return (
    <div className="hm-content" data-view="project">
      {/* 区块标题：标题 + 计数 + 搜索 + 新建（沿用首页那套标题解剖） */}
      <div className="fm-heading">
        <span className="fm-hd-idx" aria-hidden="true">
          <Icon name="folder-open" />
          <i>01</i>
        </span>
        <h2>我的项目</h2>
        <em className="fm-hd-slug" aria-hidden="true">PROJECTS</em>
        <span className="fm-hd-rule" aria-hidden="true" />
        <span className="fm-hd-meta num">{projects.length} 个项目</span>
        <SearchField value={q} onChange={setQ} placeholder="搜索项目" ariaLabel="搜索项目" onClear={() => setQ('')} />
        <button onClick={onNew}>
          新建<Icon name="plus" className="ui-icon fm-go-arrow" />
        </button>
      </div>

      {list.length === 0 ? (
        <div className="fm-empty">
          <Icon name="folder-open" />
          <span>没有找到相关项目</span>
          <button className="fm-chip" type="button" onClick={() => setQ('')}>清除搜索</button>
        </div>
      ) : (
        <div className="fm-project-grid" aria-busy={opening !== null || undefined}>
          {list.map((p) => (
            <ProjectCard key={p.id} project={p}
                         opening={opening === p.id}
                         menuOpen={menu === p.id}
                         renaming={renaming === p.id}
                         confirming={confirming === p.id}
                         draft={draft}
                         onDraft={setDraft}
                         onOpen={() => open(p.id)}
                         onMenu={(openMenu) => {
                           setMenu(openMenu ? p.id : null)
                           setConfirming(null)
                           if (openMenu) { setDraft(p.name); setRenaming(null) }
                         }}
                         onStartRename={() => setRenaming(p.id)}
                         onCommitRename={() => commitRename(p)}
                         onCancelRename={() => { setRenaming(null); setMenu(null) }}
                         onCopyPath={() => {
                           void navigator.clipboard?.writeText(p.path)
                           setMenu(null)
                           say(`路径已复制：${p.path}（浏览器打不开本机文件管理器）`)
                         }}
                         onConfirmDelete={() => setConfirming(p.id)}
                         onDelete={() => {
                           onRemove(p.id); setMenu(null); setConfirming(null)
                           say('演示：只从列表里移掉了，磁盘上的目录还在')
                         }} />
          ))}
        </div>
      )}

      {notice && <button className="pj-notice" type="button" onClick={() => setNotice('')}>{notice}</button>}
    </div>
  )
}

/* ── 项目卡 ─────────────────────────────────────────────────── */
function ProjectCard({ project: p, opening, menuOpen, renaming, confirming, draft, onDraft,
  onOpen, onMenu, onStartRename, onCommitRename, onCancelRename, onCopyPath, onConfirmDelete, onDelete }: {
  project: ProjectSummary
  opening: boolean
  menuOpen: boolean
  renaming: boolean
  confirming: boolean
  draft: string
  onDraft: (v: string) => void
  onOpen: () => void
  onMenu: (open: boolean) => void
  onStartRename: () => void
  onCommitRename: () => void
  onCancelRename: () => void
  onCopyPath: () => void
  onConfirmDelete: () => void
  onDelete: () => void
}) {
  const pct = p.totalClips ? Math.round((p.doneClips / p.totalClips) * 100) : 0

  return (
    <div className="fm-project-card" data-menu={menuOpen ? '' : undefined}>
      <button className="fm-project" type="button" data-opening={opening ? '' : undefined}
              title={p.name} onClick={onOpen}>
        <span className="fm-project-cover">
          {p.cover ? <img src={p.cover} alt="" loading="lazy" /> : <Icon name="workflow" />}
          {/* 封面压一条进度槽 —— 用 paba 的 .fm-slot 形态（--hole 底 / --acc 填充） */}
          {p.totalClips > 0 && (
            <span className="fm-slot fm-project-slot" role="img"
                  aria-label={`已完成 ${p.doneClips}/${p.totalClips}`}>
              <i style={{ width: `${pct}%` }} />
            </span>
          )}
          {/* 新建的项目还没存到磁盘上，如实标出来 */}
          {p.planned && <span className="fm-project-planned">仅本地</span>}
        </span>
        <span className="fm-project-text">
          <b>{p.name}</b>
          <span className="fm-project-meta">
            {/* 衍生：工作台关心「活儿多大」，所以是场数 + 时长，不是相对时间 */}
            {p.planned ? (
              <span className="num">{p.targetDuration ? `目标 ${p.targetDuration}s` : '还没定目标时长'}</span>
            ) : (
              <>
                <span className="num">{p.doneClips}/{p.totalClips} 场</span>
                <span className="num">{p.duration.toFixed(0)}s</span>
              </>
            )}
            {/* 阶段只在**非完成**时出现 —— 完成的片不需要提醒 */}
            {p.stage !== 'done' && (
              <span className="fm-tag" data-s="running">{STAGE_LABEL[p.stage]}</span>
            )}
            <time>{fmtDate(p.updatedAt)}</time>
          </span>
        </span>
      </button>

      {!menuOpen && (
        <div className="fm-project-actions">
          <button className="fm-project-act" type="button" title="打开"
                  aria-label={`打开 ${p.name}`} onClick={onOpen}>
            <Icon name="arrow-up-right" />
          </button>
          <button className="fm-project-act" type="button" title="更多操作"
                  aria-label={`${p.name} 的更多操作`}
                  aria-expanded={menuOpen}
                  onClick={(e) => { e.stopPropagation(); onMenu(true) }}>
            <Icon name="ellipsis" />
          </button>
        </div>
      )}

      {/* 项目动作：重命名 / 复制路径 / 打开所在目录 / 删除（每个都带演示实话） */}
      {menuOpen && (
        <div className="fm-pmenu" onPointerDown={(e) => e.stopPropagation()}>
          {renaming ? (
            <form className="fm-pmenu-rename" onSubmit={(e) => { e.preventDefault(); onCommitRename() }}>
              <input value={draft} autoFocus aria-label="新项目名"
                     onChange={(e) => onDraft(e.target.value)}
                     onKeyDown={(e) => { if (e.key === 'Escape') onCancelRename() }} />
              <button className="mini" type="submit">保存</button>
            </form>
          ) : (
            <button type="button" onClick={onStartRename}>
              <Icon name="pencil" />重命名
            </button>
          )}
          <button type="button" onClick={onCopyPath}><Icon name="link" />复制路径</button>
          <button type="button" onClick={onCopyPath}><Icon name="folder-open" />在文件管理器中打开</button>
          {confirming ? (
            <button type="button" className="danger" onClick={onDelete}>
              <Icon name="trash-2" />确认删除？
            </button>
          ) : (
            <button type="button" className="danger" onClick={onConfirmDelete}>
              <Icon name="trash-2" />删除项目
            </button>
          )}
        </div>
      )}
    </div>
  )
}
