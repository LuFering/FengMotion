import { useEffect, useRef, useState } from 'react'
import { UiIcon, SemIcons } from '@/shared/icons/UiIcon'
import { studioHttpApi } from '@/api'
import type { ProjectSummary } from '@/api/contracts'
import { useProjects } from '@/features/project/hooks/useProjects'

export function WorkflowProjectPicker({ projectId, disabled, onChange }: {
  projectId: string | null
  disabled: boolean
  onChange: (projectId: string | null) => void
}) {
  const [open, setOpen] = useState(false)
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    let alive = true
    void (async () => {
      const all: ProjectSummary[] = []
      let cursor: string | undefined
      const seen = new Set<string>()
      do {
        const page = await studioHttpApi().projects.list({ limit: 200, cursor })
        all.push(...page.items.filter((p) => !p.planned && !p.demo))
        cursor = page.nextCursor ?? undefined
        if (cursor && seen.has(cursor)) throw new Error('项目列表分页异常，请重试。')
        if (cursor) seen.add(cursor)
      } while (cursor)
      if (alive) setProjects(all)
    })().catch((e) => { if (alive) setError(e instanceof Error ? e.message : '无法读取项目，请重试。') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [open, attempt])
  useEffect(() => {
    if (!open) return
    const close = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false) }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setOpen(false); root.current?.querySelector('button')?.focus() } }
    document.addEventListener('pointerdown', close); document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', escape) }
  }, [open])
  /* 菜单没打开时项目列表还没读：先用应用里已有的项目列表找名字，不显示笼统的「已关联项目」 */
  const known = useProjects()
  const label = projects.find((p) => p.id === projectId)?.name ?? known.list.find((p) => p.id === projectId)?.name ?? (projectId ? '已关联项目' : '关联项目')
  return <div className="wfe-project-picker" ref={root}>
    <button type="button" className="wfe-btn" disabled={disabled} aria-expanded={open} aria-label="选择工作流关联项目" onClick={() => { if (!open) { setLoading(true); setError('') }; setOpen(!open) }} title={projectId ? '运行使用这个项目的工程' : '没有关联项目时只能演示运行'}><UiIcon icon={SemIcons.folder} size="sm" /><span>{label}</span><UiIcon icon={SemIcons.collapse} size="xs" /></button>
    {open && <div className="wfe-project-menu"><div className="wfe-project-menu-head"><b>关联项目</b><button type="button" className="wfe-iconbtn" aria-label="关闭项目选择" onClick={() => setOpen(false)}><UiIcon icon={SemIcons.close} size="sm" /></button></div><p>运行时使用这个项目的工程。改完要保存工作流。</p>
      {loading ? <p role="status">正在读取项目…</p> : error ? <div role="alert"><p>{error}</p><button type="button" className="wfe-btn" onClick={() => { setLoading(true); setError(''); setAttempt((n) => n + 1) }}><UiIcon icon={SemIcons.refresh} size="sm" />重试</button></div> : <ul className="wfe-project-list" role="listbox" aria-label="关联项目">{[{ id: '', name: '不关联 · 仅演示' }, ...(projectId && !projects.some((p) => p.id === projectId) ? [{ id: projectId, name: '当前关联（未在项目列表中找到）' }] : []), ...projects].map((p) => { const on = (projectId ?? '') === p.id; return <li key={p.id || '__none'}><button type="button" role="option" aria-selected={on} data-on={on || undefined} onClick={() => { onChange(p.id || null); setOpen(false) }}><span>{p.name}</span>{on && <em>当前</em>}</button></li> })}</ul>}
      {!loading && !error && !projects.length && <p>没有可关联的项目。可先在「我的创作」中新建项目。</p>}
    </div>}
  </div>
}
