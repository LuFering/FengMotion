import { useEffect, useId, useState } from "react";
import {
  AnimatePresence,
  LayoutGroup,
  motion,
  useReducedMotion,
} from "motion/react";
import "@/styles/agent-progress.css";

/* ══ Agent progress ═══════════════════════════════════════
   Agent 正在做的事：一条步骤清单，带总进度环，可以收起成一行。

   照 BoardUI 的 Agent Progress 复刻。几何与时间都取自它的实现：
     · 卡片 341px 宽、圆角 16px、1px 边线
     · 收起高 44px，展开高 max(44, 45 + 38 × 步数)
     · 每行 32px，行间距 6px，列表上边距 9px，内边距 10/8/10
     · 每步 3000ms，首次出现延迟 1100ms，每行入场 delay 0.65 + 0.16 × i
     · 高亮框用 layoutId 在行间滑动 —— 这是它最有辨识度的动作：
       换一步时框是「滑过去」而不是消失再出现，所以必须用布局动画。

   完成时那一行会划一道删除线（scaleX 0 → 1），进行中的行文字带微光。 */

/** 默认步骤：只在没有传入时使用，用于演示与兜底 */
export const DEFAULT_AGENT_PROGRESS_STEPS = [
  "读取项目文件",
  "更新并安装浅色模式 token",
  "实现深色模式 token",
  "添加可复用的主题切换控件",
  "运行 registry、lint 与生产构建",
];

/* 文案换行用 spring：260/30/0.8 是原组件的值，比默认更稳、不甩 */
const LAYOUT_SPRING = { type: "spring" as const, stiffness: 260, damping: 30, mass: 0.8 };
const SOFT_EASE = [0.22, 1, 0.36, 1] as const;

/* ── 微光文字 ───────────────────────────────────────────────
   进行中那一行、以及收起态里的当前步骤。渐变从文字里透出来，
   不是叠一层白 —— 那样在浅底上会显成一块灰。 */
function LoadingText({ children, className }: { children: string; className?: string }) {
  return (
    <span aria-label={children} className={`ap-loading-text ${className ?? ""}`.trim()}>
      {children}
    </span>
  );
}

/* ── 总进度环：16px，随时间线性推进 ─────────────────────────── */
function ProgressRing({ running, duration, size = 16 }: { running: boolean; duration: number; size?: number }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" width={size} height={size} className="ap-ring">
      <circle cx="8" cy="8" r="6.75" fill="none" stroke="var(--ap-ring-track)" strokeWidth="2.5" />
      <motion.circle
        cx="8"
        cy="8"
        r="6.75"
        fill="none"
        stroke="var(--ap-ring-fill)"
        strokeWidth="2.5"
        strokeLinecap="round"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: running ? 1 : 0 }}
        transition={{ duration: running ? duration : 0, ease: "linear" }}
      />
    </svg>
  );
}

/* ── 单步的进度环：14px，只有进行中那一行才有 ───────────────── */
function StepRing({ running, duration }: { running: boolean; duration: number }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 14 14" className="ap-step-ring">
      <circle cx="7" cy="7" r="5.75" fill="none" stroke="var(--ap-ring-track)" strokeWidth="1.5" />
      <motion.circle
        cx="7"
        cy="7"
        r="5.75"
        fill="none"
        stroke="var(--ap-ring-fill)"
        strokeWidth="1.5"
        strokeLinecap="round"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: running ? 1 : 0 }}
        transition={{ duration: running ? duration : 0, ease: "linear" }}
      />
    </svg>
  );
}

/* ── 状态图标 ───────────────────────────────────────────────
   完成：实心圆 + 对勾；待办：虚线圆。三种状态的直径都是 14~15px，
   所以换状态时图标不会跳动。 */
function DoneMark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 14 14" className="ap-mark">
      <circle cx="7" cy="7" r="7" fill="var(--ap-mark-bg)" />
      <path
        d="M4 7.5 5.646 9.146a.5.5 0 0 0 .708 0L10 5.5"
        fill="none"
        stroke="var(--ap-mark-ink)"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function PendingMark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 15 15" className="ap-mark ap-mark-pending">
      <circle
        cx="7.5"
        cy="7.5"
        r="7"
        fill="none"
        stroke="var(--ap-mark-bg)"
        strokeDasharray="2 2"
      />
    </svg>
  );
}

/* 收起态的「展开」按钮：方框 + 斜向箭头 */
function ExpandMark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="ap-expand-mark">
      <rect x="1" y="1" width="18" height="18" rx="4" fill="var(--ap-mark-bg)" />
      <path
        d="M7.553 6.109a.75.75 0 0 1 .75-.75h5.907a.5.5 0 0 1 .5.5v5.906a.75.75 0 0 1-1.5 0V7.919l-5.79 5.791a.75.75 0 1 1-1.061-1.06l5.79-5.791H8.303a.75.75 0 0 1-.75-.75Z"
        fill="var(--ap-mark-ink)"
      />
    </svg>
  );
}

/* 收起态的「右侧还有内容」指示：一个右箭头 */
function ArrowMark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 14 14" className="ap-arrow">
      <path
        d="M7.47 2.47a.75.75 0 0 1 1.06 0l4.177 4.176a.5.5 0 0 1 0 .708L8.53 11.53a.75.75 0 0 1-1.06-1.06l2.72-2.72H2a.75.75 0 0 1 0-1.5h8.19L7.47 3.53a.75.75 0 0 1 0-1.06Z"
        fill="var(--ap-mark-ink)"
      />
    </svg>
  );
}

/* 收起按钮：一个小窗口形状，两笔拼出来，和原组件一样 */
function CollapseMark() {
  return (
    <span aria-hidden="true" className="ap-collapse-mark">
      <span className="ap-collapse-pane" />
      <span className="ap-collapse-bar" />
    </span>
  );
}

/* ── 可变文案 ───────────────────────────────────────────────
   「还剩 N 步」会随进度变短变长。用 layout="position" 让它在原地
   形变，同时旧文案模糊上移、新文案模糊下落 —— 两段合起来才是原组件的
   那种「换了一句话」而不是「字突然跳了」。 */
function SwapLabel({ label, className }: { label: string; className?: string }) {
  return (
    <motion.span
      layout="position"
      transition={LAYOUT_SPRING}
      className={`ap-swap ${className ?? ""}`.trim()}
    >
      {/* popLayout：旧文案脱离流去退场、新文案立刻占位，所以宽度变化是连续的。
          叠字问题由 .ap-swap 的 position:relative + 子元素 absolute 解决 ——
          两段文字各自占位，视觉上不重合。 */}
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span
          key={label}
          initial={{ opacity: 0, y: 4, filter: "blur(3px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          exit={{ opacity: 0, y: -4, filter: "blur(3px)" }}
          transition={{ duration: 0.26, ease: SOFT_EASE }}
          className="ap-swap-text"
        >
          {label}
        </motion.span>
      </AnimatePresence>
    </motion.span>
  );
}

/* ── 步骤标签 ───────────────────────────────────────────────
   完成时划一道删除线（scaleX 0 → 1，从左往右扫）。
   进行中走微光；已完成与未开始都用次级文字色。 */
function StepLabel({ label, complete, active }: { label: string; complete: boolean; active: boolean }) {
  return (
    <span
      className="ap-step-label"
      data-complete={complete || undefined}
      data-active={active || undefined}
    >
      {active ? <LoadingText>{label}</LoadingText> : label}
      <AnimatePresence>
        {complete && (
          <motion.span
            aria-hidden="true"
            className="ap-strike"
            initial={{ scaleX: 0, opacity: 0 }}
            animate={{ scaleX: 1, opacity: 0.8 }}
            exit={{ scaleX: 0, opacity: 0 }}
            transition={{ duration: 0.38, ease: SOFT_EASE }}
          />
        )}
      </AnimatePresence>
    </span>
  );
}

/* ── 一行步骤 ───────────────────────────────────────────────
   外层给高度与入场，内层给左右内边距 —— 进行中的行内边距更大（9/13），
   于是高亮框看起来是「撑开」包住内容的，而不是永远一样宽。

   高亮框用 layoutId: 换到下一行时它会在两行之间滑动，而不是淡出再淡入。 */
function StepRow({
  label,
  index,
  completedCount,
  processingStarted,
  reopening,
  stepCount,
  stepSeconds,
}: {
  label: string;
  index: number;
  completedCount: number;
  processingStarted: boolean;
  reopening: boolean;
  stepCount: number;
  stepSeconds: number;
}) {
  const complete = index < completedCount;
  const active = index === completedCount && completedCount < stepCount;

  return (
    <motion.div
      layout="position"
      initial={{ opacity: 0, y: -4, filter: "blur(6px)" }}
      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      transition={{
        /* 展开时按行错开；重新展开（reopening）时几乎同时落下 */
        delay: reopening ? 0.035 * index : 0.65 + 0.16 * index,
        duration: reopening ? 0.24 : 0.45,
        ease: SOFT_EASE,
        layout: LAYOUT_SPRING,
      }}
      className="ap-row"
    >
      <motion.div
        animate={{
          paddingInlineStart: active ? 9 : 4,
          paddingInlineEnd: active ? 13 : 4,
        }}
        transition={{ duration: 0.36, ease: SOFT_EASE }}
        className="ap-row-inner"
      >
        {/* 高亮框：只有进行中那一行有。
            layoutId 用固定的名字，换行时 Motion 会把它从上一行「滑」过来，
            这就是原组件最有辨识度的动作；不要改成带 index 的唯一名。 */}
        {active && (
          <motion.span
            layoutId="ap-active-step-border"
            aria-hidden="true"
            className="ap-row-border"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={LAYOUT_SPRING}
          />
        )}

        <span className="ap-row-icon">
          <AnimatePresence initial={false} mode="popLayout">
            {complete ? (
              <motion.span
                key="complete"
                initial={{ opacity: 0, scale: 0.72, rotate: -18 }}
                animate={{ opacity: 1, scale: 1, rotate: 0 }}
                transition={{ duration: 0.34, ease: SOFT_EASE }}
                className="ap-row-icon-abs"
              >
                <DoneMark />
              </motion.span>
            ) : active ? (
              <motion.span
                key={`active-${index}`}
                initial={{ opacity: 0, scale: 0.82 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.82 }}
                transition={{ duration: 0.25, ease: "easeOut" }}
                className="ap-row-icon-abs"
              >
                <StepRing running={processingStarted} duration={stepSeconds} />
              </motion.span>
            ) : (
              <motion.span
                key="pending"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="ap-row-icon-abs"
              >
                <PendingMark />
              </motion.span>
            )}
          </AnimatePresence>
        </span>

        <span className="ap-row-text">
          <StepLabel label={label} complete={complete} active={active} />
        </span>
      </motion.div>
    </motion.div>
  );
}

/**
 * Agent 任务进度。
 *
 * @param steps            步骤文案；不传用默认演示步骤
 * @param stepDuration     每步耗时（毫秒），默认 3000
 * @param completionDelay  全部完成后再过多久回调 onFinished，默认 1000
 * @param onFinished       全部完成时调用
 * @param paused           暂停推进（比如任务挂起、等待用户输入）
 * @param defaultMinimized 初始是否收起
 */
export function AgentProgress({
  steps,
  stepDuration = 3000,
  completionDelay = 1000,
  onFinished,
  paused = false,
  defaultMinimized = false,
  className,
}: {
  steps?: string[];
  stepDuration?: number;
  completionDelay?: number;
  onFinished?: () => void;
  paused?: boolean;
  defaultMinimized?: boolean;
  className?: string;
}) {
  const reduce = useReducedMotion() ?? false;
  const list = steps && steps.length > 0 ? steps : DEFAULT_AGENT_PROGRESS_STEPS;
  const stepMs = Math.max(0, stepDuration);
  const stepSeconds = stepMs / 1000;
  /* 总时长 = 步数 × 每步，用来让总进度环匀速走完 */
  const totalSeconds = list.length * stepSeconds;

  const [completed, setCompleted] = useState(0);
  const [minimized, setMinimized] = useState(defaultMinimized);
  const [reopening, setReopening] = useState(false);
  const [processingStarted, setProcessingStarted] = useState(false);

  const stepsLeft = list.length - completed;
  const current = list[Math.min(completed, list.length - 1)];
  const allDone = completed >= list.length;

  /* 展开高 = 45 + 38 × 步数，最小 44（收起高度） */
  const expandedHeight = Math.max(44, 45 + 38 * list.length);
  const height = minimized ? 44 : expandedHeight;

  /* 首次出现后等 1100ms 才开始推进：让用户先看清清单，再开始走 */
  useEffect(() => {
    if (paused) return;
    const timer = window.setTimeout(() => setProcessingStarted(true), 1100);
    return () => window.clearTimeout(timer);
  }, [paused]);

  useEffect(() => {
    if (!processingStarted || allDone || paused) return;
    const timer = window.setTimeout(
      () => setCompleted((n) => Math.min(n + 1, list.length)),
      stepMs,
    );
    return () => window.clearTimeout(timer);
  }, [processingStarted, allDone, paused, completed, list.length, stepMs]);

  useEffect(() => {
    if (!allDone || !onFinished || paused) return;
    const timer = window.setTimeout(onFinished, Math.max(0, completionDelay));
    return () => window.clearTimeout(timer);
  }, [allDone, completionDelay, onFinished, paused]);

  const headline = allDone
    ? "全部步骤已完成"
    : `还剩 ${stepsLeft} 步`;
  const layoutId = useId();

  return (
    <motion.div
      initial={{ opacity: 0, y: -12, height: 0, filter: "blur(8px)" }}
      animate={{ opacity: 1, y: 0, height, filter: "blur(0px)" }}
      transition={{
        opacity: { duration: 0.35, ease: SOFT_EASE },
        y: { duration: 0.5, ease: SOFT_EASE },
        filter: { duration: 0.4, ease: SOFT_EASE },
        height: {
          duration: reduce ? 0 : reopening ? 0.42 : 0.24,
          ease: SOFT_EASE,
        },
      }}
      onAnimationComplete={() => {
        if (!minimized) setReopening(false);
      }}
      className={`ap-card ${className ?? ""}`.trim()}
      aria-live="polite"
      data-testid="agent-progress"
      data-reduce={reduce || undefined}
    >
      {/* 左上那枚总进度环：只要没全部完成就一直在 */}
      <AnimatePresence initial={false}>
        {!allDone && (
          <motion.span
            key="persistent-progress-ring"
            className="ap-persistent-ring"
            initial={{ opacity: 0, scale: 0.82 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.82 }}
            transition={{ duration: 0.25, ease: SOFT_EASE }}
          >
            <ProgressRing running={processingStarted} duration={totalSeconds} />
          </motion.span>
        )}
      </AnimatePresence>

      <AnimatePresence initial={false} mode="sync">
        {minimized ? (
          <motion.button
            key="minimized"
            type="button"
            data-testid="agent-progress-minimized"
            aria-label="展开步骤"
            onClick={() => {
              setReopening(true);
              setMinimized(false);
            }}
            initial={{ opacity: 0, filter: "blur(3px)" }}
            animate={{ opacity: 1, filter: "blur(0px)" }}
            exit={{ opacity: 0, filter: "blur(3px)" }}
            transition={{ duration: 0.2, delay: 0.12, ease: SOFT_EASE }}
            className="ap-min"
          >
            <span className="ap-min-left">
              <AnimatePresence initial={false}>
                {!allDone && (
                  <motion.span
                    key="progress-ring"
                    className="ap-min-ring"
                    initial={{ width: 24, opacity: 1 }}
                    animate={{ width: 24, opacity: 1 }}
                    exit={{ width: 0, opacity: 0 }}
                    transition={{ duration: 0.4, ease: SOFT_EASE }}
                  />
                )}
              </AnimatePresence>
              <SwapLabel label={headline} className="ap-min-headline" />
            </span>

            {!allDone && (
              <span className="ap-min-current">
                <ArrowMark />
                <span className="ap-min-current-text">
                  <LoadingText className="ap-min-current-label">{current}</LoadingText>
                </span>
              </span>
            )}

            <span className="ap-min-expand">
              <ExpandMark />
            </span>
          </motion.button>
        ) : (
          <motion.div
            key="expanded"
            data-testid="agent-progress-expanded"
            initial={{ opacity: 0, filter: "blur(3px)" }}
            animate={{ opacity: 1, filter: "blur(0px)" }}
            exit={{ opacity: 0, y: -4, filter: "blur(3px)" }}
            transition={{ duration: reopening ? 0.16 : 0.22, ease: SOFT_EASE }}
            className="ap-expanded"
            style={{ height: expandedHeight }}
          >
            <div className="ap-expanded-inner">
              <div className="ap-header">
                <AnimatePresence initial={false}>
                  {!allDone && (
                    <motion.span
                      key="progress-ring"
                      className="ap-header-ring"
                      initial={{ width: 24, opacity: 1 }}
                      animate={{ width: 24, opacity: 1 }}
                      exit={{ width: 0, opacity: 0 }}
                      transition={{ duration: 0.4, ease: SOFT_EASE }}
                    />
                  )}
                </AnimatePresence>

                <SwapLabel label={headline} className="ap-header-headline" />

                <button
                  type="button"
                  aria-label="收起步骤"
                  onClick={() => setMinimized(true)}
                  className="ap-header-collapse"
                >
                  <CollapseMark />
                </button>
              </div>

              <LayoutGroup id={layoutId}>
                <div className="ap-rows">
                  {list.map((step, index) => (
                    <StepRow
                      key={step}
                      label={step}
                      index={index}
                      completedCount={completed}
                      processingStarted={processingStarted}
                      reopening={reopening}
                      stepCount={list.length}
                      stepSeconds={stepSeconds}
                    />
                  ))}
                </div>
              </LayoutGroup>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
