import React, { useState } from 'react'
import { UiIcon, SemIcons } from '@/components/icons/UiIcon'
import { Link04, HelpCircle, Star01, Target01 } from '@untitledui/icons'
import type { TargetSnapshot } from '@/shell/useDraftStore'
import { resolveSendPlan, describeSendPlan } from '@/services/sendPlan'

export interface TargetSummaryPillProps {
  /** 目标版本号 */
  version?: string | number | null
  /**
   * 目标版本属于哪条序列（场景版本 / 编辑器试片 / 工作流产物）。
   *
   * <p>跨序列比大小是错的：试片第 2 次导出与场景 v4 不是同一套编号。
   * 没有它就只能降级 —— 不比较、不报「历史」。</p>
   */
  versionSeries?: 'scene' | 'editor' | 'workflow' | null
  /**
   * 当前工程版本号（**只有可信时才传**）。
   *
   * <p>后端版本读不到时不要传数字，改传 `versionUnconfirmed`——
   * 否则会拿「已知画面最高」去断言「基准工程已更新至 vN」。</p>
   */
  stageLeadVersion?: number | null
  /**
   * 工程版本是否**未能确认**。
   *
   * <p>为真时：目标版本与工程版本的比较不成立，界面只能说
   * 「工程版本未确认」，不能说「已过期」或「已推进至 vN」。</p>
   */
  versionUnconfirmed?: boolean
  /** 作用范围 */
  scope?: 'project' | 'scene' | 'selection'
  /** 目标引用（包含时间/区域） */
  targetSnapshot?: TargetSnapshot | null
  /** 时间段选区 */
  rangeSpan?: { start: number; end: number } | null
  /** 关联素材引用 */
  references?: Array<{ id: string; role: string; label?: string; [key: string]: any }>
  /** 切到最新工程画面核对重新选择 */
  onViewLead?: () => void
  /** 恢复工程至此历史版本 */
  onRestoreVersion?: (version: number) => void
  /** 显式移除目标（转为全局修改/普通对话） */
  onRemoveTarget?: () => void
  /** 清理时间段选区 */
  onClearRange?: () => void
  /** 重置作用范围 */
  onResetScope?: () => void
  /** 意图切换：修改视频 或 关于此提问 */
  onIntentChange?: (intent: 'modify' | 'query') => void
  /** 草稿级的意图：没有 targetSnapshot 时也能记住「这句是提问还是修改」 */
  draftIntent?: 'modify' | 'query'
  /** 续改保护模式：target_required（缺目标须拦截）/ whole_confirmed（已确认整片） */
  continuationScopeMode?: 'target_required' | 'whole_confirmed' | null
  /** 当前会话是否已归属项目：没有项目时改不了工程，要如实拦下 */
  hasProject?: boolean
  /** 会话是否已保存到服务端：本地草稿即使有项目也发不出修改 */
  isServerSession?: boolean
  /** 界面模式：紧凑（工作台窄栏）或标准（对话区居中） */
  layoutMode?: 'compact' | 'normal'
}

function fmtClock(seconds: number | undefined): string {
  if (seconds === undefined || isNaN(seconds)) return '00:00'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  const ms = Math.floor((seconds % 1) * 1000)
  if (ms > 0) {
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0').slice(0, 2)}`
  }
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export function TargetSummaryPill({
  version,
  versionSeries,
  stageLeadVersion,
  versionUnconfirmed = false,
  scope = 'project',
  targetSnapshot,
  rangeSpan,
  references = [],
  onViewLead,
  onRestoreVersion,
  onRemoveTarget,
  onClearRange,
  onResetScope,
  onIntentChange,
  draftIntent,
  continuationScopeMode,
  hasProject = true,
  isServerSession = true,
  layoutMode = 'compact',
}: TargetSummaryPillProps) {
  const [expanded, setExpanded] = useState(false)
  const [confirmRemoveGlobal, setConfirmRemoveGlobal] = useState(false)

  /* 意图与去向一律来自共享判定（{@link resolveSendPlan}），本组件不再自己算。
     历史 bug 就出在这里：组件默认 `?? 'modify'`，于是「没有目标、没有意图」
     的普通对话被显示成「修改全局工程」，而实际发送走的是普通对话 ——
     界面在说谎。现在显示什么、发出去是什么，是同一个函数的同一个结果。 */
  const plan = resolveSendPlan({
    targetSnapshot: targetSnapshot ?? null,
    draftIntent,
    continuationScopeMode,
    hasProject,
    isServerSession,
  })
  const planCopy = describeSendPlan(plan)
  /* 按钮高亮必须反映**用户实际的选择**，不能拿判定结果反推：
     blocked 状态下判定既不是 chat 也不是 modify，若映射成「提问」，
     用户会以为自己选的是提问，而他其实选的是修改 —— 只是缺条件发不出去。

     但**没有显式选择时也不能默认高亮「修改」**：那种状态的发送计划是普通对话，
     高亮修改会让用户以为自己在改工程。所以三态：明确修改 / 明确提问 / 未选择。 */
  const explicitIntent = targetSnapshot?.intentAction ?? draftIntent
  const selectedIntent: 'modify' | 'query' | null = explicitIntent ?? null

  // 综合从 targetSnapshot 或独立 props 获取有效数据
  const effectiveVersion = targetSnapshot?.version ?? (version !== undefined && version !== null ? Number(version) : null)
  /**
   * 版本来源以**快照自己记的**为准。
   *
   * <p>为什么不能直接用调用方传的 `versionSeries`：那是「当前预览」的来源。
   * 用户可以先固化目标、再切换预览 —— 那时快照里的版本号与当前预览已不是同一画面。
   * 用新预览的来源去解释旧快照的数字，就会把试片导出次数当成场景版本参与比较。</p>
   *
   * <p>旧快照没有 `versionSeries` → 来源不明，**降级**：不比较、不断言。
   * 只有完全没有快照时，才退回调用方传的来源（那对应「当前画面」语义）。</p>
   */
  const effectiveSeries: 'scene' | 'editor' | 'workflow' | null = targetSnapshot
    ? (targetSnapshot.versionSeries ?? null)
    : (versionSeries ?? null)
  /**
   * 快照写入时版本是否已确认。旧快照没有该字段 → 视为未确认（保守）。
   * 没有快照时用调用方传的 `versionUnconfirmed`。
   */
  const effectiveConfirmed = targetSnapshot
    ? (targetSnapshot.versionConfirmed === true)
    : !versionUnconfirmed
  const effectiveRange = targetSnapshot?.rangeSpan ?? rangeSpan
  const effectiveScope = targetSnapshot?.scope ?? scope
  const hasBbox = Boolean(targetSnapshot?.bbox)
  const hasVersion = effectiveVersion !== null && effectiveVersion !== undefined
  /* 历史判断必须同时满足：
     1. 目标版本属于**场景序列**（跨序列不能比大小）；
     2. 工程版本**可信**（未确认时不做断言）。
     两者缺一就降级：不标「已过期历史」，也不说「已推进至 vN」。 */
  const canCompareWithProject = Boolean(
    hasVersion &&
      effectiveSeries === 'scene' &&
      effectiveConfirmed &&
      !versionUnconfirmed &&
      stageLeadVersion !== null && stageLeadVersion !== undefined,
  )
  const isHistorical = canCompareWithProject && Number(effectiveVersion) < Number(stageLeadVersion)

  const parts: string[] = []
  if (isHistorical) {
    parts.push(`已过期历史 v${effectiveVersion}`)
  } else if (hasVersion) {
    /* 有版本但工程版本未确认：如实说「版本待确认」，不暗示它是最新或历史 */
    if (effectiveSeries === 'scene') {
      /* 场景版本：写入时未确认或当前工程版本未确认，都要如实标出 */
      if (!effectiveConfirmed || versionUnconfirmed) parts.push(`v${effectiveVersion} · 工程版本未确认`)
      else parts.push(`v${effectiveVersion}`)
    } else if (effectiveSeries) {
      /* 试片/工作流产物的版本号要带来源，避免被当成项目版本号 */
      const label = effectiveSeries === 'editor' ? '试片' : '工作流'
      parts.push(`${label} v${effectiveVersion}`)
    } else {
      /* 来源不明（旧快照）：不声称它是场景版本 */
      parts.push(`v${effectiveVersion} · 来源未记录`)
    }
  }

  /* 拦截态：直接说清「先确认目标 / 先关联项目」。
     不能落到下面的「全局工程」分支 —— 那会让人以为这次要改整个工程，
     而实际上这条消息根本发不出去。 */
  if (plan.kind === 'blocked') {
    parts.push(planCopy.label)
  } else if (plan.kind === 'chat') {
    /* 普通对话没有目标可讲：不要退回去显示「全局工程」——
       那会被读成「这次要改整个工程」。 */
    if (effectiveRange) parts.push(`${fmtClock(effectiveRange.start)}–${fmtClock(effectiveRange.end)}`)
    if (hasBbox) parts.push('画面区域')
  } else if (effectiveRange) {
    parts.push(`${fmtClock(effectiveRange.start)}–${fmtClock(effectiveRange.end)}`)
  } else if (effectiveScope === 'project') {
    parts.push(
      hasVersion
        ? (isHistorical
            ? `基准工程已更新至 v${stageLeadVersion}`
            : (effectiveSeries === 'scene' && (!effectiveConfirmed || versionUnconfirmed)
                ? '全局工程 · 版本待确认'
                : (targetSnapshot && !effectiveSeries ? '全局工程 · 来源未记录' : '全局工程')))
        : '全局工程 · 尚无版本',
    )
  } else {
    parts.push('当前画面')
  }

  if (hasBbox) {
    parts.push('画面区域')
  }

  const extraRefs = (targetSnapshot?.references ?? references).filter((r) => r.role === 'context')
  if (extraRefs.length > 0) {
    parts.push(`${extraRefs.length}个素材`)
  }

  /* 普通对话没有目标可描述：直接说清「这次不改工程」，
     不能留一个空胶囊 —— 空白会被读成「目标信息缺失」。 */
  if (parts.length === 0) parts.push(planCopy.label)

  const summary = parts.join(' · ')

  /* 移除目标之后会变成什么，要按**真实判定**说，不能一律承诺「转为全片修改」：
     用户若已选「关于此提问」，移除目标后其实是普通对话（不改工程）。
     说成「转为全片修改」会让人以为移除反而触发了修改。 */
  /* 移除只清快照（见 onRemoveTarget），草稿级意图会**保留**；
     之后的发送判定读的就是草稿级那份。所以这里必须按「移除后真实留下的意图」算，
     不能优先沿用快照里的意图 —— 两者不同时，提示会和实际结果不一致。 */
  const afterRemove = resolveSendPlan({
    targetSnapshot: null,
    draftIntent,
    continuationScopeMode,
    hasProject,
    isServerSession,
  })
  const afterRemoveCopy = describeSendPlan(afterRemove)
  const removeHint = afterRemove.kind === 'modify'
    ? (afterRemove.scope === 'project' ? '移除目标引用（转为整片工程修改）' : '移除目标引用')
    : afterRemove.kind === 'chat'
      ? '移除目标引用（移除后为普通对话，不改工程）'
      : `移除目标引用（移除后${afterRemoveCopy.label}）`
  const isCustomized = Boolean(effectiveRange || hasBbox || effectiveScope !== 'project' || isHistorical)

  const handleRemoveClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    // 带有明确选区或为过期历史目标时，点击移除触发明确提示：将转为全片/全局修改
    if (isCustomized) {
      if (!confirmRemoveGlobal) {
        setConfirmRemoveGlobal(true)
        return
      }
    }
    setConfirmRemoveGlobal(false)
    if (onRemoveTarget) {
      onRemoveTarget()
    } else {
      onClearRange?.()
      onResetScope?.()
    }
  }

  return (
    <div className={`wb-target-pill-wrap mb-1.5 flex flex-col items-start w-full ${layoutMode === 'normal' ? 'max-w-2xl mx-auto' : ''}`}>
      <div className="flex flex-wrap items-center gap-1.5 max-w-full">
        {/* 目标胶囊主体 */}
        <div
          className={`wb-target-pill inline-flex items-center gap-1.5 max-w-full text-xs px-2.5 py-1 rounded-full border transition-all ${
            isHistorical
              ? 'bg-amber-500/10 border-amber-500/40 text-amber-300'
              : 'bg-[var(--hole,#edf0ee)] dark:bg-[#1f2127] border-[var(--line,#e0e5e2)] dark:border-[#2d3039] text-[var(--tx2,#66716c)] dark:text-[#a0a5b2] hover:border-[var(--line2,#c4ccc7)]'
          }`}
        >
          <button
            type="button"
            className="inline-flex items-center gap-1.5 min-w-0 text-left cursor-pointer"
            onClick={() => setExpanded((v) => !v)}
            title="点击展开/收起修改目标详情与过期核对"
          >
            {isHistorical ? (
              <UiIcon icon={SemIcons.warning} size="xs" className="text-amber-400 shrink-0 animate-pulse" />
            ) : (
              <UiIcon icon={Target01} size="xs" className="text-emerald-500 shrink-0" />
            )}
            <span className="truncate font-medium text-[var(--tx,#242a28)] dark:text-[#ededed] text-[11px] max-w-[240px]">
              {summary}
            </span>
            <UiIcon icon={SemIcons.collapse} size="xs" className={`text-[var(--tx3,#8f9b95)] shrink-0 transition-transform ${expanded ? 'rotate-180' : ''} `} />
          </button>

          {isCustomized && (
            <div className="inline-flex items-center gap-1 shrink-0 ml-0.5">
              {confirmRemoveGlobal ? (
                <span className="inline-flex items-center gap-1 text-[10px] text-amber-500 bg-amber-500/10 px-1.5 py-0.5 rounded">
                  {afterRemove.kind === 'modify' ? '确认转为全片？' : '确认移除目标？'}
                  <button
                    type="button"
                    className="font-semibold text-red-500 hover:underline cursor-pointer"
                    onClick={handleRemoveClick}
                  >
                    确认
                  </button>
                  <button
                    type="button"
                    className="text-[var(--tx3,#8f9b95)] hover:underline cursor-pointer ml-1"
                    onClick={(e) => { e.stopPropagation(); setConfirmRemoveGlobal(false) }}
                  >
                    取消
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  className="text-[10px] text-[var(--tx3,#8f9b95)] hover:text-red-500 p-0.5 shrink-0 transition-colors cursor-pointer"
                  title={removeHint}
                  onClick={handleRemoveClick}
                >
                  <UiIcon icon={SemIcons.close} size="xs" />
                </button>
              )}
            </div>
          )}
        </div>

        {/* 意图切换器：修改视频 vs 提问咨询。
            两个按钮用 radiogroup 语义：它们是同一件事的两个互斥选项，
            选中态必须能被读屏和键盘用户识别 —— 只靠颜色高亮，
            看不到颜色的人无法知道这句话发出去会不会改工程。 */}
        {onIntentChange && (
          <div role="radiogroup" aria-label="这条消息的作用" className="inline-flex items-center p-0.5 rounded-full border border-[var(--line,#e0e5e2)] dark:border-[#2d3039] bg-[var(--hole,#edf0ee)] dark:bg-[#1f2127] text-[10px]">
            <button
              type="button"
              role="radio"
              aria-checked={selectedIntent === 'modify'}
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full transition-colors cursor-pointer font-medium ${
                selectedIntent === 'modify'
                  ? 'bg-amber-500/20 text-amber-400 font-semibold'
                  : 'text-[var(--tx3,#8f9b95)] hover:text-[var(--tx,#242a28)] dark:hover:text-[#dedede]'
              }`}
              onClick={() => onIntentChange('modify')}
              title="发送时会真实修改视频工程"
            >
              <UiIcon icon={Star01} size="xs" />
              <span>修改此目标</span>
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={selectedIntent === 'query'}
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full transition-colors cursor-pointer font-medium ${
                selectedIntent === 'query'
                  ? 'bg-blue-500/20 text-blue-400 font-semibold'
                  : 'text-[var(--tx3,#8f9b95)] hover:text-[var(--tx,#242a28)] dark:hover:text-[#dedede]'
              }`}
              onClick={() => onIntentChange('query')}
              title="只在对话里回答，不修改视频工程"
            >
              <UiIcon icon={HelpCircle} size="xs" />
              <span>关于此提问</span>
            </button>
          </div>
        )}
        {/* 未显式选择时两个按钮都不高亮 —— 光看按钮不知道「现在会怎样」。
            用一句话把当前真实去向补上，避免用户以为默认就是改工程。
            左侧胶囊已经写着同一个去向（例如「普通对话」）时不再重复。 */}
        {onIntentChange && selectedIntent === null && summary !== planCopy.label && (
          <span className="text-[10px] text-[var(--tx3,#8f9b95)] shrink-0">
            未选择：{planCopy.label === '普通对话' ? '按普通对话发送' : planCopy.label}
          </span>
        )}
      </div>

      {expanded && (
        <div className="wb-target-details w-full p-2.5 mt-1 rounded-xl bg-[var(--hole,#edf0ee)] dark:bg-[#1c1d22] border border-[var(--line,#e0e5e2)] dark:border-[#2e313b] text-xs flex flex-col gap-2 shadow-sm">
          {isHistorical ? (
            <div className="p-2 rounded-lg bg-amber-500/10 border border-amber-500/25 flex flex-col gap-1.5">
              <div className="flex items-center gap-1.5 text-amber-400 font-medium text-[11px]">
                <UiIcon icon={SemIcons.warning} size="xs" className="shrink-0" />
                目标引用的基准版本已过期
              </div>
              <p className="text-[11px] text-[var(--tx2,#66716c)] dark:text-[#a7abb5] leading-relaxed">
                当前草稿基于历史版本 <span className="font-semibold text-amber-300">v{effectiveVersion}</span>，但最新工程已推进至 <span className="font-semibold text-blue-400">v{stageLeadVersion ?? '最新'}</span>。新版本时间轴与画面可能已变动，不可直接套用。
              </p>
              <div className="mt-1 flex flex-wrap items-center gap-2 pt-1.5 border-t border-amber-500/20">
                {onViewLead && (
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 text-[11px] px-2.5 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white font-medium transition-colors cursor-pointer"
                    onClick={() => {
                      onViewLead()
                      setExpanded(false)
                    }}
                  >
                    <UiIcon icon={Link04} size="xs" /> 查看最新版画面重新选择
                  </button>
                )}
                <button
                  type="button"
                  className="text-[11px] px-2 py-1 rounded bg-[var(--hole,#edf0ee)] dark:bg-[#252830] text-amber-400 hover:text-amber-300 border border-amber-500/30 transition-colors cursor-pointer"
                  onClick={handleRemoveClick}
                >
                  {removeHint}
                </button>
                {onRestoreVersion && effectiveVersion !== null && (
                  <button
                    type="button"
                    className="text-[11px] px-2 py-1 rounded text-[var(--tx2,#66716c)] hover:text-white transition-colors cursor-pointer ml-auto"
                    onClick={() => onRestoreVersion(Number(effectiveVersion))}
                  >
                    恢复工程到 v{effectiveVersion}
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-[var(--tx3,#8f9b95)]">基准工程版本</span>
              <span className="font-medium text-[var(--tx,#242a28)] dark:text-[#ededed]">
                {hasVersion ? `v${effectiveVersion}（当前基准）` : '尚未生成版本'}
              </span>
            </div>
          )}

          <div className="flex items-center justify-between text-[11px]">
            <span className="text-[var(--tx3,#8f9b95)]">发送预期动作</span>
            <span className={`font-semibold ${
              planCopy.tone === 'modify' ? 'text-amber-400'
                : planCopy.tone === 'blocked' ? 'text-red-400'
                  : 'text-blue-400'
            }`}>
              {planCopy.label} —— {planCopy.detail}
            </span>
          </div>

          {/* 普通对话没有「修改范围」可言：这里若仍写「全片修改（作用于整个项目工程）」，
              就会和上面那句「不会修改工程」直接打架。没有范围就如实说不涉及。 */}
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-[var(--tx3,#8f9b95)]">
              {plan.kind === 'modify' ? '目标范围与时间' : '引用范围'}
            </span>
            <span className="font-medium text-[var(--tx,#242a28)] dark:text-[#ededed]">
              {plan.kind !== 'modify'
                ? (effectiveRange || hasBbox ? '仅作为提问参考，不产生修改' : '不涉及修改范围')
                : effectiveRange
                  ? `${fmtClock(effectiveRange.start)} – ${fmtClock(effectiveRange.end)}`
                  : effectiveScope === 'project'
                    ? '全片修改（作用于整个项目工程）'
                    : '当前画面'}
            </span>
          </div>

          {hasBbox && (
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-[var(--tx3,#8f9b95)]">画面选区</span>
              <span className="font-medium text-emerald-400">已框选局部画面区域</span>
            </div>
          )}

          <div className="pt-1.5 border-t border-[var(--line,#e0e5e2)] dark:border-[#2b2d35] flex items-center justify-between text-[10px] text-[var(--tx3,#8f9b95)]">
            <span>当前模式：{plan.kind !== 'modify' ? '仅提问' : effectiveRange || hasBbox ? '精确片段' : '全片宏观'}</span>
            <button
              type="button"
              className="hover:text-red-500 transition-colors cursor-pointer"
              onClick={handleRemoveClick}
            >
              清空目标
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
