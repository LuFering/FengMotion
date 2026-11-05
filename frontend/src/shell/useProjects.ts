import { useCallback, useEffect, useState } from 'react'
import type { ProjectSummary } from '@/data/projects'
import type { ProjectSummary as ApiProject } from '@/types/contracts'
import { studioHttpApi } from '@/services/api'

export interface NewProjectInput {
  name: string
  genome: string
  targetDuration: number
}

/** 将 API 项目数据转换为现有页面使用的字段和单位。 */
function toProject(p: ApiProject): ProjectSummary {
  return {
    id: p.id, name: p.name, tagline: p.tagline, stage: p.stage,
    duration: p.durationMs / 1000, doneClips: 0, totalClips: 0,
    segments: p.counts.storyboardSegments, compositions: p.counts.compositions,
    cover: p.coverUrl ?? '', path: p.rootPath, updatedAt: p.updatedAt,
    genome: p.genomeId ?? undefined,
    targetDuration: p.targetDurationMs == null ? undefined : p.targetDurationMs / 1000,
  }
}

/** 项目元数据来自后端；工作台内容仍需单独接入。 */
export function useProjects() {
  const [list, setList] = useState<ProjectSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const items: ApiProject[] = []
      const seen = new Set<string>()
      let cursor: string | undefined
      do {
        const page = await studioHttpApi().projects.list({ limit: 200, cursor })
        items.push(...page.items)
        if (page.nextCursor && seen.has(page.nextCursor)) throw new Error('项目分页游标重复')
        if (page.nextCursor) seen.add(page.nextCursor)
        cursor = page.nextCursor ?? undefined
      } while (cursor)
      setList(items.map(toProject))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法加载项目')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  const create = useCallback(async (input: NewProjectInput) => {
    const project = await studioHttpApi().projects.create({
      name: input.name.trim() || '未命名项目', genomeId: input.genome,
      targetDurationMs: input.targetDuration * 1000,
    })
    const result = toProject(project)
    setList((current) => [result, ...current.filter((p) => p.id !== result.id)])
    return result
  }, [])

  /**
   * 左栏「新建项目」：建一个空项目，建完在行内改名。
   *
   * 默认名带毫秒时间戳：原先是固定「未命名项目」，而项目目录由名称推导，
   * 于是第二次新建必然撞上第一次的目录，报「项目目录已存在」。
   * 后端现在也会自动避让重名，但名字本身唯一更好 ——
   * 用户看到的行内名不会出现两个一模一样的「未命名项目」。
   */
  const createBlank = useCallback(async (name?: string) => {
    const project = await studioHttpApi().projects.create({
      name: name?.trim() || `未命名项目-${Date.now()}`,
    })
    const result = toProject(project)
    setList((current) => [result, ...current.filter((p) => p.id !== result.id)])
    return result
  }, [])

  const rename = useCallback(async (id: string, name: string) => {
    const trimmed = name.trim()
    if (!trimmed) return
    const current = await studioHttpApi().projects.get(id)
    if (current.name === trimmed) return
    const updated = await studioHttpApi().projects.update(id, { name: trimmed }, current.etag)
    setList((items) => items.map((p) => p.id === id ? toProject(updated) : p))
  }, [])

  return { list, loading, error, refresh, create, createBlank, rename }
}

/** 目录名：中文也能用（去掉文件系统不认的字符，空格变 -） */
export function slug(s: string) {
  return s.trim().replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, '-').slice(0, 40) || 'project'
}
