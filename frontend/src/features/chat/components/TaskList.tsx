/**
 * TaskList —— 智能体的实时任务日志。
 *
 * ⚠️ 这是 BoardUI「任务列表」的移植。它是 Pro 组件、拿不到源码，所以这份
 * 不是照截图目测的复刻，而是从它站点上 **编译后的 JS chunk 里反读出来的原实现**：
 *   · 缓动 SOFT_EASE = [.22, 1, .36, 1]
 *   · 单元生长 height .38 / opacity .42 / filter .42 / y .42 / 遮罩 .44
 *   · 遮罩变量 --bui-reveal-fade，初值 22px，随高度收到 0
 *   · 连接线钩子路径 "M0.5 0 V8 Q0.5 14 6.5 14 H11.5"，宽 12 高 15
 *   · 线段 scaleY 0 → 1，120ms linear；钩子 pathLength 延迟 120ms × 非首行
 *   · 标题换字 blur(3px) + y 4 → -4，260ms
 *   · 折叠高度 300ms / 透明度 220ms easeOut
 *   · 默认 stepInterval 850ms、startDelay 320ms
 * 上面这些数值都在 chat-motion.ts 与 chat.css 里一一对应，改之前先看来源。
 *
 * 行为（与上游一致）：
 *   · 日志按「单元」推进：每个任务 = 1 个标题单元 + 每步 1 个单元
 *   · `revealed` 受控时完全关掉内部计时器，交给真实事件驱动
 *   · 运行中的标题带微光；该步落地后换成静态文字
 *   · 读完的任务可折叠；`collapseOnComplete` 让它在自己步骤落地时就收起
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { UiIcon, SemIcons } from '@/shared/icons/UiIcon'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { AgentThinking } from './AgentThinking'
import {
  REVEAL_MASK_STYLE,
  SOFT_EASE,
  UNIT_ANIMATE,
  UNIT_INITIAL,
  UNIT_TRANSITION,
} from './chat-motion'
import '@/features/chat/styles/components/task-list.css'

/* ── 数据形状 ──────────────────────────────────────────────── */

export interface TaskStepChip {
  label: string
  /** 文件类型图标等；不传就只有文字 */
  icon?: React.ReactNode
}

export interface TaskStep {
  label: string
  chips?: TaskStepChip[]
  /**
   * 保留换行，按多行排版。
   *
   * <p>工具步骤是「一行一条日志」，压成单行才有日志的节奏；
   * 但思考过程是一整段自然语言，压成单行再截断就只剩开头一句，
   * 用户等于看不到思考内容。这类步骤用 `multiline` 保留原文。</p>
   */
  multiline?: boolean
}

export interface TaskItem {
  /** 完成后的标题，如「已找到项目文件」 */
  title: string
  /** 进行中的标题，如「正在搜索项目文件」；不传则沿用 title */
  runningTitle?: string
  icon?: React.ComponentType<{ className?: string }>
  steps: TaskStep[]
}

export interface TaskListProps {
  tasks: TaskItem[]
  /** false 时停止内部 ticker（用于「暂停」或已结束时冻结） */
  run?: boolean
  /** 第 2 个单元之后的推进间隔 */
  stepInterval?: number
  /** 第 1 个单元的延迟，避免一挂载就和用户操作撞在同一帧 */
  startDelay?: number
  /**
   * 受控推进：已经显示了多少个「单元」。
   * 传了它就是真实事件驱动，内部计时器完全关闭。
   */
  revealed?: number
  /** true = 各自读完就收起；"all" = 全部读完一起收起 */
  collapseOnComplete?: boolean | 'all'
  /** 底部「正在处理」那行；false 关掉 */
  working?: string | false
  onComplete?: () => void
  className?: string
}

/* ── 微光文字 ──────────────────────────────────────────────── */

function ShimmerText({ children }: { children: string }) {
  return (
    <span aria-label={children} className="tl-shimmer">
      {children}
    </span>
  )
}

/* ── 遮罩：只在首次生长时挂，动画结束摘掉 ──────────────────── */

function useRevealMask(reduce: boolean) {
  const [masked, setMasked] = useState(!reduce)
  return {
    style: masked ? REVEAL_MASK_STYLE : undefined,
    onAnimationComplete: () => setMasked(false),
  }
}

/* ── 连接线 ────────────────────────────────────────────────────
   一条竖线 + 一个弯钩。竖线是「从上一行接过来」，钩子是「拐进这一行」。 */

const HOOK_PATH = 'M0.5 0 V8 Q0.5 14 6.5 14 H11.5'
const LINE_TRANSITION = { duration: 0.12, ease: 'linear' as const, delay: 0 }

function StepConnector({ first, last, reduce }: { first: boolean; last: boolean; reduce: boolean }) {
  return (
    <span aria-hidden className="tl-connector">
      <svg width={12} height={15} viewBox="0 0 12 15" fill="none" className="tl-connector-hook">
        <motion.path
          d={HOOK_PATH}
          stroke="currentColor"
          /* 与 .tl-connector-line 的 1.5px 对齐：钩子和竖线粗细不一致时，
             拐角处会出现一个明显的「台阶」 */
          strokeWidth={1.5}
          initial={!reduce && { pathLength: 0 }}
          animate={{ pathLength: 1 }}
          /* 非首行延后一拍：钩子等竖线先接上，否则看起来是两笔画同时落 */
          transition={{ duration: 0.14, ease: 'linear', delay: 0.12 * (first ? 0 : 1) }}
        />
      </svg>
      {!last && (
        <motion.span
          className="tl-connector-line"
          initial={!reduce && { scaleY: 0 }}
          animate={{ scaleY: 1 }}
          transition={LINE_TRANSITION}
        />
      )}
    </span>
  )
}

/** 从上级跨到下级的那道竖线（资源列表等处用；任务列表本身不需要） */
export function GuideBridge({
  height,
  offset = 8,
  reduce,
}: {
  height: number
  offset?: number
  reduce: boolean
}) {
  return (
    <motion.span
      aria-hidden
      className="tl-guide"
      style={{ top: -height, height, insetInlineStart: offset }}
      initial={!reduce && { scaleY: 0 }}
      animate={{ scaleY: 1 }}
      transition={LINE_TRANSITION}
    />
  )
}

/* ── 单行日志 ──────────────────────────────────────────────── */

function LogRow({
  first,
  last,
  reduce,
  className,
  children,
}: {
  first: boolean
  last: boolean
  reduce: boolean
  className?: string
  children: React.ReactNode
}) {
  const mask = useRevealMask(reduce)
  return (
    <motion.li
      initial={!reduce && UNIT_INITIAL}
      animate={UNIT_ANIMATE}
      transition={UNIT_TRANSITION}
      {...mask}
      className={`tl-row${className ? ` ${className}` : ''}`}
    >
      <StepConnector first={first} last={last} reduce={reduce} />
      {children}
    </motion.li>
  )
}

/* ── 推进计数 ──────────────────────────────────────────────────
   内部计时器与受控模式共用一套返回值：受控时直接用外部给的数字，
   并把内部 timer 彻底关掉（不是靠 state 不更新绕过）。 */

export function useRevealTicker({
  total,
  run = true,
  stepInterval = 850,
  startDelay = 320,
  revealed,
  delayFor,
  onComplete,
}: {
  total: number
  run?: boolean
  stepInterval?: number
  startDelay?: number
  revealed?: number
  delayFor?: (shown: number) => number
  onComplete?: () => void
}) {
  const controlled = revealed !== undefined
  const [internal, setInternal] = useState(0)
  const shown = controlled ? Math.max(0, Math.min(revealed!, total)) : internal

  useEffect(() => {
    if (controlled || !run || shown >= total) return
    const delay = delayFor ? delayFor(shown) : shown === 0 ? startDelay : stepInterval
    const timer = window.setTimeout(() => setInternal((n) => n + 1), delay)
    return () => window.clearTimeout(timer)
  }, [controlled, run, shown, total, startDelay, stepInterval, delayFor])

  const firedRef = useRef(false)
  useEffect(() => {
    if (total === 0 || shown < total) {
      firedRef.current = false
      return
    }
    if (!firedRef.current) {
      firedRef.current = true
      onComplete?.()
    }
  }, [shown, total, onComplete])

  return shown
}

/* ── 步骤行 ────────────────────────────────────────────────── */

function Chip({ chip }: { chip: TaskStepChip }) {
  return (
    <span className={`tl-chip${chip.icon ? ' tl-chip--icon' : ''}`}>
      {chip.icon ? (
        <span aria-hidden className="tl-chip-icon">
          {chip.icon}
        </span>
      ) : null}
      <span className="tl-chip-label">{chip.label}</span>
    </span>
  )
}

function StepRow({
  step,
  active,
  first,
  last,
  reduce,
}: {
  step: TaskStep
  active: boolean
  first: boolean
  last: boolean
  reduce: boolean
}) {
  return (
    <LogRow first={first} last={last} reduce={reduce}>
      <span className={step.multiline ? 'tl-step tl-step--multiline' : 'tl-step'}>
        {active ? <ShimmerText>{step.label}</ShimmerText> : step.label}
        {step.chips?.map((chip, i) => (
          <Chip key={`${chip.label}-${i}`} chip={chip} />
        ))}
      </span>
    </LogRow>
  )
}

/* ── 生长单元 ────────────────────────────────────────────────── */

function Unit({ reduce, children }: { reduce: boolean; children: React.ReactNode }) {
  const mask = useRevealMask(reduce)
  return (
    <motion.section
      initial={!reduce && UNIT_INITIAL}
      animate={UNIT_ANIMATE}
      transition={UNIT_TRANSITION}
      {...mask}
      className="tl-unit"
    >
      {children}
    </motion.section>
  )
}

/* ── 标题换字 ──────────────────────────────────────────────────
   进行中 / 完成 两个标题之间不是瞬间替换，而是模糊着换过去：
   旧的向上飘走，新的从下方浮上来。popLayout 让两个绝对占位不叠加撑高。 */

function SwapTitle({ label, running }: { label: string; running: boolean }) {
  return (
    <span className="tl-swap">
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span
          key={label}
          initial={{ opacity: 0, y: 4, filter: 'blur(3px)' }}
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
          exit={{ opacity: 0, y: -4, filter: 'blur(3px)' }}
          transition={{ duration: 0.26, ease: SOFT_EASE }}
          className="tl-swap-item"
        >
          {running ? <ShimmerText>{label}</ShimmerText> : label}
        </motion.span>
      </AnimatePresence>
    </span>
  )
}

/* ── 一个任务 ────────────────────────────────────────────────── */

function TaskBlock({
  task,
  headIndex,
  endIndex,
  revealed,
  total,
  collapseOnComplete,
  reduce,
}: {
  task: TaskItem
  headIndex: number
  endIndex: number
  revealed: number
  total: number
  collapseOnComplete: boolean | 'all'
  reduce: boolean
}) {
  /* null = 跟随自动折叠策略；true/false = 用户手动改过，之后不再自动 */
  const [manualOpen, setManualOpen] = useState<boolean | null>(null)
  const done = revealed >= endIndex
  const Icon = task.icon

  const open =
    manualOpen ??
    !(collapseOnComplete === 'all' ? revealed >= total : collapseOnComplete && done)
  const title = done ? task.title : (task.runningTitle ?? task.title)

  return (
    <Unit reduce={reduce}>
      <button
        type="button"
        onClick={() => setManualOpen(!open)}
        aria-expanded={open}
        className="tl-task-head"
      >
        {Icon ? <Icon className="tl-task-icon" /> : null}
        <span className="tl-task-title">
          <SwapTitle label={title} running={!done} />
        </span>
        <UiIcon icon={SemIcons.collapse} className={`tl-task-caret${open ? ' is-open' : ''} aria-hidden `} />
      </button>

      <motion.div
        animate={{ height: open ? 'auto' : 0, opacity: open ? 1 : 0 }}
        transition={{
          height: { duration: 0.3, ease: SOFT_EASE },
          opacity: { duration: 0.22, ease: 'easeOut' },
        }}
        className="tl-task-body"
      >
        <ul aria-live="polite" className="tl-steps">
          {task.steps.map((step, i) => {
            const unit = headIndex + 1 + i
            /* 还没推进到这一步：整行不渲染，而不是渲染成灰的 ——
               灰色的「未完成」会让人以为它在等，而它其实还没开始 */
            if (revealed <= unit) return null
            const lastStep = i === Math.min(revealed - headIndex - 2, task.steps.length - 1)
            return (
              <StepRow
                key={`${step.label}-${i}`}
                step={step}
                active={!reduce && revealed === unit + 1 && revealed < total}
                first={i === 0}
                last={lastStep}
                reduce={reduce}
              />
            )
          })}
        </ul>
      </motion.div>
    </Unit>
  )
}

/* ── 底部「正在处理」行 ────────────────────────────────────── */

/**
 * 底部「正在处理」行。
 *
 * 上游这里用的就是它自己的 AgentThinking（variant="stars"），不是另写的
 * 三点动画。本项目已经有同一个组件（同一个来源、同一份源码），所以直接用
 * 它 —— 重造一遍只会得到一个「看起来差不多」的替代品。
 */
function WorkingRow({
  label,
  reduce,
  className,
}: {
  label: string
  reduce: boolean
  className?: string
}) {
  const mask = useRevealMask(reduce)
  return (
    <motion.div
      initial={!reduce && UNIT_INITIAL}
      animate={UNIT_ANIMATE}
      transition={UNIT_TRANSITION}
      {...mask}
      className={`tl-working${className ? ` ${className}` : ''}`}
    >
      <div className="tl-working-inner">
        <AgentThinking variant="stars" label={label} />
      </div>
    </motion.div>
  )
}

/* ── 导出 ──────────────────────────────────────────────────── */

export function TaskList({
  tasks,
  run = true,
  stepInterval = 850,
  startDelay = 320,
  revealed,
  collapseOnComplete = false,
  working = '正在处理',
  onComplete,
  className,
}: TaskListProps) {
  const reduce = useReducedMotion() ?? false

  /* 把任务列表摊成「单元」序号：
     [0, 1+n0, 1+n0+1+n1, ...] —— 第 i 个任务的标题单元是 entry[i]，
     它的最后一步是 entry[i+1]。这是上游原始算法，不是近似。 */
  const entries = useMemo(() => {
    const heads = tasks.reduce<number[]>((acc, t) => [...acc, acc[acc.length - 1] + 1 + t.steps.length], [0])
    return tasks.map((task, i) => ({ task, headIndex: heads[i], endIndex: heads[i + 1] }))
  }, [tasks])

  const lastEnd = entries.length > 0 ? entries[entries.length - 1].endIndex : 0
  /* 末尾多给一个单元，留给「正在处理」那一行；受控时不需要 */
  const total = lastEnd + (revealed === undefined ? 1 : 0)

  const shown = useRevealTicker({ total, run, stepInterval, startDelay, revealed, onComplete })

  return (
    <div className={`tl-root${className ? ` ${className}` : ''}`}>
      {entries.map(({ task, headIndex, endIndex }, i) =>
        shown <= headIndex ? null : (
          <TaskBlock
            key={`${task.title}-${i}`}
            task={task}
            headIndex={headIndex}
            endIndex={endIndex}
            revealed={shown}
            total={total}
            collapseOnComplete={collapseOnComplete}
            reduce={reduce}
          />
        ),
      )}
      {working !== false && shown > 0 && shown < total ? <WorkingRow label={working} reduce={reduce} /> : null}
    </div>
  )
}

export default TaskList
