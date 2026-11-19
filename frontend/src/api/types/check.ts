/** API 契约 · 检查。纯类型，规则见 api/contracts.ts 文件头。 */
import type { DemoFlag, Id, IsoDateTime, Page, TimecodeMs } from './common'

/* ============================ 检查 ============================ */

/**
 * 检查运行状态。没有 pending：检查在创建时即开始执行。
 * 运行级取消只表示「这次检查没跑完」，不得解释为「检查通过」。
 */
export type CheckRunStatus = 'running' | 'completed' | 'failed' | 'cancelled'

export interface CheckCounts {
  blocker: number
  major: number
  minor: number
  info: number
}

export interface CheckRun {
  checkRunId: Id
  projectId: Id
  taskId: Id
  /** 被检查的产物版本；换产物必须新开 run。 */
  renderId: Id
  status: CheckRunStatus
  startedAt: IsoDateTime
  /** 仅终态存在。 */
  completedAt?: IsoDateTime
  /** P1 预留：复检以新 run 替代旧 run 时指向被替代者；旧 run 数据只读保留。 */
  supersedesCheckRunId?: Id
  /** 已完成 run 的问题计数；running/未执行时不出现，不用 0 冒充「没问题」。 */
  counts?: CheckCounts
  demo?: DemoFlag
}

/** 问题严重度。blocker/major 阻断交付；minor/info 只提示。 */
export type CheckSeverity = 'blocker' | 'major' | 'minor' | 'info'

/** 问题定位的对象类型；与 targetId 组合定位，禁止只给文字描述。 */
export type CheckTargetType = 'scene' | 'timeline' | 'render' | 'asset' | 'workflow_node'

/**
 * 处理状态（人对问题的动作），与「检查结论」是两个概念：
 * resolved/ignored 只表示人处理过，绝不等于该项检查通过。
 */
export type CheckFindingStatus = 'open' | 'doing' | 'resolved' | 'ignored'

/** 证据项：可回溯的原始材料，不是结论摘要。 */
export interface CheckEvidence {
  kind: 'frame' | 'screenshot' | 'log' | 'metric'
  /** 产物 ID 或存储路径；与 timecodeMs 组合可定位到帧。 */
  ref: string
  timecodeMs?: TimecodeMs
  note?: string
}

export interface CheckFinding {
  findingId: Id
  projectId: Id
  checkRunId: Id
  /** 问题分类（如 'technical' | 'narrative'），由检查项定义，不在此枚举。 */
  category: string
  severity: CheckSeverity
  title: string
  description: string
  targetType: CheckTargetType
  targetId: Id
  /** 画面定位：仅在 targetType 为 scene/timeline/render 时有意义。 */
  timecodeMs?: TimecodeMs
  /** 证据（关键帧、截图、日志片段）；叙事类结论必须带，否则视为无效结论。 */
  evidence?: CheckEvidence[]
  status: CheckFindingStatus
  suggestedFix?: string
  /** 可执行的修改入口标识，供 UI 跳到对应操作；契约只约定标识，不约定交互。 */
  fixAction?: string
  createdAt: IsoDateTime
  updatedAt: IsoDateTime
  /** P1 预留 */
  resolvedAt?: IsoDateTime
  /** P1 预留：被哪条新问题项取代。 */
  supersededByFindingId?: Id
  etag: string
}

/**
 * 检查结论（派生值，不落库）：
 * - passed：run.status=completed 且无 blocker/major
 * - failed：run.status=completed 且存在 blocker/major
 * - not_run：没有 run，或 run 未完成（running/failed/cancelled）
 */
export type CheckConclusion = 'passed' | 'failed' | 'not_run'

export interface CheckRunDetail {
  run: CheckRun
  findings: Page<CheckFinding>
  conclusion: CheckConclusion
}

export interface CheckCreateRequest {
  /** 被检查的产物版本。 */
  renderId: Id
  /** 不传 = 全部检查项。 */
  categories?: string[]
  /** 只检查某段场景；不传 = 全片。 */
  sceneIds?: Id[]
  /** 复检时指向被替代的旧 run。 */
  supersedesCheckRunId?: Id
}

/** 只允许人改处理状态；检查结论字段不可由客户端写入。 */
export interface CheckFindingUpdateRequest {
  status: CheckFindingStatus
  note?: string
}
