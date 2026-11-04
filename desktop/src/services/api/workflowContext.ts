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
      return http.post<FilmRenderResult>(`${base(projectId)}/render`, { prompt: prompt ?? '' })
    },
  }
}
