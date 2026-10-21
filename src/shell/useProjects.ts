import { useCallback, useState } from 'react'
import { GENOMES } from '@/data/genomes'
import { PROJECTS, PROJECTS_ROOT, type ProjectSummary } from '@/data/projects'

const nowIso = () => new Date().toISOString().slice(0, 16).replace('T', ' ')

export interface NewProjectInput {
  name: string
  /** 片型 id（GENOMES 的六选一）—— 决定这套做法的默认值 */
  genome: string
  /** 目标时长（秒） */
  targetDuration: number
}

/**
 * 项目目录的内存态（种子是 data/projects.ts 里那一个真实项目）。
 *
 * ⚠️ **演示适配器语义**：create / rename / remove 只改内存，**不碰磁盘** ——
 *    没有后端时不许假装建了目录、改了文件名。新建出来的项目带 `planned` 标记，
 *    卡片与总览页都显示「未落盘」；接上 Agent/后端后，这里换成 API 调用，结构不变。
 */
export function useProjects() {
  const [list, setList] = useState<ProjectSummary[]>(PROJECTS)

  const create = useCallback((input: NewProjectInput) => {
    const g = GENOMES.find((x) => x.id === input.genome)
    const name = input.name.trim() || '未命名项目'
    const p: ProjectSummary = {
      id: `p-${Date.now().toString(36)}`,
      name,
      tagline: g ? `${g.name} · ${g.method.name}` : '还没定片型',
      stage: 'idea',
      duration: 0,
      doneClips: 0,
      totalClips: 0,
      segments: 0,
      compositions: 0,
      cover: g?.img ?? '/frames/film/s01.jpg',
      path: `${PROJECTS_ROOT}/${slug(name)}`,
      updatedAt: nowIso(),
      planned: true,
      genome: input.genome,
      targetDuration: input.targetDuration,
    }
    setList((l) => [p, ...l])
    return p
  }, [])

  const rename = useCallback((id: string, name: string) => {
    setList((l) => l.map((p) => (p.id === id ? { ...p, name: name.trim() || p.name, updatedAt: nowIso() } : p)))
  }, [])

  const remove = useCallback((id: string) => {
    setList((l) => l.filter((p) => p.id !== id))
  }, [])

  return { list, create, rename, remove }
}

/** 目录名：中文也能用（去掉文件系统不认的字符，空格变 -） */
export function slug(s: string) {
  return s.trim().replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, '-').slice(0, 40) || 'project'
}
