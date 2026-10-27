
export type TaskKind = 'modify' | 'render' | 'undo' | 'redo' | 'restore'
export type TaskStatus = 'queued' | 'running' | 'building' | 'completed' | 'failed' | 'cancelled'
export type TaskEventKind = 'accepted' | 'progress' | 'build' | 'complete' | 'error' | 'cancelled'

export interface ModificationConstraints {
  preserveCamera: boolean
  preserveCaptions: boolean
  limitToSelection: boolean
  reuseExistingComponents: boolean
  durationSeconds?: number
  resolution?: '1080p' | '1440p' | '4k'
}

/**
 * 结构化引用：Agent 修改的对象 + 它需要读取的上下文。
 *
 * 位置一律用稳定 ID / 精确帧 / 归一化区域 / 产物版本表示；
 * 不让模型从「这里/这段」猜位置。
 */
export type AgentReference =
  | { id: string; role: 'target' | 'context'; kind: 'project'; projectId: string; label: string }
  | { id: string; role: 'target' | 'context'; kind: 'shot'; shotId: string; label: string }
  | { id: string; role: 'target' | 'context'; kind: 'frame'; shotId: string; frame: number; timecode: string; label: string; snapshotId?: string }
  | { id: string; role: 'target' | 'context'; kind: 'range'; shotId: string; startFrame: number; endFrame: number; timecode: string; label: string }
  | { id: string; role: 'target' | 'context'; kind: 'region'; shotId: string; frame: number; bbox: { x: number; y: number; w: number; h: number }; label: string }
  | { id: string; role: 'target' | 'context'; kind: 'artifact'; artifactId: string; version: string; label: string }
  /* 场景：左栏「内容」页里真实存在的内容单元（workflow-v5 就把它叫 scene ——
     scene-intents / scene-spec / sceneId 一套词）。它来自工作流产出的产物，
     不是那条占位视频的渲染切片，所以不复用 shot：shot 指向的是占位数据。
     范围靠稳定 id + 名字表达，不让模型从「这一段」猜。 */
  | { id: string; role: 'target' | 'context'; kind: 'scene'; sceneId: string; label: string }

export interface TaskRequest {
  kind: TaskKind
  prompt: string
  scope: 'project' | 'scene' | 'selection'
  sceneIds: string[]
  references?: AgentReference[]
  constraints: ModificationConstraints
  attachments: Array<{ name: string; type: string; size: number }>
}

export interface AgentTask {
  id: string
  kind: TaskKind
  status: TaskStatus
  title: string
  createdAt: string
  mock: true
}

export interface TaskEvent {
  id: string
  taskId: string
  kind: TaskEventKind
  status: TaskStatus
  message: string
  at: string
  mock: true
}

export interface ChangeSet {
  taskId: string
  files: Array<{ path: string; summary: string; additions: number; deletions: number }>
  buildStatus: 'not-run' | 'passed' | 'failed'
  mock: true
}

export interface ProjectVersion {
  id: string
  name: string
  source: string
  createdAt: string
  summary: string
  restorable: boolean
}

export interface TaskRun {
  task: AgentTask
  events: TaskEvent[]
  changes: ChangeSet | null
  cancel: () => void
  done: Promise<void>
}

/**
 * Stable seam for replacing the local demo adapter with the actual Agent API.
 * Task events deliberately describe only observable operations, never model reasoning.
 */
export interface StudioApi {
  startTask(request: TaskRequest, onEvent: (event: TaskEvent) => void): TaskRun
  cancelTask(taskId: string): void
  listVersions(): ProjectVersion[]
  listChanges(taskId: string): ChangeSet | null
  render(onEvent: (event: TaskEvent) => void): TaskRun
  restoreVersion(versionId: string): Promise<{ restored: boolean; message: string }>
}

type ActiveRun = { abort: AbortController; listeners: Set<(event: TaskEvent) => void> }

const wait = (ms: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  const timer = setTimeout(resolve, ms)
  signal.addEventListener('abort', () => {
    clearTimeout(timer)
    reject(new DOMException('Cancelled', 'AbortError'))
  }, { once: true })
})

const stamp = () => new Date().toLocaleTimeString('zh-CN', { hour12: false })

/**
 * Explicit demo adapter: advances visible UI states but does not modify project files,
 * invoke an agent, build a composition, or create an export.
 */
export class MockStudioApi implements StudioApi {
  private runs = new Map<string, ActiveRun>()
  private changes = new Map<string, ChangeSet>()

  startTask(request: TaskRequest, onEvent: (event: TaskEvent) => void): TaskRun {
    return this.run(request.kind, request, onEvent)
  }

  render(onEvent: (event: TaskEvent) => void): TaskRun {
    return this.run('render', {
      kind: 'render', prompt: 'Render current project', scope: 'project', sceneIds: [], references: [],
      constraints: { preserveCamera: false, preserveCaptions: false, limitToSelection: false, reuseExistingComponents: false },
      attachments: [],
    }, onEvent)
  }

  cancelTask(taskId: string) {
    this.runs.get(taskId)?.abort.abort()
  }

  listVersions(): ProjectVersion[] {
    return [
      {
        id: 'source-render', name: '当前可播放预览', source: 'token-full-legacy.mp4',
        createdAt: '项目现有文件', summary: '152 秒旧版混合时间轴；只读来源，不是代码版本', restorable: false,
      },
      {
        id: 'v3-storyboard', name: 'V3 分镜目标', source: 'ref/分镜/完整分镜表-V3.md',
        createdAt: '项目现有文件', summary: '273.6 秒分镜草稿；未组装为可播放全片', restorable: false,
      },
    ]
  }

  listChanges(taskId: string) {
    return this.changes.get(taskId) ?? null
  }

  async restoreVersion(versionId: string) {
    const version = this.listVersions().find((v) => v.id === versionId)
    if (!version) return { restored: false, message: '找不到该来源。' }
    return {
      restored: false,
      message: `「${version.name}」是只读项目来源。当前演示适配器不写文件，真实版本恢复需接入 Agent 后端。`,
    }
  }

  private run(kind: TaskKind, request: TaskRequest, onEvent: (event: TaskEvent) => void): TaskRun {
    const id = `demo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
    const abort = new AbortController()
    const listeners = new Set([onEvent])
    const events: TaskEvent[] = []
    const status = kind === 'render' ? 'queued' : 'queued'
    const task: AgentTask = {
      id, kind, status, title: kind === 'render' ? '演示导出任务' : '演示修改请求',
      createdAt: stamp(), mock: true,
    }
    this.runs.set(id, { abort, listeners })

    const emit = (event: Omit<TaskEvent, 'id' | 'taskId' | 'at' | 'mock'>) => {
      const full: TaskEvent = { ...event, id: `${id}-${events.length}`, taskId: id, at: stamp(), mock: true }
      events.push(full)
      listeners.forEach((listener) => listener(full))
    }

    const done = (async () => {
      const refs = request.references ?? []
      const targetRef = refs.find((ref) => ref.role === 'target')
      const target = kind === 'render' ? '渲染队列' : targetRef?.label ?? (request.scope === 'scene'
        ? `场景 ${request.sceneIds.join(', ') || '当前场景'}`
        : request.scope === 'selection' ? '所选场景' : '整个项目')
      const contextText = refs.filter((ref) => ref.role === 'context').map((ref) => ref.label).join('、')
      try {
        emit({ kind: 'accepted', status: 'queued', message: `演示模式：已接收对${target}的${kind === 'render' ? '导出' : '修改'}请求${contextText ? `；上下文：${contextText}` : ''}。` })
        await wait(650, abort.signal)
        emit({ kind: 'progress', status: 'running', message: '演示流程：请求已排队。Agent 后端未连接。' })
        await wait(700, abort.signal)
        emit({ kind: 'build', status: 'building', message: '演示流程：未执行代码修改或构建；原始视频预览保持不变。' })
        await wait(650, abort.signal)
        emit({ kind: 'complete', status: 'completed', message: '演示流程结束。没有调用 AI、修改项目文件或生成导出文件。' })
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          emit({ kind: 'cancelled', status: 'cancelled', message: '演示任务已停止；没有项目文件被修改。' })
        } else {
          emit({ kind: 'error', status: 'failed', message: error instanceof Error ? error.message : '演示任务失败。' })
        }
      } finally {
        this.runs.delete(id)
      }
    })()

    return { task, events, changes: null, cancel: () => abort.abort(), done }
  }
}

export const studioApi: StudioApi = new MockStudioApi()
