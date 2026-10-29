
export type TaskKind = 'modify' | 'render' | 'undo' | 'redo' | 'restore'
export type TaskStatus = 'queued' | 'running' | 'building' | 'completed' | 'failed' | 'cancelled'
export type TaskEventKind = 'accepted' | 'progress' | 'build' | 'complete' | 'error' | 'cancelled'

export interface ModificationConstraints {
  preserveCamera: boolean
  preserveCaptions: boolean
  limitToSelection: boolean
  reuseExistingComponents: boolean
  /**
   * 区域外/背景保持不动；仅当用户框选了区域时才有意义。
   *
   * 为什么放在这里：它是本机审阅流程要表达的保留条件，服务端契约尚未冻结此字段，
   * 所以只在本文件的请求信封上做可选本地扩展，不改冻结的契约（src/types/contracts.ts）。
   * 保持可选也意味着：老调用方不传它时不会因此编译失败，演示适配器按「未设置」处理。
   */
  preserveOutsideSelection?: boolean
  durationSeconds?: number
  resolution?: '1080p' | '1440p' | '4k'
}

/**
 * 结构化引用：Agent 修改的对象 + 它需要读取的上下文。
 *
 * 位置一律用稳定 ID / 精确帧 / 归一化区域 / 产物版本表示；
 * 不让模型从「这里/这段」猜位置。
 */
export interface PreviewSource {
  origin?: 'editor' | 'workflow'
  assetId?: string
  projectId: string
  visualId: string
  artifactId?: string
  workflowId?: string
  runId?: string
  revision?: number
  file: string
  media: 'video' | 'image'
}

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
  | { id: string; role: 'target' | 'context'; kind: 'preview'; label: string; source: PreviewSource; timeSeconds?: number; endTimeSeconds?: number; bbox?: { x: number; y: number; w: number; h: number } }

export interface TaskRequest {
  /** Local review envelope; pending backend contract, not an Agent execution receipt. */
  feedbackId?: string
  creativeBrief?: import('./workbenchReviewService').CreativeBriefSnapshot
  projectId?: string
  workflowId?: string
  workflowRevision?: number
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
      /* 先让出一个微任务，再发第一条事件。
         调用方要拿到 startTask 的返回值才有 runRef（useAgentTasks 就是这个写法），
         在返回之前同步 emit，第一条事件会打在 undefined 上 —— 提交必崩、
         任务永远停在「排队中」，之前就是这个坑。 */
      await Promise.resolve()
      /* 演示适配器不执行任何操作，但它必须如实回报「收到了什么」：
         产品文档 §7 要求用户所指的对象与 AI 实际修改的对象是同一个。
         原先只拿 target 的 label 拼一句话，bbox / timeSeconds / constraints /
         creativeBrief 全都读都没读，用户无法核对自己指的东西有没有真的被带上。
         所以下面逐项展开请求信封里的定位与约束；缺失的项一律显式说明「没有/未给出」，
         不留空项，避免「没说」被读成「没问题」。 */
      const refs = request.references ?? []
      const targetRefs = refs.filter((ref) => ref.role === 'target')
      const targetRef = targetRefs[0]
      const contextRefs = refs.filter((ref) => ref.role === 'context')

      // 目标对象：kind + label 是稳定定位，时间位置全部换算成「秒」并保留 3 位小数
      const targetParts: string[] = []
      if (targetRef) {
        targetParts.push(`kind=${targetRef.kind}`, `label「${targetRef.label}」`)
        if (targetRef.kind === 'preview') {
          if (targetRef.source.media === 'image') {
            // 图片预览没有时间轴，报「未给出」会误导成字段丢失，所以明说「不适用」
            targetParts.push('时间位置不适用（图片预览）')
          } else if (targetRef.timeSeconds !== undefined || targetRef.endTimeSeconds !== undefined) {
            if (targetRef.timeSeconds !== undefined) targetParts.push(`timeSeconds ${targetRef.timeSeconds.toFixed(3)} 秒`)
            if (targetRef.endTimeSeconds !== undefined) targetParts.push(`endTimeSeconds ${targetRef.endTimeSeconds.toFixed(3)} 秒`)
          } else {
            targetParts.push('timeSeconds/endTimeSeconds 未给出（按整段预览处理）')
          }
        }
        if (targetRefs.length > 1) targetParts.push(`另有 ${targetRefs.length - 1} 条 target 引用未展开`)
      }
      const scopeFallback = request.scope === 'scene'
        ? `场景 ${request.sceneIds.join('、') || '当前场景'}`
        : request.scope === 'selection' ? '所选场景' : '整个项目'
      const targetText = targetRef ? targetParts.join(' · ') : `没有 target 引用（按${scopeFallback}范围处理）`

      // 框选区域只从 target 引用上读：用户框的是「要改的东西」，context 上的区域不是本次选区。
      // bbox 是归一化坐标（0–1，与 Workbench 预览高亮同一套），所以乘 100 报百分比。
      const targetBbox = targetRef && 'bbox' in targetRef ? targetRef.bbox : undefined
      const bboxText = targetBbox
        ? `x ${(targetBbox.x * 100).toFixed(1)}% · y ${(targetBbox.y * 100).toFixed(1)}% · 宽 ${(targetBbox.w * 100).toFixed(1)}% · 高 ${(targetBbox.h * 100).toFixed(1)}%`
        : '没有框选区域'

      // 保留条件：只列 true 的项，同时带上字段名，用户才能核对是哪一项被带上
      const keepFlags: Array<[boolean, string]> = [
        [request.constraints.preserveCamera, 'preserveCamera 机位'],
        [request.constraints.preserveCaptions, 'preserveCaptions 字幕'],
        [request.constraints.limitToSelection, 'limitToSelection 限定区域'],
        [request.constraints.reuseExistingComponents, 'reuseExistingComponents 复用组件'],
        [request.constraints.preserveOutsideSelection === true, 'preserveOutsideSelection 区域外不动'],
      ]
      const extraConstraints: string[] = []
      if (request.constraints.durationSeconds !== undefined) extraConstraints.push(`时长 ${request.constraints.durationSeconds} 秒`)
      if (request.constraints.resolution !== undefined) extraConstraints.push(`分辨率 ${request.constraints.resolution}`)
      const keepList = keepFlags.filter(([on]) => on).map(([, label]) => label).join(' · ')
      // 附加参数放进括号，避免用到与外层分句相同的「；」而把「保留条件」这一项切断
      const keepText = `${keepList || '没有设置保留条件'}${extraConstraints.length ? `（附加参数：${extraConstraints.join(' · ')}）` : ''}`

      // 需求快照只报存在性与条数：事件流是操作回执，不是文档传输通道，不抄原文
      const brief = request.creativeBrief
      const briefText = brief
        ? `需求原文${brief.original.trim() ? `已附带（${brief.original.trim().length} 字，正文不进入事件流）` : '为空'} · 后续纠正 ${brief.corrections.length} 条 · keepNotes ${brief.keepNotes.trim() ? '有内容' : '为空'}`
        : '没有附带需求快照'

      const scopeText = `scope=${request.scope} · sceneIds ${request.sceneIds.length ? request.sceneIds.join('、') : '为空'}`
      // 文档要求分清「要改的」和「只作上下文参考的」，所以 context 引用单独报数量并列出 label；
      // 列出上限 3 条，避免事件文案被长引用列表挤掉（数量永远如实给全）
      const contextText = contextRefs.length
        ? `${contextRefs.length} 条（${contextRefs.length <= 3 ? '' : '前 3 条：'}${contextRefs
            .slice(0, 3).map((ref) => `${ref.kind}「${ref.label}」`).join('、')}）`
        : '没有 context 引用'
      const refText = `引用共 ${refs.length} 条（target ${targetRefs.length} 条 · context ${contextRefs.length} 条）`
      const kindLabel = kind === 'render' ? '导出' : kind === 'modify' ? '修改' : kind

      try {
        emit({ kind: 'accepted', status: 'queued', message: `演示模式：已接收${kindLabel}请求，未调用 AI、未修改任何项目文件、未生成新预览。目标对象：${targetText}；框选区域：${bboxText}；保留条件：${keepText}；需求快照：${briefText}；范围：${scopeText}；上下文引用：${contextText}。` })
        await wait(650, abort.signal)
        emit({ kind: 'progress', status: 'running', message: `演示流程：请求已排队，Agent 后端未连接。按收到的值登记：目标对象 ${targetText}；范围 ${scopeText}；${refText}。` })
        await wait(700, abort.signal)
        emit({ kind: 'build', status: 'building', message: `演示流程：没有执行代码修改或构建，也没有产出任何预览文件；保留条件（${keepText}）只被记录，不作用于任何文件。` })
        await wait(650, abort.signal)
        emit({ kind: 'complete', status: 'completed', message: `演示流程结束。没有调用 AI、没有修改任何项目文件、没有生成新预览。与接收时逐项复核：目标对象 ${targetText}；框选区域 ${bboxText}；保留条件 ${keepText}；需求快照 ${briefText}；范围 ${scopeText}；上下文引用 ${contextText}。` })
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
