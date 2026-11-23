import { useCallback, useEffect, useRef, useState } from 'react'
import { studioHttpApi } from '@/api'
import { ApiError } from '@/api/errors'
import type { MappingJob, MappingJobStage, WorkflowPreset } from '@/api/skillPresets'

export interface GenerationState {
  packageId: string
  skillPath: string
  /** job：后台作业，有阶段、可取消；sync：后端还没有作业接口，只能等同步调用返回 */
  mode: 'job' | 'sync'
  jobId: string | null
  stage: MappingJobStage | null
  startedAt: number
  cancelling: boolean
}

export interface GenerationFailure {
  skillPath: string
  message: string
  problems: Array<{ field: string; message: string }>
}

const POLL_MS = 1000
const TERMINAL = new Set<MappingJob['status']>(['succeeded', 'failed', 'cancelled'])

function failureFrom(skillPath: string, err: unknown): GenerationFailure {
  if (err instanceof ApiError) {
    const raw = err.details?.problems
    const problems = Array.isArray(raw)
      ? raw.map((p) => (typeof p === 'string' ? { field: '', message: p } : { field: String((p as { field?: unknown }).field ?? ''), message: String((p as { message?: unknown }).message ?? '') }))
      : []
    return { skillPath, message: err.message || '生成失败', problems }
  }
  return { skillPath, message: err instanceof Error ? err.message : '生成失败', problems: [] }
}

/**
 * 生成预设草稿：优先走后台作业（显示真实阶段、可取消、刷新后接回），
 * 后端没有作业接口时退回同步调用，只显示已用时间（契约 workflow-editor-ui.md §2.4）。不做假进度。
 */
export function useMappingGeneration(packageId: string | null, handlers: {
  onDone: (preset: WorkflowPreset) => void
  onCancelled: (skillPath: string) => void
}) {
  const [state, setState] = useState<GenerationState | null>(null)
  const [failure, setFailure] = useState<GenerationFailure | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const alive = useRef(true)
  const pollTimer = useRef(0)
  /* 正在轮询的作业：同一个作业只开一条轮询链 */
  const polling = useRef<string | null>(null)
  const latest = useRef(handlers)
  useEffect(() => { latest.current = handlers })
  useEffect(() => {
    alive.current = true
    return () => { alive.current = false; window.clearTimeout(pollTimer.current) }
  }, [])

  /* 已用时间：每秒刷一次，只在生成中 */
  useEffect(() => {
    if (!state) return
    const t = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [state])

  const finishJob = useCallback(async (job: MappingJob) => {
    polling.current = null
    if (!alive.current) return
    setState(null)
    if (job.status === 'succeeded' && job.presetId) {
      try {
        const preset = await studioHttpApi().skillPresets.getPreset(job.presetId)
        if (alive.current) latest.current.onDone(preset)
      } catch (err) {
        if (alive.current) setFailure(failureFrom(job.skillPath, err))
      }
    } else if (job.status === 'cancelled') {
      latest.current.onCancelled(job.skillPath)
    } else {
      setFailure({ skillPath: job.skillPath, message: job.error?.message || '生成失败', problems: job.error?.problems ?? [] })
    }
  }, [])

  const poll = useCallback((first: MappingJob, startedAt: number) => {
    if (!alive.current || polling.current === first.id) return
    polling.current = first.id
    const step = (job: MappingJob) => {
      if (!alive.current) return
      if (TERMINAL.has(job.status)) { void finishJob(job); return }
      setState((prev) => ({
        packageId: job.skillPackageId,
        skillPath: job.skillPath,
        mode: 'job',
        jobId: job.id,
        stage: job.stage,
        startedAt: prev?.jobId === job.id ? prev.startedAt : startedAt,
        cancelling: prev?.jobId === job.id ? prev.cancelling : false,
      }))
      pollTimer.current = window.setTimeout(() => {
        void studioHttpApi().skillPresets.getMappingJob(job.id)
          .then(step)
          .catch((err) => { polling.current = null; if (alive.current) { setState(null); setFailure(failureFrom(job.skillPath, err)) } })
      }, POLL_MS)
    }
    step(first)
  }, [finishJob])

  /* 换包或刷新页面后接回还没结束的作业 */
  useEffect(() => {
    if (!packageId) return
    let cancelled = false
    void studioHttpApi().skillPresets.listActiveMappingJobs(packageId)
      .then((jobs) => {
        const job = jobs[0]
        if (!cancelled && job) poll(job, job.startedAt ? Date.parse(job.startedAt) : Date.now())
      })
      .catch(() => { /* 接不回只是少显示一个进度，不打断用户 */ })
    /* 换包时不停轮询：作业还在后端跑，结果回来照样要打开草稿 */
    return () => { cancelled = true }
  }, [packageId, poll])

  const start = useCallback(async (skillPath: string) => {
    if (!packageId || state) return
    const startedAt = Date.now()
    setFailure(null)
    setNow(startedAt)
    setState({ packageId, skillPath, mode: 'sync', jobId: null, stage: null, startedAt, cancelling: false })
    const api = studioHttpApi().skillPresets
    try {
      const job = await api.startMappingJob(packageId, skillPath)
      if (job) { poll(job, startedAt); return }
      const preset = await api.generateMapping(packageId, skillPath)
      if (!alive.current) return
      setState(null)
      latest.current.onDone(preset)
    } catch (err) {
      if (!alive.current) return
      const jobId = err instanceof ApiError && err.details?.rawCode === 'mapping_in_progress' ? err.details?.jobId : null
      if (typeof jobId === 'string') {
        void api.getMappingJob(jobId).then((job) => poll(job, startedAt)).catch((e) => { setState(null); setFailure(failureFrom(skillPath, e)) })
        return
      }
      setState(null)
      setFailure(failureFrom(skillPath, err))
    }
  }, [packageId, state, poll])

  const cancel = useCallback(async () => {
    if (!state?.jobId || state.cancelling) return
    setState({ ...state, cancelling: true })
    try {
      await studioHttpApi().skillPresets.cancelMappingJob(state.jobId)
    } catch (err) {
      setState((prev) => (prev ? { ...prev, cancelling: false } : prev))
      setFailure(failureFrom(state.skillPath, err))
    }
  }, [state])

  return {
    generating: state,
    elapsedMs: state ? now - state.startedAt : 0,
    failure,
    clearFailure: () => setFailure(null),
    start,
    cancel,
  }
}
