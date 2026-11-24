import type { HttpClient } from './http'
import type { FilmRenderResult } from './workflowContext'

export interface SourceState {
  projectId: string
  version: number
  sourceHash: string
  renderedSourceHash: string | null
  dirty: boolean | null
  status: 'unrendered' | 'unknown' | 'dirty' | 'clean'
  operationBusy: boolean
  artifactPath: string | null
}

export interface SourceTarget { file: string; line: number; column: number; fileHash: string; code: string }
export interface SourceTargetContext { projectId: string; baseVersion: number; sourceHash: string; target: SourceTarget }
export type LiveAiSubmit = (prompt: string, target?: SourceTargetContext) => Promise<boolean>

interface RenderRequest { requestId: string; baseVersion: number; sourceHash: string; prompt: string }
interface RenderJob {
  projectId: string; requestId: string; state: string
  result: FilmRenderResult | null; errorCode: string | null; error: string | null
}

const inFlight = new Map<string, Promise<FilmRenderResult>>()
const pending = new Map<string, RenderRequest>()
const storedKey = (projectId: string) => `fm-source-render:${projectId}`
const wait = () => new Promise(resolve => window.setTimeout(resolve, 1000))

function remember(projectId: string, request: RenderRequest | null) {
  if (request) pending.set(projectId, request)
  else pending.delete(projectId)
  try {
    if (request) sessionStorage.setItem(storedKey(projectId), JSON.stringify(request))
    else sessionStorage.removeItem(storedKey(projectId))
  } catch { }
}

function recalled(projectId: string): RenderRequest | null {
  const current = pending.get(projectId)
  if (current) return current
  try {
    const parsed = JSON.parse(sessionStorage.getItem(storedKey(projectId)) || 'null')
    if (parsed && typeof parsed.requestId === 'string' && typeof parsed.sourceHash === 'string'
      && Number.isSafeInteger(parsed.baseVersion) && typeof parsed.prompt === 'string') return parsed
  } catch { }
  return null
}

export function renderWorktree(http: HttpClient, projectId: string, prompt = ''): Promise<FilmRenderResult> {
  const running = inFlight.get(projectId)
  if (running) return running
  const run = (async () => {
    const endpoint = `/projects/${encodeURIComponent(projectId)}/render-jobs`
    let request = recalled(projectId)
    if (!request) {
      const state = await http.get<SourceState>(`/projects/${encodeURIComponent(projectId)}/source/state`)
      if (state.projectId !== projectId) throw new Error('工作稿状态不属于当前项目')
      request = { requestId: crypto.randomUUID(), baseVersion: state.version, sourceHash: state.sourceHash, prompt }
      remember(projectId, request)
    }
    let job: RenderJob
    try { job = await http.post<RenderJob>(endpoint, request) }
    catch (failure) {
      try { job = await http.get<RenderJob>(`${endpoint}/${encodeURIComponent(request.requestId)}`) }
      catch {
        if ([400, 404, 409, 422].includes((failure as { httpStatus?: number }).httpStatus ?? 0)) remember(projectId, null)
        throw failure
      }
    }
    for (let attempt = 0; attempt < 1800; attempt++) {
      if (job.projectId !== projectId || job.requestId !== request.requestId) throw new Error('出片返回的请求身份不一致')
      if (job.state === 'rendered') {
        if (!job.result) throw new Error('出片已结束，但结果尚未读取完整；请接回原任务')
        remember(projectId, null)
        return job.result
      }
      if (['failed', 'interrupted', 'cancelled'].includes(job.state)) {
        remember(projectId, null)
        throw Object.assign(new Error(job.error || '本次未出片，工作稿仍保留'), { code: job.errorCode })
      }
      await wait()
      job = await http.get<RenderJob>(`${endpoint}/${encodeURIComponent(request.requestId)}`)
    }
    throw new Error('出片尚未确认结束，原请求已保留；请接回原任务，勿重复提交')
  })().finally(() => inFlight.delete(projectId))
  inFlight.set(projectId, run)
  return run
}
