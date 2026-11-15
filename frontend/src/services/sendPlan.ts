/**
 * 一次发送到底会走哪条路 —— 显示与提交的**唯一**判定来源。
 *
 * <p>为什么必须共用一份：这个项目已经出现过「界面显示『提问』、发出去却改了工程」。
 * 根因不是某一处写错，而是判定逻辑散落在多个地方各写一遍：
 * 发送路径按一套顺序判，胶囊组件按另一套（还带默认值兜底），
 * 两套一旦分叉，界面就在说谎。所以把判定抽成纯函数，
 * 发送、对话区胶囊、工作台胶囊、以及测试全部调它。</p>
 *
 * <p><strong>判定顺序（与发送路径严格一致）：</strong></p>
 * <ol>
 *   <li>草稿处于「继续调整」保护模式（{@code target_required}）却没有目标 →
 *       <strong>拦截</strong>，不发送。这不是「普通对话」，也不能猜成整片修改；</li>
 *   <li>取意图：目标快照里的优先，其次草稿级（快照是发送时固化的那份）；</li>
 *   <li>显式 {@code query} <strong>永远赢</strong> —— 它是用户最后一次主动选择，
 *       任何范围确认（含「确认整片」）都不能推翻；</li>
 *   <li>显式 {@code modify} → 修改（**没有目标快照也算修改**）；</li>
 *   <li>没有显式意图：有目标快照，或已确认整片 → 修改；</li>
 *   <li>三者都没有 → <strong>普通对话</strong>，不改工程。</li>
 * </ol>
 *
 * <p>第 6 条是最容易被误解的一条：<strong>「没有目标」不等于「按整片修改」</strong>。
 * 无目标、无意图、未确认整片时，这句话就是普通对话。</p>
 *
 * <p><strong>还有一条硬约束：修改必须真的发得出去。</strong>
 * 发起创作任务需要两件事同时成立：</p>
 * <ul>
 *   <li>会话有 {@code projectId}（后端要它）；</li>
 *   <li>会话是 {@code origin: 'server'} —— 修改分支在「服务端会话」这一侧，
 *       本地草稿走的是另一条完全不同的路径（只写本地消息 + 普通回复）。</li>
 * </ul>
 * <p>只查项目归属是不够的：服务端创建失败时会降级成 {@code origin: 'local'} 的会话，
 * 它**保留着 projectId**；左栏「重试保存」、拖拽改归属也都会产生
 * 「有项目但仍是本地草稿」的会话。这类会话显示「修改工程」同样发不出去。
 * 所以判定要的是「能否真正发起修改」，不是「有没有项目」。</p>
 */
import type { SessionDraft, TargetSnapshot } from '@/shell/useDraftStore'

/** 这次发送实际会执行的动作。`blocked` 表示不发送。 */
export type SendPlan =
  | { kind: 'chat' }
  | { kind: 'modify'; scope: 'project' | 'target'; target: TargetSnapshot | null }
  | { kind: 'blocked'; reason: 'missing_target' | 'missing_project' | 'unsaved_session' }

export interface SendPlanInput {
  targetSnapshot: TargetSnapshot | null
  /** 草稿级意图：没有显式目标时唯一来源 */
  draftIntent?: 'modify' | 'query'
  continuationScopeMode?: 'target_required' | 'whole_confirmed' | null
  /**
   * 这次发送所在会话是否已归属某个项目。
   *
   * <p>缺省视为「有项目」以兼容只关心意图的老调用点；但**凡是能真正发出请求的地方
   * 都必须传真实值** —— 否则会重现「界面说改工程、实际走了普通回复」。</p>
   */
  hasProject?: boolean
  /**
   * 会话是否已经是服务端会话（`origin: 'server'`）。
   *
   * <p>缺省视为 `true`。**本地草稿即使有 projectId 也发不出修改** ——
   * 修改分支只在服务端会话这一侧。凡是能真正发出请求的地方都必须传真实值。</p>
   */
  isServerSession?: boolean
}

/**
 * 解析这次发送的真实去向。
 *
 * <p>这是**唯一**实现。任何显示「这句话会怎样」的界面都必须调它，
 * 不允许自己再写一份判断（历史 bug 就是这么来的）。</p>
 */
export function resolveSendPlan(input: SendPlanInput): SendPlan {
  const { targetSnapshot, draftIntent, continuationScopeMode, hasProject = true, isServerSession = true } = input

  /* 1. 继续调整保护模式缺目标：拦截，不是普通对话，也不是整片修改。 */
  if (continuationScopeMode === 'target_required' && !targetSnapshot) {
    return { kind: 'blocked', reason: 'missing_target' }
  }

  /* 2. 意图：快照优先（发送时固化的那份），其次草稿级。 */
  const effectiveIntent = targetSnapshot?.intentAction ?? draftIntent

  /* 3. 显式提问永远赢。 */
  if (effectiveIntent === 'query') return { kind: 'chat' }

  /* 4/5. 显式修改，或「有目标 / 已确认整片」的隐式修改。 */
  const isWholeConfirmed = continuationScopeMode === 'whole_confirmed'
  const isModify = Boolean(effectiveIntent) || Boolean(targetSnapshot) || isWholeConfirmed
  if (!isModify) {
    /* 6. 无目标、无意图、未确认整片 → 普通对话。 */
    return { kind: 'chat' }
  }

  /* 7. 修改必须真的发得出去。
     · 没有项目归属 → 后端要 projectId，发不了；
     · 有项目但仍是本地草稿 → 修改分支在服务端会话那侧，同样发不了。
     与其让界面显示「修改工程」而实际落回普通回复，不如直接拦住并说清原因。 */
  if (!hasProject) {
    return { kind: 'blocked', reason: 'missing_project' }
  }
  if (!isServerSession) {
    return { kind: 'blocked', reason: 'unsaved_session' }
  }

  /* 范围按快照的**真实** scope 判断，不能「有快照就算 target」：
     快照本身也可能是整片工程（scope: 'project'）。 */
  const targetScope = targetSnapshot
    ? (targetSnapshot.scope === 'project' ? 'project' : 'target')
    : 'project'

  return { kind: 'modify', scope: targetScope, target: targetSnapshot }
}

/** 从会话草稿直接解析（两个界面都持有这份草稿）。 */
export function resolveSendPlanFromDraft(
  draft: SessionDraft,
  hasProject = true,
  isServerSession = true,
): SendPlan {
  return resolveSendPlan({
    targetSnapshot: draft.targetSnapshot,
    draftIntent: draft.intentAction,
    continuationScopeMode: draft.continuationScopeMode,
    hasProject,
    isServerSession,
  })
}

/** 界面文案：把判定结果翻成用户能读懂的一句话。 */
export interface SendPlanCopy {
  /** 主标签，如「普通对话」 */
  label: string
  /** 补充说明，如「不会修改工程」 */
  detail: string
  /** 语气：neutral 普通 / modify 会改工程 / blocked 无法发送 */
  tone: 'neutral' | 'modify' | 'blocked'
}

export function describeSendPlan(plan: SendPlan): SendPlanCopy {
  switch (plan.kind) {
    case 'chat':
      return { label: '普通对话', detail: '只回答问题，不会修改工程', tone: 'neutral' }
    case 'blocked':
      if (plan.reason === 'missing_target') {
        return { label: '请先确认目标', detail: '继续调整需要先选定修改目标', tone: 'blocked' }
      }
      if (plan.reason === 'unsaved_session') {
        return { label: '请先保存会话', detail: '这条会话还没保存到项目，无法发起工程修改', tone: 'blocked' }
      }
      return { label: '请先关联项目', detail: '这条会话还没有归属项目，无法发起工程修改', tone: 'blocked' }
    case 'modify':
      /* 只说「发起修改」，**不承诺一定生成新版本** ——
         任务还可能追问、失败，或最终没改动工程。
         「是否真的产生新版本」要等结果回来再讲。 */
      if (plan.scope === 'target') {
        return { label: '修改工程', detail: '将按下方目标发起工程修改', tone: 'modify' }
      }
      return { label: '修改整片工程', detail: '将发起整个项目工程的修改', tone: 'modify' }
  }
}
