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
  /** 已完成的真实渲染轮次（qa/passes 下的目录数）；-1 表示读不到 */
  passes: number
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
  init(projectId: string, prompt?: string): Promise<WorkflowContextState>
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
      return http.post<WorkflowContextState>(`${base(projectId)}/init`, { prompt: prompt ?? '' })
    },
  }
}
