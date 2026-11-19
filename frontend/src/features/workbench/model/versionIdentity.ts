/**
 * 版本身份：把「场景版本」「编辑器试片」「工作流产物」「最新可交付整片」
 * 当成**四条不同的编号序列**来对待。
 *
 * <p>为什么必须分开：它们的 `revision` 数字长得一样，但含义完全不同 ——
 * 场景版本的 4 是「第 4 次提交渲染」，编辑器试片的 2 是「第 2 次导出」，
 * 工作流产物的 3 是「该工作流第 3 次运行修订」。直接比大小会得出
 * 「试片 v2 比场景 v4 旧」这种错误结论，进而把当前工程版本标成「历史」，
 * 或者给出错误的「回到最新版本」入口。</p>
 *
 * <p>规则：**只有同一序列内的两个版本才能比较**。跨序列一律返回
 * `uncomparable`，由界面如实说明「不是同一条版本序列」，不做大小判断。</p>
 */

import type { StageVisual } from '@/features/workbench/model/stageVisual'

/** 版本序列 —— 只有同序列的 revision 才能互相比较。 */
export type VersionSeries = 'scene' | 'editor' | 'workflow'

/** 序列的可读名称，用于界面上说清「这个 vN 是什么的 vN」。 */
export const SERIES_LABEL: Record<VersionSeries, string> = {
  scene: '场景版本',
  editor: '编辑器试片',
  workflow: '工作流产物',
}

/**
 * 取一条画面的版本序列。
 *
 * <p>没有 `origin` 的老数据按工作流产物处理 —— 那是加入 scene/editor
 * 两个来源之前的唯一来源，按它归类最接近事实。</p>
 */
export function versionSeriesOf(visual: StageVisual | null | undefined): VersionSeries | null {
  if (!visual) return null
  if (visual.origin === 'scene') return 'scene'
  if (visual.origin === 'editor') return 'editor'
  return 'workflow'
}

/** 两个版本的关系。`uncomparable` 表示不在同一序列，不能比较大小。 */
export type VersionRelation = 'same' | 'older' | 'newer' | 'uncomparable'

/**
 * 一条画面所属的**具体**版本序列身份。
 *
 * <p>光看 `origin` 不够 —— 同一个 origin 内部还有互不相干的编号序列：</p>
 * <ul>
 *   <li><b>scene</b>：全项目共用一条序列（场景版本号由后端递增）。</li>
 *   <li><b>editor</b>：revision 是「该场景文档第几次导出」，
 *       由 {@code old.filter(r => r.sceneId === doc.id).length + 1} 算出 ——
 *       **每个场景文档各自从 1 开始计数**。两个不同文档的「导出 2」毫无关系。</li>
 *   <li><b>workflow</b>：revision 是该工作流自己的修订号，
 *       两个不同工作流的「修订 3」同样没有可比性。</li>
 * </ul>
 *
 * <p>所以序列身份要带上「哪一条」：scene 用项目级常量，editor 用场景 id
 * （`StageVisual.artifactId` 存的就是 sceneId），workflow 用 workflowId。
 * 取不到区分依据时返回 null —— 调用方据此判为不可比较，**不猜**。</p>
 *
 * @param visual 画面
 * @returns 序列身份键；无法确定时返回 null
 */
export function versionSeriesKey(visual: StageVisual | null | undefined): string | null {
  const series = versionSeriesOf(visual)
  if (!visual || !series) return null
  if (series === 'scene') {
    /* 场景版本是项目级单序列 —— 同一项目内可比 */
    return 'scene'
  }
  if (series === 'editor') {
    /* 按场景文档分别编号：artifactId 就是 sceneId。
       拿不到就返回 null（不可比较），不要退化成「所有试片同一序列」。 */
    const sceneId = visual.artifactId?.trim()
    return sceneId ? `editor:${sceneId}` : null
  }
  /* workflow：按 workflowId 分开。空 workflowId 说明这条产物没有可确认的
     工作流归属（演示/历史数据），同样不猜。 */
  const wfId = visual.workflowId?.trim()
  return wfId ? `workflow:${wfId}` : null
}

/**
 * 判断「正在看的这一版」相对「基准版」是什么关系。
 *
 * <p>只有在**同一具体序列**内才比较 revision —— 同 origin 但不同场景文档
 * 或不同工作流时返回 `uncomparable`。</p>
 *
 * @param viewed 当前预览
 * @param lead 基准版（最新可交付整片 / 当前工程版本，由调用方决定语义）
 * @returns 关系；任一侧缺失、跨序列或序列身份不可确认时返回 `uncomparable`
 */
export function versionRelation(
  viewed: StageVisual | null | undefined,
  lead: StageVisual | null | undefined,
): VersionRelation {
  if (!viewed || !lead) return 'uncomparable'
  /* 同一条画面（id 相同）就是同一版，无需比较序列。
     必须先确认 id 是非空字符串：两条都没有 id 时 `undefined === undefined`
     会成立，把它们误判成「同一版」—— 那是把「都不知道」当成「相同」。 */
  if (typeof viewed.id === 'string' && viewed.id !== ''
      && typeof lead.id === 'string' && lead.id !== ''
      && viewed.id === lead.id) {
    return 'same'
  }

  const a = versionSeriesKey(viewed)
  const b = versionSeriesKey(lead)
  /* 序列身份拿不到（例如试片缺 sceneId、产物缺 workflowId）→ 不可比较 */
  if (!a || !b || a !== b) return 'uncomparable'

  if (typeof viewed.revision !== 'number' || typeof lead.revision !== 'number') {
    return 'uncomparable'
  }
  if (viewed.revision === lead.revision) return 'same'
  return viewed.revision < lead.revision ? 'older' : 'newer'
}

/**
 * 这条画面是否应被标成「历史版本」。
 *
 * <p>判据必须同时满足：同一条版本序列、且确实比基准旧。
 * 跨序列时**不标** —— 试片的第 2 次导出不是「比场景 v4 旧的历史版本」。</p>
 *
 * @param viewed 当前预览
 * @param lead 基准版
 */
export function isHistoricalAgainst(
  viewed: StageVisual | null | undefined,
  lead: StageVisual | null | undefined,
): boolean {
  return versionRelation(viewed, lead) === 'older'
}

/**
 * 顶部胶囊该显示什么版本号。
 *
 * <p>场景版本直接写 `vN`（那是项目版本）；试片与工作流产物要带上来源，
 * 写成「试片 vN」「工作流 vN」，否则用户会把它当成项目版本号。</p>
 *
 * @param viewed 当前预览
 * @returns 展示文案；没有画面时返回「无版本」
 */
export function versionBadgeLabel(viewed: StageVisual | null | undefined): string {
  if (!viewed) return '无版本'
  const series = versionSeriesOf(viewed)
  if (series === 'scene') return `v${viewed.revision}`
  const label = series ? SERIES_LABEL[series] : '产物'
  return `${label} v${viewed.revision}`
}

/**
 * 版本清单里一项的版本号标签。
 *
 * <p>与 {@link versionBadgeLabel} 同源，保证顶部与清单口径一致。</p>
 */
export function versionItemLabel(visual: StageVisual): string {
  return versionBadgeLabel(visual)
}

/* ── 工程版本 vs 最新可下载画面 ──────────────────────────────── */

/**
 * 当前工程版本号的来源。
 *
 * <p>「工程改到第几版」和「哪一版能下载」是两件事，混成一个数字会误导：
 * 工程可能已经到 v17，但 v17 还没渲出片，能下载的最新画面仍是 v16。
 * 所以版本号要带上**它是怎么知道的**，界面才能说清可信度。</p>
 */
export type ProjectVersionSource =
  /** 后端明确返回的当前场景版本 —— 权威 */
  | 'backend'
  /** 从「有产物文件的场景版本」里取最大值 —— 只是已知画面中最高，不能证明工程没更新 */
  | 'visuals'
  /** 都拿不到 */
  | 'unknown'

/** 当前工程版本。 */
export interface ProjectVersionInfo {
  version: number | null
  source: ProjectVersionSource
  /**
   * 这个版本号是否可作为「当前工程版本」对外断言。
   *
   * <p>只有 backend 来源才成立。visuals 来源只能说明「已知画面里最高的是它」，
   * 界面不得据此无条件标「最新工程」。</p>
   */
  authoritative: boolean
}

/**
 * 汇总当前工程版本。
 *
 * @param backendVersion 后端返回的当前场景版本；取不到传 null/undefined
 * @param visuals 画面列表（用于在后端不可用时给出保守估计）
 */
export function resolveProjectVersion(
  backendVersion: number | null | undefined,
  visuals: Array<{ origin?: string; revision: number }>,
): ProjectVersionInfo {
  if (typeof backendVersion === 'number' && Number.isFinite(backendVersion)) {
    return { version: backendVersion, source: 'backend', authoritative: true }
  }
  const scenes = visuals.filter((v) => v.origin === 'scene')
  if (!scenes.length) return { version: null, source: 'unknown', authoritative: false }
  const max = scenes.reduce((best, cur) => (cur.revision > best.revision ? cur : best)).revision
  /* 来源标成 visuals：数字可用，但**不能**当作权威工程版本对外断言 */
  return { version: max, source: 'visuals', authoritative: false }
}

/**
 * 版本跳转目标的性质。
 *
 * <p>同一个「跳到 v16」的动作，在权威与非权威两种情况下含义不同：
 * 前者是「回到当前工程版本」，后者只能说「查看已知最新画面」——
 * 因为那个数字只是「画面列表里最高」，不能证明工程没有更新。</p>
 */
export type VersionJumpKind =
  /** 跳到当前工程版本（后端确认过，权威） */
  | 'project_version'
  /** 跳到已知画面中版本最高的一条（版本号未经后端确认） */
  | 'known_latest'

/** 「跳到某个版本」的可用目标。 */
export interface VersionJumpTarget<T> {
  visual: T
  kind: VersionJumpKind
}

/**
 * 「回到最新版本」该跳到哪一条画面 —— **带可信度**。
 *
 * <p>规则：</p>
 * <ul>
 *   <li>后端确认过工程版本 → 只跳到该版本对应的场景画面，
 *       命名为「回到当前工程版本」。找不到画面时返回 null（说明尚无对应画面）。</li>
 *   <li>后端读不到、只有画面列表 → 只能提供「查看已知最新画面」，
 *       kind 标为 `known_latest`。**不得**命名为「回到当前工程版本」，
 *       也不得用它断言历史/最新。</li>
 * </ul>
 *
 * <p>两种情况下都不跳 `deliverableLead`：它可能是工作流产物（另一条序列），
 * 也可能在「工程 v17、可下载画面仍是 v16」时把用户带到仍是历史的 v16。</p>
 *
 * @param projectVersion 当前工程版本信息
 * @param visuals 画面列表
 * @returns 跳转目标；无从跳转时返回 null
 */
export function resolveVersionJumpTarget<T extends { origin?: string; revision: number }>(
  projectVersion: ProjectVersionInfo,
  visuals: T[],
): VersionJumpTarget<T> | null {
  if (projectVersion.version === null) return null
  const same = visuals.find(
    (v) => v.origin === 'scene' && v.revision === projectVersion.version,
  )
  if (!same) return null
  /* 权威 → 可以叫「当前工程版本」；非权威 → 只能说「已知最新画面」 */
  return {
    visual: same,
    kind: projectVersion.authoritative ? 'project_version' : 'known_latest',
  }
}

/**
 * 「回到最新版本」该跳到哪一条画面（仅取画面，不带可信度）。
 *
 * <p>保留它是为了兼容只关心目标的调用方；需要区分命名语义时
 * 请用 {@link resolveVersionJumpTarget}。</p>
 *
 * @param projectVersion 当前工程版本信息
 * @param visuals 画面列表
 * @returns 应跳转的画面；没有对应画面时返回 null
 */
export function findProjectVersionVisual<T extends { origin?: string; revision: number }>(
  projectVersion: ProjectVersionInfo,
  visuals: T[],
): T | null {
  return resolveVersionJumpTarget(projectVersion, visuals)?.visual ?? null
}

/**
 * 「正在查看的这一版」相对当前工程版本的状态 —— **带可信度**。
 *
 * <p>关键区别：后端版本读不到时，「比列表最大值旧」只能说明
 * 「有更新的画面存在」，**不能**断言「这是历史版本、修改将基于最新工程 vN」。
 * 所以非权威时降级成 `older_than_known`，界面文案也要相应改变。</p>
 */
export type VersionStanding =
  /** 与当前工程版本相同 */
  | 'current'
  /** 确认比当前工程版本旧（后端权威） */
  | 'historical'
  /** 比「已知画面中最高的一版」旧，但工程版本未确认 */
  | 'older_than_known'
  /** 比基准新 */
  | 'newer'
  /**
   * **场景画面，但工程版本完全读不到** —— 无从比较。
   *
   * <p>必须与 `not_applicable` 分开：那个是「非场景画面」（试片/工作流产物，
   * 由其它能力检查管）。场景画面缺基准是另一回事 —— 不能声称它可修改。</p>
   */
  | 'unknown_baseline'
  /** 不适用（非场景画面 / 无画面） */
  | 'not_applicable'

/**
 * 判定当前预览相对工程版本的状态。
 *
 * @param viewed 当前预览
 * @param projectVersion 当前工程版本信息
 */
export function versionStanding(
  viewed: { origin?: string; revision: number } | null | undefined,
  projectVersion: ProjectVersionInfo,
): VersionStanding {
  if (!viewed || viewed.origin !== 'scene') return 'not_applicable'
  if (typeof viewed.revision !== 'number') return 'not_applicable'
  /* 场景画面但没有工程版本基准 → 单独一类，不能混进 not_applicable（那会被放行） */
  if (projectVersion.version === null) return 'unknown_baseline'
  if (viewed.revision === projectVersion.version) return 'current'
  if (viewed.revision > projectVersion.version) return 'newer'
  /* 更旧：只有权威时才敢说「历史版本」 */
  return projectVersion.authoritative ? 'historical' : 'older_than_known'
}

/**
 * 「这一版能不能作为修改基准」的结论 —— **带原因**，不只是一个布尔。
 *
 * <p>为什么不能只传布尔：能力评估器收到 `isHistorical: true` 只能按
 * 「历史版本」给理由，可实际上有两种完全不同的情况：</p>
 * <ul>
 *   <li>确认是历史版本 → 应提示「历史画面仅供审阅，请先恢复或继续调整」；</li>
 *   <li>工程版本未确认 → 应提示「无法确认这是当前工程版本，请稍后重试」。</li>
 * </ul>
 *
 * <p>两者都「不可直接修改」，但用户该做的事完全不同。所以把状态本身传下去。</p>
 */
export type ModifyBlockReason =
  /** 可以直接修改 */
  | 'ok'
  /** 确认是历史版本 */
  | 'historical'
  /** 工程版本未能确认（只知道有更新的画面，或根本读不到） */
  | 'unconfirmed'

/**
 * 由版本状态推导「能否作为修改基准」。
 *
 * <p><b>为什么需要 projectVersion 参数</b>：`current` 只表示
 * 「与基准版本号相同」，并不代表基准可信。后端版本读不到时，
 * `current` 的含义只是「等于已知画面里最高的一版」——
 * 此时若返回 `ok`，界面会先显示「可修改」，提交后才被别的校验拒绝，
 * 用户看到的是前后矛盾。所以非权威的 `current` 也要归入 `unconfirmed`。</p>
 *
 * <p>`not_applicable` 分两种：非场景画面（试片/工作流产物）由其它能力检查管，
 * 这里不拦；工程版本完全没有时同样不在这里拦（无从比较），
 * 由提交时的后端校验兜底。</p>
 *
 * @param standing {@link versionStanding} 的结果
 * @param projectVersion 当前工程版本信息（用于判断基准是否可信）
 */
export function modifyBlockReason(
  standing: VersionStanding,
  projectVersion?: ProjectVersionInfo | null,
): ModifyBlockReason {
  if (standing === 'historical') return 'historical'
  if (standing === 'older_than_known') return 'unconfirmed'
  if (standing === 'current') {
    /* 版本号相同还不够 —— 基准必须**可信**才能声称「这是当前工程版本」 */
    return projectVersion?.authoritative === true ? 'ok' : 'unconfirmed'
  }
  if (standing === 'newer') {
    /* 比基准还新：数据不一致，不能当作可修改 */
    return 'unconfirmed'
  }
  if (standing === 'unknown_baseline') {
    /* 场景画面但工程版本读不到：无从确认基准，不能先声称可修改 */
    return 'unconfirmed'
  }
  /* not_applicable：非场景画面（试片/工作流产物），由其它能力检查管 */
  return 'ok'
}

/**
 * 不可修改时给用户看的理由文案。
 *
 * @param reason 不可修改的原因
 * @returns 文案；`ok` 时返回 null
 */
export function modifyBlockNotice(reason: ModifyBlockReason): string | null {
  if (reason === 'historical') {
    return '当前查看的是历史版本，历史画面仅供审阅与对比。如需在此基础上修改，请使用【继续调整】或先恢复到该版本'
  }
  if (reason === 'unconfirmed') {
    return '无法确认当前画面就是工程的当前版本（工程版本未能读取或已更新）。为避免基于错误基准修改，请稍后重试或重新选择画面'
  }
  return null
}
