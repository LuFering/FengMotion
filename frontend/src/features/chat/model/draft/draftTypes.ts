/** 会话草稿的数据形状：附件、工作台目标快照、草稿本体。 */
export interface DraftAttachment {
  name: string
  size: number
  kind: 'file' | 'image' | 'video' | 'technique'
  source?: 'asset' | 'ref' | 'fx'
  refVideoId?: string
  refStart?: number
  refEnd?: number
  refWants?: string
  fxId?: string
  fxVersion?: string
  uploadId?: string
  purpose?: string
  note?: string
  assetId?: string
  fileId?: string
  mimeType?: string
  uploading?: boolean
  uploadError?: string
  progress?: number
  previewUrl?: string
  rawFile?: File
}

export interface TargetSnapshot {
  /** 目标引用的工程版本号 */
  version: number | null
  /**
   * 这个版本号属于哪条序列 —— **必须与 version 一起固化**。
   *
   * <p>为什么不能由界面「当前在看什么」推断：用户可以先固化目标、再切换预览，
   * 那时快照里的版本号与当前预览已经不是同一画面。拿当前预览的来源去解释
   * 快照里的数字，就会把「试片的第 2 次导出」当成场景版本参与比较。</p>
   *
   * <p>旧快照没有这个字段 → 视为**来源不明**，界面应降级（不比较、不断言），
   * 不能从「有数字」推断它是场景版本。</p>
   */
  versionSeries?: 'scene' | 'editor' | 'workflow' | null
  /**
   * 这个版本号在写入快照时**是否已确认**为工程版本。
   *
   * <p>写入时后端版本读不到，就记 false —— 之后即使后端恢复了，
   * 也不能把这个旧数字当成权威工程版本去比较。</p>
   */
  versionConfirmed?: boolean
  /** 作用范围 */
  scope: 'project' | 'scene' | 'selection'
  /** 时间段选区 */
  rangeSpan?: { start: number; end: number } | null
  /** 画面标注选框 */
  bbox?: [number, number, number, number] | null
  label?: string
  previewImage?: string | null
  references?: Array<{ id: string; role: string; label?: string; [key: string]: any }>
  /** 是否由创作者明确固化引用的快照（区别于未固化的播放器当前画面） */
  pinned?: boolean
  /** 创作者明确的意图动作：'modify'（修改视频）或 'query'（关于此目标发问） */
  intentAction?: 'modify' | 'query'
}

export interface SessionDraft {
  text: string
  attachments: DraftAttachment[]
  targetSnapshot: TargetSnapshot | null
  /**
   * 本轮的意图：修改视频，还是只在对话里问一句。
   *
   * <p>为什么不能只存在 targetSnapshot.intentAction 里：没有显式目标
   * （普通输入、只说「全局工程」）时 targetSnapshot 是 null，
   * 意图写进去就丢了 —— 用户点了「关于此提问」，发出去却仍然改工程。
   * 所以意图单独记一份，作为 targetSnapshot 缺省时的来源。</p>
   */
  intentAction?: 'modify' | 'query'
  /** 基于上一轮继续调整时的范围确认模式：需重新选择目标或已明确确认整片 */
  continuationScopeMode?: 'target_required' | 'whole_confirmed' | null
  pendingSubmission?: {
    requestId?: string | null
    promptKey?: string
    /**
     * 消息请求身份（真实发送字段算出的指纹）。
     *
     * <p>重试判定只看它：旧格式的 `promptKey`（会话:项目:文字）不足以确认
     * 目标和附件一致，不能当作完整匹配。</p>
     */
    messageFingerprint?: string
    /**
     * 创作请求身份。
     *
     * <p>用于核对「这条消息对应的创作请求是否仍是同一份」——
     * 消息相同但创作字段变了（例如换了参考素材）时，不能复用旧任务。</p>
     */
    creationFingerprint?: string
    idempotencyKey?: string
    sessionId?: string
    userMessageId?: string | null
    text?: string
    targetSnapshot?: TargetSnapshot | null
    retryCount?: number
    createdAt?: number
    timestamp?: number
    error?: string | null
  } | null
  updatedAt: number
}
