import { useCallback, useEffect, useRef, useState } from 'react'
import { studioHttpApi } from '@/services/api'
import type { ProjectSceneState, ProjectSceneVersion } from '@/services/api/taskClient'

/**
 * 回退失败的原因。
 *
 * <p>为什么要分开：界面对这几种的处理完全不同 ——
 * 「有别的修改抢先了」应该让用户刷新后重试；「就是当前版本」根本不该报错，
 * 是用户点错了；「没有快照」则是这个项目从没留下历史。
 * 全塞进一个 message 里，用户只能看到一串文字而不知道该怎么办。</p>
 */
export type RestoreFailure =
  /** 看到的版本已过期，期间有别的修改提交了 */
  | { reason: 'conflict'; message: string }
  /** 目标就是当前版本，无需回退 */
  | { reason: 'noop'; message: string }
  /** 快照数据损坏，不能用来覆盖当前场景 */
  | { reason: 'corrupt'; message: string }
  /** 后端连不上 */
  | { reason: 'unreachable'; message: string }
  /** 其它拒绝 */
  | { reason: 'rejected'; message: string }

/**
 * 把回退异常归类。
 *
 * <p>只看错误码与 HTTP 状态，不猜文案 —— 靠 message 关键词判断
 * 会在改文案时静默失效。</p>
 *
 * @param error 抛出的异常
 * @returns 归类结果
 */
function describeRestoreFailure(error: unknown): RestoreFailure {
  const status = (error as { httpStatus?: number | null })?.httpStatus ?? null
  const code = (error as { code?: string })?.code ?? null
  const message = error instanceof Error ? error.message : String(error)

  if (status === null) {
    return { reason: 'unreachable', message }
  }
  if (code === 'scene_version_conflict' || status === 409) {
    return { reason: 'conflict', message }
  }
  if (code === 'noop_restore') {
    return { reason: 'noop', message }
  }
  if (code === 'snapshot_corrupt') {
    return { reason: 'corrupt', message }
  }
  return { reason: 'rejected', message }
}

/**
 * 场景版本历史与回退。
 *
 * <p><strong>为什么单独一个 hook</strong>：Workbench 已经很长，
 * 版本列表的读取、刷新、回退、错误归类是一组自洽的状态，
 * 塞回视图里会继续膨胀，也会让「回退成功后要刷新当前场景」这类联动散落各处。</p>
 *
 * <p><strong>回退成功后必须重新读当前场景</strong>：回退新增了一个版本，
 * 界面上显示的「场景版本 vN」如果不刷新，下一次提交就会带过期的 baseVersion，
 * 直接被后端 409 拒绝 —— 用户会以为回退把项目搞坏了。</p>
 */
export function useSceneVersions(projectId: string, onRestored?: (scene: ProjectSceneState) => void) {
  const [versions, setVersions] = useState<ProjectSceneVersion[]>([])
  const [loading, setLoading] = useState(false)
  /** 读列表失败的原因是「读不到」，与「没有版本」必须区分开 */
  const [loadError, setLoadError] = useState<string | null>(null)
  const [restoring, setRestoring] = useState<number | null>(null)
  const [failure, setFailure] = useState<RestoreFailure | null>(null)
  /** 回退成功后要告诉用户「这次回退产生了哪一版」，否则他只是看到列表变了 */
  const [lastRestored, setLastRestored] = useState<ProjectSceneVersion | null>(null)
  /* 组件卸载后不再 setState：回退与刷新都是异步的，卸载后写状态是 React 的经典告警来源 */
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => { alive.current = false }
  }, [])

  /**
   * 重新读取版本列表。
   *
   * @param silent 静默刷新（不显示加载态），用于提交任务后刷新
   */
  const refresh = useCallback(async (silent = false) => {
    if (!projectId) return
    if (!silent) setLoading(true)
    try {
      const items = await studioHttpApi().task.sceneVersions(projectId)
      if (!alive.current) return
      setVersions(items)
      setLoadError(null)
    } catch (error) {
      if (!alive.current) return
      // 读不到就如实说读不到，不要把列表清空冒充「没有版本」
      setLoadError(error instanceof Error ? error.message : String(error))
    } finally {
      if (alive.current && !silent) setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    setVersions([])
    setFailure(null)
    setLastRestored(null)
    void refresh()
  }, [projectId, refresh])

  /**
   * 回退到指定版本。
   *
   * @param targetVersion 目标版本号
   * @param expectedVersion 界面当前看到的版本号，用于并发校验
   * @returns 是否成功
   */
  const restore = useCallback(async (targetVersion: number, expectedVersion?: number) => {
    if (!projectId) return false
    setRestoring(targetVersion)
    setFailure(null)
    try {
      const restored = await studioHttpApi().task.restoreSceneVersion(
        projectId, targetVersion, expectedVersion,
      )
      if (!alive.current) return false
      setLastRestored(restored)
      await refresh(true)
      /* 回退后重读当前场景：不刷新的话下一次修改会带过期 baseVersion 被 409 拒绝 */
      if (alive.current && onRestored) {
        try {
          const scene = await studioHttpApi().task.currentScene(projectId)
          if (alive.current) onRestored(scene)
        } catch {
          // 读当前场景失败不影响「回退已成功」这个事实，界面可稍后重试
        }
      }
      return true
    } catch (error) {
      if (alive.current) setFailure(describeRestoreFailure(error))
      return false
    } finally {
      if (alive.current) setRestoring(null)
    }
  }, [projectId, refresh, onRestored])

  /** 清掉上一次的失败提示（用户改选其它版本时调用） */
  const clearFailure = useCallback(() => setFailure(null), [])

  return { versions, loading, loadError, restoring, failure, lastRestored, refresh, restore, clearFailure }
}
