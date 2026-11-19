/**
 * 「这一版不能作为修改基准」的原因。
 *
 * <p>与 `data/versionIdentity.ts` 的 `ModifyBlockReason` 同构，
 * 但在这里独立声明：本模块要能被 Node 直接加载做回归测试，
 * 不能依赖带路径别名的模块链。</p>
 */
export type ModifyBlockReason = 'ok' | 'historical' | 'unconfirmed'

/** 不可修改时的文案；与 versionIdentity 中的实现保持一致。 */
function modifyBlockNotice(reason: ModifyBlockReason): string | null {
  if (reason === 'historical') {
    return '当前查看的是历史版本，历史画面仅供审阅与对比。如需在此基础上修改，请使用【继续调整】或先恢复到该版本'
  }
  if (reason === 'unconfirmed') {
    return '无法确认当前画面就是工程的当前版本（工程版本未能读取或已更新）。为避免基于错误基准修改，请稍后重试或重新选择画面'
  }
  return null
}

export type CapabilityStatus =
  | 'ready'            // 开放可用
  | 'loading'          // 加载中
  | 'unsupported'      // 确实不支持（如无结构化对象、纯视频无轨道）
  | 'missing_data'     // 数据缺失（如无预览、无清单、缺少指纹）
  | 'version_mismatch' // 版本不一致（如历史版本、指纹不匹配）
  | 'connection_error' // 服务连接失败 / 网络中断
  | 'locked_busy'      // 制作中锁定

export interface CapabilityResult {
  allowed: boolean
  status: CapabilityStatus
  reason?: string
  /** 允许使用但存在需要如实说明的前提（例如文档与画面版本无法交叉确认）。 */
  note?: string
}

/**
 * 后端能力探测结果。
 * 画面引用（单帧/框选）与时间段修改要求的接口并不相同：
 *   · 时间段：版本预检 + 原子意见保存 + 重试标识
 *   · 画面：以上三项 + 图像接收
 * 合并成一个布尔值会把本可用的能力一起关掉，所以这里分开记录。
 */
export interface BackendCapabilityInfo {
  status: 'checking' | 'ready' | 'unsupported' | 'connection_error'
  /** 画面（单帧 / 框选）引用是否可用 */
  imageSupported?: boolean
  /** 时间段修改是否可用 */
  spanSupported?: boolean
  /** 画面引用缺少的能力项 */
  missingForImage?: string[]
  /** 时间段修改缺少的能力项 */
  missingForSpan?: string[]
  error?: string
}

/**
 * 1. 播放、定位、缩放、选择时间范围的能力评估
 * 开放条件：当前预览可用（文件已就绪且有正常时长）
 */
export function evaluateTimelineOpsCapability(params: {
  hasPreview: boolean
  previewReady: boolean
  previewDuration: number
  previewFailed: boolean
  isBusy: boolean
}): CapabilityResult {
  if (!params.hasPreview) {
    return { allowed: false, status: 'missing_data', reason: '当前项目暂无预览画面' }
  }
  if (params.previewFailed) {
    return { allowed: false, status: 'connection_error', reason: '预览文件无法加载或连接中断，无法定位时间' }
  }
  if (!params.previewReady) {
    return { allowed: false, status: 'loading', reason: '正在加载预览画面…' }
  }
  if (!Number.isFinite(params.previewDuration) || params.previewDuration <= 0) {
    return { allowed: false, status: 'missing_data', reason: '正在读取媒体时长与元数据…' }
  }
  if (params.isBusy) {
    return { allowed: false, status: 'locked_busy', reason: 'Agent 正在执行制作，时间线已锁定' }
  }
  return { allowed: true, status: 'ready' }
}

/**
 * 2. 引用轨道片段能力评估
 * 开放条件：轨道清单与当前预览版本校验一致
 * 条件不满足时：可作为参考展示，但不能冒充精确修改目标
 */
export function evaluateTrackClipReferenceCapability(params: {
  hasPreview: boolean
  isHistorical: boolean
  /**
   * 不可作为修改基准的原因（比 isHistorical 更细）。
   *
   * <p>`isHistorical` 只是布尔，无法区分「确认历史」与「工程版本未确认」；
   * 两者都要拦截，但该给用户的建议不同。传了就优先按它给理由。</p>
   */
  modifyBlock?: ModifyBlockReason
  manifestStatus: 'loading' | 'missing' | 'invalid' | 'ready' | 'error'
  hasManifest: boolean
  hasSourceHashMatch: boolean
  hasVerifiedTracks: boolean
}): CapabilityResult {
  if (!params.hasPreview) {
    return { allowed: false, status: 'missing_data', reason: '暂无预览画面，无轨道数据' }
  }
  if (params.manifestStatus === 'loading') {
    return { allowed: false, status: 'loading', reason: '正在读取轨道信息…' }
  }
  if (params.manifestStatus === 'missing') {
    return { allowed: false, status: 'missing_data', reason: '当前项目没有轨道清单文件' }
  }
  if (params.manifestStatus === 'invalid') {
    return { allowed: false, status: 'unsupported', reason: '轨道清单格式无效，无法解析片段' }
  }
  if (params.manifestStatus === 'error') {
    return { allowed: false, status: 'connection_error', reason: '轨道信息读取失败，网络或服务异常' }
  }
  if (params.modifyBlock && params.modifyBlock !== 'ok') {
    return {
      allowed: false,
      status: 'version_mismatch',
      reason: params.modifyBlock === 'historical'
        ? '当前处于历史版本，轨道仅供参考对照，无法作为修改目标'
        : '无法确认当前轨道属于工程当前版本，仅供参考对照，无法作为修改目标',
    }
  }
  if (params.isHistorical) {
    return { allowed: false, status: 'version_mismatch', reason: '当前处于历史版本，轨道仅供参考对照，无法作为修改目标' }
  }
  if (!params.hasSourceHashMatch) {
    return { allowed: false, status: 'missing_data', reason: '缺少版本校验指纹，无法确认轨道归属，仅可作为参考展示' }
  }
  if (!params.hasVerifiedTracks) {
    return { allowed: false, status: 'version_mismatch', reason: '轨道清单与当前预览版本不匹配，仅作为参考展示' }
  }
  return { allowed: true, status: 'ready' }
}

/**
 * 3. 当前帧、框选区域或时间段交给 AI 修改能力评估
 * 开放条件：画面可用，且后端支持对应类型所需的接口与版本校验
 * 条件不满足时：保留查看能力；提交入口说明缺少的条件
 */
export function evaluateAiModifyTargetCapability(params: {
  hasPreview: boolean
  previewReady: boolean
  isHistorical: boolean
  /** 不可作为修改基准的原因；传了就优先按它给理由（见 {@link ModifyBlockReason}） */
  modifyBlock?: ModifyBlockReason
  backendCapability: BackendCapabilityInfo
  /** 本次要提交的目标类型：画面（单帧/框选）还是时间段 */
  targetKind?: 'frame' | 'span'
}): CapabilityResult {
  if (!params.hasPreview) {
    return { allowed: false, status: 'missing_data', reason: '当前没有可引用的预览画面' }
  }
  if (!params.previewReady) {
    return { allowed: false, status: 'loading', reason: '画面正在加载中，请就绪后再选择目标' }
  }
  /* 历史版本先于后端能力判断：用户最需要知道的是「看的是旧版本」，
     而不是「后端缺某个接口」—— 后者即使修好也仍然不能改旧版本。 */
  /* 优先按具体原因给理由：历史版本与「版本未确认」都要拦，
     但用户该做的事不同（前者恢复/继续调整，后者重试或重选画面）。 */
  if (params.modifyBlock && params.modifyBlock !== 'ok') {
    return {
      allowed: false,
      status: 'version_mismatch',
      reason: modifyBlockNotice(params.modifyBlock)
        ?? '当前画面不能作为修改基准',
    }
  }
  if (params.isHistorical) {
    return {
      allowed: false,
      status: 'version_mismatch',
      reason: '当前查看的是历史版本，历史画面仅供审阅与对比。如需在此基础上修改，请使用【继续调整】或先恢复到该版本',
    }
  }
  const capability = params.backendCapability
  if (capability.status === 'checking') {
    return { allowed: false, status: 'loading', reason: '正在探测后端版本校验与图像能力…' }
  }
  if (capability.status === 'connection_error') {
    return {
      allowed: false,
      status: 'connection_error',
      reason: `无法连接后端服务：${capability.error || '连接失败'}。服务恢复后可点此重新检测。`,
    }
  }
  const kind = params.targetKind ?? 'frame'
  const supported = kind === 'span' ? capability.spanSupported : capability.imageSupported
  if (!supported) {
    const missingList = (kind === 'span' ? capability.missingForSpan : capability.missingForImage) ?? []
    const missing = missingList.length ? missingList.join('、') : '版本校验与修改接口'
    return {
      allowed: false,
      status: 'unsupported',
      reason: `当前后端不支持${kind === 'span' ? '时间段' : '画面'}修改（缺少：${missing}）`,
    }
  }
  return { allowed: true, status: 'ready' }
}

/** 直接编辑可用的前提：已确认到一份与当前画面同一来源的具体文档。 */
export interface DirectEditTarget {
  /** 已确认的文档 id；开放编辑时必须把它原样交给编辑器。 */
  docId: string | null
  /** 文档内容是否已确认与画面一致（同 id 不等于同内容）。 */
  versionConfirmed: boolean
  /** 无法确认时的具体原因，用于界面如实说明。 */
  reason?: string
  /** 允许打开但需要提醒用户的前提（会显示在编辑器内，而不是一闪而过的提示条）。 */
  warning?: string
}

/** 本地文档的可核对摘要：不含图层等大字段。 */
export interface EditableDocSummary {
  id: string
  /** 来自源工程时，记的是源场景 id。 */
  sourceId?: string
  /** 来自源工程时，记的是源工程内容哈希。 */
  sourceHash?: string
  /** 文档内容指纹；同 id 的文档被改动后这个值会变。 */
  contentFingerprint?: string
}

/** 编辑器导出的试片记录摘要：能把画面反查回某份文档。 */
export interface EditorRenderSummary {
  id: string
  sceneId: string
  documentId?: string
  /** 渲染当时那份文档快照的内容指纹；旧记录可能没有。 */
  snapshotFingerprint?: string
}

/**
 * 计算文档内容指纹：忽略 updatedAt 这类每次保存都会变的字段，
 * 只对真正影响画面的内容做稳定序列化，再折叠成一个短哈希。
 * 用途是回答「这份文档现在的内容，还是渲染那条试片时的内容吗」。
 */
export function documentContentFingerprint(document: unknown): string {
  if (!document || typeof document !== 'object') return ''
  const stable = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(stable)
    if (value && typeof value === 'object') {
      const entries = Object.entries(value as Record<string, unknown>)
        .filter(([key]) => key !== 'updatedAt')
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      return entries.map(([key, item]) => [key, stable(item)])
    }
    return value
  }
  const text = JSON.stringify(stable(document))
  /* FNV-1a 32 位：同步、无依赖，浏览器与 Node 结果一致。 */
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

/**
 * 把当前画面反查成一份具体的编辑文档。
 *
 * 这是「直接编辑」的唯一判定来源：界面是否开放、编辑器打开哪一份文档、
 * 以及需要提醒什么，都必须来自这里的同一个结果。
 *
 * 确认强度按来源区分：
 *   · 编辑器试片：用渲染时的文档快照指纹比对当前文档 —— 同 id 不等于同内容，
 *     渲染后继续编辑同一文档，指纹会变，此时不能算「已确认」。
 *   · 场景版本：sourceHash 只能证明源工程内容相同，不能证明本地补丁没变，
 *     所以只按源内容匹配，并明确标注这一点。
 *   · 工作流产物：没有对应文档 → 不可编辑。
 */
export function resolveDirectEditTarget(params: {
  preview: { origin?: 'editor' | 'workflow' | 'scene'; artifactId?: string; runId?: string } | null
  /** 当前画面所属版本记录的 sourceHash（只有场景版本才有） */
  previewSourceHash?: string | null
  docs: EditableDocSummary[]
  renders: EditorRenderSummary[]
}): DirectEditTarget {
  if (!params.preview) {
    return { docId: null, versionConfirmed: false, reason: '当前没有可对照的画面版本，无法确认要编辑哪一份场景文档' }
  }
  const origin = params.preview.origin

  if (origin === 'editor') {
    const render = params.renders.find((item) => item.id === params.preview!.runId)
    if (render?.documentId) {
      const doc = params.docs.find((item) => item.id === render.documentId)
      if (doc) {
        const sameContent = Boolean(
          render.snapshotFingerprint &&
          doc.contentFingerprint &&
          render.snapshotFingerprint === doc.contentFingerprint,
        )
        if (sameContent) return { docId: doc.id, versionConfirmed: true }
        /* 同 id、内容已变：打开的是新内容，预览却是旧试片 —— 必须说清。 */
        if (render.snapshotFingerprint && doc.contentFingerprint) {
          return {
            docId: doc.id,
            versionConfirmed: false,
            warning: '这条试片渲染之后，该场景文档已被修改。编辑器打开的是当前保存的内容，与画面上的试片可能不一致；需要对照旧画面时请重新渲染。',
          }
        }
        return {
          docId: doc.id,
          versionConfirmed: false,
          warning: '这条试片没有保存渲染时的文档内容，无法确认当前文档与画面是否一致。',
        }
      }
      return { docId: null, versionConfirmed: false, reason: '这次试片对应的编辑文档已不存在，无法确认要编辑哪一份内容' }
    }
    /* 旧记录没存文档 id：只能按场景归属找，无法确认画面对应的具体内容。 */
    const byScene = render
      ? params.docs.find((doc) => doc.sourceId === render.sceneId)
      : params.docs.find((doc) => doc.sourceId === params.preview!.artifactId)
    if (byScene) {
      return {
        docId: byScene.id,
        versionConfirmed: false,
        warning: '这条试片没有记录对应的文档，只能按场景归属打开本地文档，无法确认与画面内容一致。',
      }
    }
    return { docId: null, versionConfirmed: false, reason: '这次试片的编辑文档已不存在，无法确认要编辑哪一份内容' }
  }

  if (origin === 'scene') {
    const hash = params.previewSourceHash
    if (!hash) {
      return { docId: null, versionConfirmed: false, reason: '当前版本缺少渲染指纹，无法确认对应的场景文档' }
    }
    /* 文档里记着它来自哪一份源工程内容；哈希一致才算同一份源内容。 */
    const doc = params.docs.find((item) => item.sourceHash === hash)
    if (!doc) {
      return { docId: null, versionConfirmed: false, reason: '该画面由工程渲染，本地没有与该版本内容一致的场景文档' }
    }
    return {
      docId: doc.id,
      versionConfirmed: false,
      warning: '该画面由工程渲染，本地文档的源内容与它一致；但本地对参数或文字的改动无法与渲染结果逐一核对。',
    }
  }

  return { docId: null, versionConfirmed: false, reason: '该画面来自工作流产物，没有对应的可编辑场景文档' }
}

/**
 * 4. 直接编辑场景参数或文字层能力评估
 * 开放条件：存在受支持的结构化编辑对象，且能确认与当前预览对应
 * 条件不满足时：禁用直接编辑入口并说明原因，不因“有源码”就推断可编辑
 */
export function evaluateDirectEditCapability(params: {
  projectId: string
  isHistorical: boolean
  hasPreview: boolean
  target: DirectEditTarget | null
}): CapabilityResult {
  if (params.isHistorical) {
    return { allowed: false, status: 'version_mismatch', reason: '历史版本不支持直接编辑场景参数，请先恢复到该版本或切回最新版本' }
  }
  if (!params.hasPreview) {
    return { allowed: false, status: 'missing_data', reason: '当前没有可对照的画面版本，无法确认要编辑哪一份场景文档' }
  }
  if (!params.target || !params.target.docId) {
    return {
      allowed: false,
      status: 'unsupported',
      /* 反查结果里已有更具体的原因（指纹对不上 / 文档不存在 / 工作流产物），
         直接透传，别用泛化文案盖掉用户能据此行动的信息。 */
      reason: params.target?.reason || '当前画面没有对应的本地场景文档，请通过 AI 对话发起调整',
    }
  }
  if (!params.target.versionConfirmed) {
    return {
      allowed: true,
      status: 'ready',
      /* 警告必须能在编辑器里看到：openEdit 会立刻切走监看区，
         写在监看区提示条里的说明用户根本来不及读。 */
      note: params.target.warning || '无法确认本地文档与当前画面内容一致，请谨慎修改。',
    }
  }
  return { allowed: true, status: 'ready' }
}
