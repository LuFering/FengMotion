/**
 * 项目 × workflow-v0.1.1 创作上下文。
 *
 * <p><strong>与 `workflows.ts` 不是一回事</strong>：那边对接的是后端 workflow 域
 * （定义/版本/运行状态机，`docs/contracts/workflow.md`）。这里是真正把
 * `frontend/workflow-v0.1.1` 那套 Prompt-first 流程接进来的入口 ——
 * 它管的是项目目录里的创作上下文文件（`prompt.original.md` 等），
 * 由后端调用 workflow-v0.1.1 的零依赖 Node 工具写入。</p>
 *
 * <p><strong>为什么要有它</strong>：workflow-v0.1.1 的创作依据是「用户原文 + 纠正 + 决定」，
 * 而这些此前从来没有落到项目目录里 —— 那套流程因此无法真正启动。</p>
 */
import type { HttpClient } from './http'
import { renderWorktree } from './sourceRender'
import type { AgentReference } from './studioApi'

export interface UnsavedReplyItem {
  requestId: string
  sessionId: string
  userMessageId: string
  reply: string
  createdAt: string
}

/** 一条创作轮次（`GET /workflow/creation-rounds` 返回项）。 */
export interface CreationRoundItem {
  requestId: string
  /** 所属项目 —— 前端要与当前项目核对 */
  projectId: string
  /** 所属会话 —— 前端要与当前会话核对，绝不用当前界面会话顶替 */
  sessionId: string
  /** 触发这一轮的用户消息 ID —— 唯一可靠的归属依据 */
  userMessageId: string
  status: string
  reply: string | null
  version: number | null
  error: string | null
  createdAt: string
  updatedAt: string
}

export interface CreationState {
  state: 'running' | 'edited' | 'rendered' | 'awaiting_info' | 'failed' | 'interrupted'
  phase?: 'analyzing' | 'rendering' | 'completed' | 'awaiting_info' | 'failed' | 'interrupted' | string | null
  intent: string | null
  reply: string | null
  references: AgentReference[] | null
  artifactPath: string | null
  version: number | null
  error: string | null
  updatedAt: string
  requestId?: string | null
  sessionSaved?: boolean | null
  /**
   * 触发这次创作的用户消息 ID（后端回显）。
   *
   * <p>刷新恢复要靠它把「本轮未改动工程」这类结论挂回正确的消息；
   * 没有就只能降级不显示。</p>
   */
  userMessageId?: string | null
  /**
   * 这条状态所属的会话 ID（后端回显）。
   *
   * <p>恢复时必须核对：状态可能属于另一个会话，拿当前界面会话顶替
   * 就会把 B 的结论写进 A 的作用域。</p>
   */
  sessionId?: string | null
}

/** 原文完整性检测状态（B2） */
export type OriginalIntegrity = 'ok' | 'suspect' | 'unknown'

/** 工作稿文件允许的名称（B1） */
export type WorkflowDraftName = 'lookdev-brief' | 'film-plan'

/** 工作稿（GET /workflow/drafts、GET/PUT /workflow/drafts/{name}） */
export interface WorkflowDraft {
  name: WorkflowDraftName
  file: string
  exists: boolean
  /** 列表接口为 null */
  content: string | null
  sha256: string | null
  /** 是否仍是 init 时模板原样；模板目录不可用时为 null */
  template: boolean | null
  size: number
  updatedAt: string | null
}

/** 兼容旧引用别名 */
export type WorkflowDraftSummary = WorkflowDraft
export type WorkflowDraftDetail = WorkflowDraft

/** 一个项目的 workflow 创作上下文状态。 */
export interface WorkflowContextState {
  projectId: string
  directory: string
  /** 是否已有 prompt.original.md —— 这是 Prompt-first 的入口条件 */
  initialized: boolean
  /** workflow-v0.1.1 工具目录是否可被后端找到 */
  toolAvailable: boolean
  /** 已存在的 Prompt-first 文件 */
  files: string[]
  /** 原文字符数；-1 表示读不到 */
  promptLength: number
  /** 真正有视频产物的轮次数；-1 表示读不到 */
  renderedPasses: number
  /** 留下失败记录、没有视频的轮次数 */
  failedPasses: number
  /** 目录存在但还没有产物的轮次数 */
  inProgressPasses: number
  /** B2：原文污染检测（ok | suspect | unknown），未初始化时为 null；只报告不自动修改 */
  originalIntegrity?: OriginalIntegrity | null
  /** B2：疑似污染的原因列表 */
  originalIntegrityReasons?: string[] | null
}

/** 一次初始化的结果。 */
export interface WorkflowContextInitResult {
  state: WorkflowContextState
  /** CREATED 首次建立 / UNCHANGED 需求没变化 / RECORDED_AS_CORRECTION 原文已存在、已记为纠正 */
  result: 'CREATED' | 'UNCHANGED' | 'RECORDED_AS_CORRECTION'
  /** 需要告诉用户的说明；没有则为 null */
  note: string | null
}

/* 长任务的超时预算。
   这两个操作背后是 agent 创作与 Chromium 渲染，不是普通请求；
   用统一默认值会把「正在正常工作」误判成「请求超时」。
   数值与后端 fengmotion.remotion.project-timeout-seconds 对齐并留出余量。 */
const CREATE_TIMEOUT_MS = 25 * 60 * 1000

/** 项目工程配置状态。 */
/**
 * 项目里真实存在的产物。
 *
 * <p>与 `data/workbenchArtifacts` 的示例数据不同：这里是后端读项目目录得到的，
 * 打开哪个项目就列哪个目录的文件。空数组表示「还没有产物」，
 * 界面要如实显示，不要填占位。</p>
 */
export interface ProjectArtifacts {
  /** 项目目录 */
  directory: string
  /** 文档型产物（md / json 等） */
  documents: {
    name: string
    /** prompt / correction / decision / plan / lookdev / quality / config / qa / other */
    kind: string
    path: string
    sizeBytes: number
    modifiedAt: string
  }[]
  /** 渲染出的视频 */
  renders: {
    name: string
    path: string
    sizeBytes: number
    modifiedAt: string
  }[]
}

export interface FilmProjectState {
  projectId: string
  /** 是否已有可渲染的工程（film.config.json 合法且入口存在） */
  ready: boolean
  entry: string | null
  compositionId: string | null
  /** 参与渲染的源码文件 */
  sourceFiles: string[] | null
}

/** agent 创作 + 渲染结果。 */
export interface FilmCreateResult {
  /**
   * 结果状态。
   *
   * <p>`rendered` = 工程被改动并渲出了新片；
   * `awaiting_info` = agent 只提问、没有改动工程，此时没有产物也没有新版本 ——
   * 界面必须显示「等待补充信息」，不能把旧工程重渲出来的片子当成修改成功。</p>
   */
  state: 'edited' | 'rendered' | 'awaiting_info' | 'failed'
  /** agent 对这次改动的说明 */
  reply: string
  /** agent 耗时 */
  agentMs: number
  /** 未渲染时为 null */
  artifactPath: string | null
  /** 未渲染时为 null */
  version: number | null
  durationInFrames: number
  width: number
  height: number
  fps: number
  /** 这次创作实际解析到的三库资源；用于核对用户所选资源是否真的传下去了 */
  resources?: {
    kind: string
    id: string
    label: string
    usage: string
    path: string | null
    startMs: number | null
    endMs: number | null
  }[]
  /**
   * 本次创作请求 ID（后端回显）。
   *
   * <p>用于把结果挂到「实际发起这次修改的请求」上，而不是靠时间或顺序猜。</p>
   */
  requestId?: string | null
  /**
   * 触发本次创作的用户消息 ID（后端回显）。
   *
   * <p>「未改动工程」这类结论必须能精确挂到某条消息；
   * 拿不到就明确降级，不贴到「最后一条回复」上。</p>
   */
  userMessageId?: string | null
}

/** 项目工程渲染结果。 */
export interface FilmRenderResult {
  artifactPath: string
  version: number
  entry: string
  compositionId: string
  durationInFrames: number
  width: number
  height: number
  fps: number
  renderMs: number
}

export interface WorkflowContextResource {
  /**
   * 读取上下文状态。
   *
   * @param projectId 项目 ID
   * @returns 状态
   */
  state(projectId: string): Promise<WorkflowContextState>

  /**
   * 建立 Prompt-first 创作上下文。
   *
   * <p>把用户原文<strong>逐字</strong>写入 `prompt.original.md`。
   * 已存在时不覆盖 —— 原文被后来的摘要替换，创作依据就没了。
   * 重复调用是安全的。</p>
   *
   * @param projectId 项目 ID
   * @param prompt 用户原始需求；省略时只建模板骨架
   * @returns 建立后的状态
   */
  init(projectId: string, prompt?: string): Promise<WorkflowContextInitResult>

  /**
   * 读取项目工程配置。
   *
   * @param projectId 项目 ID
   * @returns 配置状态；`ready=false` 表示还没有可渲染的工程
   */
  film(projectId: string): Promise<FilmProjectState>

  /**
   * 读取项目里真实存在的产物。
   *
   * @param projectId 项目 ID
   * @returns 文档与渲染产物；都为空表示这个项目还没有产物
   */
  artifacts(projectId: string): Promise<ProjectArtifacts>

  /**
   * 渲染项目工程。
   *
   * <p>渲染的是 agent 写在项目里的 Remotion 源码，不是场景 props。
   * 成功后提交为新版本，并记录源码指纹。</p>
   *
   * @param projectId 项目 ID
   * @param prompt 这次渲染对应的用户要求
   * @returns 渲染结果
   */
  renderFilm(projectId: string, prompt?: string): Promise<FilmRenderResult>

  /**
   * 记录一条修改意见到 corrections.md。
   *
   * <p>这是「用户看完片子提出修改」的落盘点：意见必须写进项目目录，
   * agent 下一轮改工程时才读得到。只存在浏览器里等于没提。</p>
   *
   * @param projectId 项目 ID
   * @param text 修改意见原话
   * @returns 记录后的上下文状态
   */
  recordCorrection(projectId: string, text: string): Promise<WorkflowContextState>

  /**
   * 让 agent 改工程并渲染出新版本（一步完成）。
   *
   * <p>agent 读原文与纠正改源码，后端负责渲染与登记版本。
   * 这是「提要求 → 看到新片子」的主入口。</p>
   *
   * @param projectId 项目 ID
   * @param intent 这一轮要做什么；省略则按现有需求与纠正推进
   * @returns agent 说明与渲染结果
   */
  creation(projectId: string, requestId?: string): Promise<CreationState | null>
  creationProgress(projectId: string, sessionId: string): Promise<{ requestId: string | null; text: string }>
  /**
   * 按「项目 + 会话」列出该会话真实发生过的创作轮次。
   *
   * <p>刷新恢复用它逐条回填，而不是读「项目最近一次状态」——
   * 后者不带会话，会把别的会话的结果写进当前会话。</p>
   */
  creationRounds(projectId: string, sessionId: string): Promise<CreationRoundItem[]>
  unsavedReplies(projectId: string, sessionId?: string): Promise<UnsavedReplyItem[]>
  syncReply(projectId: string, requestId: string): Promise<{ success: boolean; sessionSaved: boolean }>
  previewImageCapability(projectId: string): Promise<{ supported: boolean; baseVersionCheck?: boolean; atomicCorrection?: boolean; correctionRetryId?: boolean }>
  create(projectId: string, intent?: string, references?: AgentReference[], previewImage?: string, baseVersion?: number, correction?: string, requestId?: string, sessionId?: string, userMessageId?: string, selection?: { harness: string; model?: string; reasoningEffort?: string }): Promise<FilmCreateResult>
  /** B1：列出两份工作稿文件状态 */
  listDrafts(projectId: string): Promise<WorkflowDraft[]>
  /** B1：读取单份工作稿内容与 sha256 */
  getDraft(projectId: string, name: WorkflowDraftName): Promise<WorkflowDraft>
  /** B1：原子保存工作稿（并发冲突或任务运行中时后端返回 409） */
  saveDraft(projectId: string, name: WorkflowDraftName, body: { content: string; baseSha256: string | null }): Promise<WorkflowDraft>
  /** B2 可选：当 originalIntegrity 为 suspect 时由用户确认修复原文 */
  repairOriginal(projectId: string, body: { content: string; baseSha256: string }): Promise<WorkflowContextState>
}

/**
 * 创建 workflow 上下文客户端。
 *
 * @param http HTTP 客户端
 * @returns 资源
 */
export function createWorkflowContextResource(http: HttpClient): WorkflowContextResource {
  const base = (projectId: string) =>
    `/projects/${encodeURIComponent(projectId)}/workflow`

  return {
    previewImageCapability(projectId) {
      return http.get<{ supported: boolean; baseVersionCheck?: boolean; atomicCorrection?: boolean; correctionRetryId?: boolean }>(`${base(projectId)}/preview-image-capability`)
    },
    state(projectId) {
      return http.get<WorkflowContextState>(base(projectId))
    },

    init(projectId, prompt) {
      return http.post<WorkflowContextInitResult>(`${base(projectId)}/init`, { prompt: prompt ?? '' })
    },

    film(projectId) {
      return http.get<FilmProjectState>(`${base(projectId)}/film`)
    },

    artifacts(projectId) {
      return http.get<ProjectArtifacts>(`${base(projectId)}/artifacts`)
    },

    renderFilm(projectId, prompt) {
      return renderWorktree(http, projectId, prompt ?? '')
    },

    recordCorrection(projectId, text) {
      return http.post<WorkflowContextState>(`${base(projectId)}/corrections`, { text })
    },

    creation(projectId, requestId) {
      const q = requestId ? `?requestId=${encodeURIComponent(requestId)}` : ''
      return http.get<CreationState | null>(`${base(projectId)}/creation${q}`)
    },

    creationProgress(projectId, sessionId) {
      return http.get<{ requestId: string | null; text: string }>(`${base(projectId)}/creation-progress?sessionId=${encodeURIComponent(sessionId)}`)
    },

    creationRounds(projectId, sessionId) {
      return http.get<CreationRoundItem[]>(
        `${base(projectId)}/creation-rounds?sessionId=${encodeURIComponent(sessionId)}`)
    },

    unsavedReplies(projectId, sessionId) {
      const q = sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : ''
      return http.get<UnsavedReplyItem[]>(`${base(projectId)}/unsaved-replies${q}`)
    },

    syncReply(projectId, requestId) {
      return http.post<{ success: boolean; sessionSaved: boolean }>(`${base(projectId)}/creation/${encodeURIComponent(requestId)}/sync-reply`)
    },

    create(projectId, intent, references, previewImage, baseVersion, correction, requestId, sessionId, userMessageId, selection) {
      /* agent 改工程要读需求、写代码、可能自查，实测 100~200 秒。
         给足时间，别让默认 15 秒把一次正常创作当成失败。

         references 必须一起发：用户选了三库资源却只发需求的话，
         agent 根本不知道有这些资源，用户会以为已经用上了。 */
      return http.post<FilmCreateResult>(`${base(projectId)}/create`,
        {
          intent: intent ?? '',
          ...selection,
          ...(references !== undefined ? { references } : {}),
          ...(previewImage ? { previewImage } : {}),
          ...(baseVersion !== undefined ? { baseVersion } : {}),
          ...(correction ? { correction } : {}),
          ...(requestId ? { requestId } : {}),
          ...(sessionId ? { sessionId } : {}),
          ...(userMessageId ? { userMessageId } : {}),
        },
        { timeoutMs: CREATE_TIMEOUT_MS })
    },

    async listDrafts(projectId) {
      const payload = await http.get<WorkflowDraft[] | { drafts?: WorkflowDraft[] }>(`${base(projectId)}/drafts`)
      if (Array.isArray(payload)) return payload
      if (payload && Array.isArray(payload.drafts)) return payload.drafts
      return []
    },

    getDraft(projectId, name) {
      return http.get<WorkflowDraft>(`${base(projectId)}/drafts/${encodeURIComponent(name)}`)
    },

    saveDraft(projectId, name, body) {
      return http.put<WorkflowDraft>(`${base(projectId)}/drafts/${encodeURIComponent(name)}`, body)
    },

    repairOriginal(projectId, body) {
      return http.post<WorkflowContextState>(`${base(projectId)}/original/repair`, body)
    },
  }
}
