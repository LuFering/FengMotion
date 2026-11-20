import React, { useEffect, useRef, useState } from 'react'
import { UiIcon, SemIcons } from '@/shared/icons/UiIcon'
import { Link04, Target01 } from '@untitledui/icons'
import '@/features/chat/styles/components/target-pill.css'
import type { TargetSnapshot } from '@/features/chat/hooks/useDraftStore'
import { resolveSendPlan, describeSendPlan } from '@/features/chat/model/sendPlan'

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
  const wrapRef = useRef<HTMLDivElement>(null)
  /* 详情是浮层：点到外面或按 Esc 就收起，不会一直挡在输入框上 */
  useEffect(() => {
    if (!expanded) return
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setExpanded(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setExpanded(false) }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [expanded])

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

  const intentOptions: { value: 'modify' | 'query'; label: string; title: string }[] = [
    { value: 'modify', label: '修改工程', title: '发送时会真实修改视频工程' },
    { value: 'query', label: '只提问', title: '只在对话里回答，不修改视频工程' },
  ]
  const toneOf = planCopy.tone === 'modify' ? 'modify' : planCopy.tone === 'blocked' ? 'blocked' : 'neutral'
  const rangeText = plan.kind !== 'modify'
    ? (effectiveRange || hasBbox ? '仅作为提问参考，不产生修改' : '不涉及修改范围')
    : effectiveRange
      ? `${fmtClock(effectiveRange.start)} – ${fmtClock(effectiveRange.end)}`
      : effectiveScope === 'project'
        ? '整片工程'
        : '当前画面'

  return (
    <div className={`wb-target-pill-wrap tp${layoutMode === 'normal' ? ' tp--normal' : ''}`} ref={wrapRef}>
      <div className="tp-bar">
        {/* 目标胶囊：写清这次发送的去向；点开看基准版本与范围 */}
        <div className="wb-target-pill tp-target" data-historical={isHistorical || undefined}>
          <button
            type="button"
            className="tp-target-main"
            aria-expanded={expanded}
            aria-haspopup="dialog"
            onClick={() => setExpanded((v) => !v)}
          >
            <UiIcon icon={isHistorical ? SemIcons.warning : Target01} size="xs" className="tp-target-icon" />
            <span className="tp-target-text">{summary}</span>
            <UiIcon icon={SemIcons.collapse} size="xs" className={`tp-caret${expanded ? ' is-open' : ''}`} />
          </button>

          {isCustomized && (
            confirmRemoveGlobal ? (
              <span className="tp-confirm" role="group" aria-label="确认移除目标">
                <span>{afterRemove.kind === 'modify' ? '转为整片？' : '移除目标？'}</span>
                <button type="button" className="tp-confirm-yes" onClick={handleRemoveClick}>确认</button>
                <button type="button" className="tp-confirm-no" onClick={(e) => { e.stopPropagation(); setConfirmRemoveGlobal(false) }}>取消</button>
              </span>
            ) : (
              <button type="button" className="tp-remove" title={removeHint} aria-label={removeHint} onClick={handleRemoveClick}>
                <UiIcon icon={SemIcons.close} size="xs" />
              </button>
            )
          )}
        </div>

        {/* 意图切换：同一件事的两个互斥选项，用 radiogroup 语义 ——
            看不到颜色的人也要能知道这句话发出去会不会改工程。未选择时两个都不高亮。 */}
        {onIntentChange && (
          <div role="radiogroup" aria-label="这条消息的作用" className="tp-seg" data-value={selectedIntent ?? undefined}>
            {intentOptions.map((o) => (
              <button
                key={o.value}
                type="button"
                role="radio"
                aria-checked={selectedIntent === o.value}
                className="tp-seg-item"
                data-intent={o.value}
                title={o.title}
                onClick={() => onIntentChange(o.value)}
              >
                {o.label}
              </button>
            ))}
          </div>
        )}
        {/* 未显式选择时补一句真实去向；胶囊已经写着同一个去向时不再重复 */}
        {onIntentChange && selectedIntent === null && summary !== planCopy.label && (
          <span className="tp-hint">未选择：{planCopy.label === '普通对话' ? '按普通对话发送' : planCopy.label}</span>
        )}
      </div>

      {expanded && (
        <div className="wb-target-details tp-pop" role="dialog" aria-label="修改目标详情">
          {/* 第一行就是这次发送会发生什么：和胶囊同源，不另起一套说法 */}
          <p className="tp-pop-plan" data-tone={toneOf}>
            <b>{planCopy.label}</b>
            <span>{planCopy.detail}</span>
          </p>

          {isHistorical ? (
            <div className="tp-warn">
              <p className="tp-warn-title">
                <UiIcon icon={SemIcons.warning} size="xs" />
                目标引用的基准版本已过期
              </p>
              <p className="tp-warn-body">
                草稿基于历史版本 <b>v{effectiveVersion}</b>，最新工程已到 <b>v{stageLeadVersion ?? '最新'}</b>。新版本的时间轴与画面可能已变动，不能直接套用。
              </p>
              <div className="tp-warn-actions">
                {onViewLead && (
                  <button type="button" className="tp-btn tp-btn--primary" onClick={() => { onViewLead(); setExpanded(false) }}>
                    <UiIcon icon={Link04} size="xs" /> 查看最新版画面
                  </button>
                )}
                {onRestoreVersion && effectiveVersion !== null && (
                  <button type="button" className="tp-btn" onClick={() => onRestoreVersion(Number(effectiveVersion))}>
                    恢复工程到 v{effectiveVersion}
                  </button>
                )}
              </div>
            </div>
          ) : null}

          <dl className="tp-rows">
            {!isHistorical && (
              <div className="tp-row">
                <dt>基准版本</dt>
                <dd className="num">{hasVersion ? `v${effectiveVersion}` : '尚未生成版本'}</dd>
              </div>
            )}
            <div className="tp-row">
              <dt>{plan.kind === 'modify' ? '修改范围' : '引用范围'}</dt>
              <dd className="num">{rangeText}</dd>
            </div>
            {hasBbox && (
              <div className="tp-row">
                <dt>画面选区</dt>
                <dd>已框选局部区域</dd>
              </div>
            )}
          </dl>

          {(targetSnapshot || isCustomized) && (
            <div className="tp-pop-foot">
              <button type="button" className="tp-link" onClick={handleRemoveClick}>{removeHint}</button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
