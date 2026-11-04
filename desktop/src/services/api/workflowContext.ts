/**
 * 项目 × workflow-v5 创作上下文。
 *
 * <p><strong>与 `workflows.ts` 不是一回事</strong>：那边对接的是后端 workflow 域
 * （定义/版本/运行状态机，`docs/contracts/workflow.md`）。这里是真正把
 * `desktop/workflow-v5` 那套 Prompt-first 流程接进来的入口 ——
 * 它管的是项目目录里的创作上下文文件（`prompt.original.md` 等），
 * 由后端调用 workflow-v5 的零依赖 Node 工具写入。</p>
 *
 * <p><strong>为什么要有它</strong>：workflow-v5 的创作依据是「用户原文 + 纠正 + 决定」，
 * 而这些此前从来没有落到项目目录里 —— 那套流程因此无法真正启动。</p>
 */
import type { HttpClient } from './http'

/** 一个项目的 workflow 创作上下文状态。 */
export interface WorkflowContextState {
  projectId: string
  directory: string
  /** 是否已有 prompt.original.md —— 这是 Prompt-first 的入口条件 */
  initialized: boolean
  /** workflow-v5 工具目录是否可被后端找到 */
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
const RENDER_TIMEOUT_MS = 20 * 60 * 1000
const CREATE_TIMEOUT_MS = 25 * 60 * 1000

/** 项目工程配置状态。 */
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
  /** agent 对这次改动的说明 */
  reply: string
  /** agent 耗时 */
  agentMs: number
  artifactPath: string
  version: number
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
  create(projectId: string, intent?: string, references?: unknown[]): Promise<FilmCreateResult>
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
    state(projectId) {
      return http.get<WorkflowContextState>(base(projectId))
    },

    init(projectId, prompt) {
      return http.post<WorkflowContextInitResult>(`${base(projectId)}/init`, { prompt: prompt ?? '' })
    },

    film(projectId) {
      return http.get<FilmProjectState>(`${base(projectId)}/film`)
    },

    renderFilm(projectId, prompt) {
      /* 渲染通常 30 秒起，首次还要下载浏览器。默认 15 秒超时必然掐断，
         而掐断后用户看到的是「请求超时」——完全看不出是在渲染。 */
      return http.post<FilmRenderResult>(`${base(projectId)}/render`,
        { prompt: prompt ?? '' }, { timeoutMs: RENDER_TIMEOUT_MS })
    },

    recordCorrection(projectId, text) {
      return http.post<WorkflowContextState>(`${base(projectId)}/corrections`, { text })
    },

    create(projectId, intent, references) {
      /* agent 改工程要读需求、写代码、可能自查，实测 100~200 秒。
         给足时间，别让默认 15 秒把一次正常创作当成失败。

         references 必须一起发：用户选了三库资源却只发需求的话，
         agent 根本不知道有这些资源，用户会以为已经用上了。 */
      return http.post<FilmCreateResult>(`${base(projectId)}/create`,
        { intent: intent ?? '', ...(references && references.length > 0 ? { references } : {}) },
        { timeoutMs: CREATE_TIMEOUT_MS })
    },
  }
}
