/**
 * 后台任务面板。
 *
 * 数据来源是 DSH 的 `job/registered` / `job/settled` 事件（同一 jobId 来两次：
 * running → 终态）。这两类事件以前被后端整条丢弃，界面上完全看不到任务的存在。
 *
 * ## 为什么不是「任务列表」
 *
 * 实测一个会话有 13060 个 job，绝大部分是 p50 179ms 的瞬间 bash 调用。
 * 全部列出来等于刷屏，用户一条都不会看。真正需要被看见的是：
 *
 * - **还在跑的**：p95 是 26 秒、最长 6 分 14 秒，期间用户只看到「卡住了」
 * - **出事的**：实测 200 个 killed，现在无声无息地消失
 *
 * 所以这里只保留这两类；正常完成的短任务直接从列表移除，
 * 只在其「跑了很久」时短暂留痕。
 *
 * ## 为什么计时在前端走
 *
 * `job/registered` 只给「开始了」，不给进度。跑动中的秒数必须由前端自己算，
 * 否则界面上永远显示 0 秒 —— 而「已经等了 40 秒」正是用户唯一需要的信息。
 */
import { useEffect, useRef, useState } from 'react'
import { Check, Loader2, SquareTerminal, X } from 'lucide-react'
import './job-panel.css'

/** 一条任务在前端的形态（由流式帧维护）。 */
export interface JobView {
  jobId: string
  kind: string
  label: string
  status: 'running' | 'completed' | 'killed' | 'failed'
  /** 开始时刻（本机毫秒）；用来算「跑了多久」。 */
  startedAt: number
  /** 服务端给的耗时；终态才有。 */
  durationMs?: number
  detail?: string
}

/** 慢到这个程度的任务，完成后还值得留一句「它慢慢跑完了」。 */
const SLOW_MS = 10_000
/** 完成后留痕多久（毫秒）。够看到，又不会堆在界面上。 */
const KEEP_MS = 8_000

/** 秒数写法：小于 10 秒给一位小数，再长就整秒 —— 跑动中的数字别抖。 */
function fmtElapsed(ms: number): string {
  const s = Math.max(0, ms) / 1000
  return s < 10 ? `${s.toFixed(1)}s` : `${Math.round(s)}s`
}

/**
 * 后台任务面板。
 *
 * @param jobs      当前任务列表（由调用方按 jobId 覆盖维护）
 * @param onDismiss 关掉某条已结束的记录
 */
export function JobPanel({ jobs, onDismiss }: { jobs: JobView[]; onDismiss: (jobId: string) => void }) {
  /* 每 200ms 推进一次「跑了多久」。只在有 running 任务时才设计时器 ——
     没有任务在跑时不该空转（这个组件在对话页常驻）。 */
  const [, tick] = useState(0)
  const hasRunning = jobs.some((j) => j.status === 'running')
  useEffect(() => {
    if (!hasRunning) return
    const id = window.setInterval(() => tick((n) => n + 1), 200)
    return () => window.clearInterval(id)
  }, [hasRunning])

  /* 完成后自动收起：慢任务留 8 秒，快任务立刻走。
     用 ref 记下已经安排过的，避免每次 tick 重复排。 */
  const scheduled = useRef(new Set<string>())
  useEffect(() => {
    for (const j of jobs) {
      if (j.status === 'running' || scheduled.current.has(j.jobId)) continue
      scheduled.current.add(j.jobId)
      const slow = (j.durationMs ?? 0) >= SLOW_MS
      if (!slow) {
        onDismiss(j.jobId)
      } else {
        window.setTimeout(() => onDismiss(j.jobId), KEEP_MS)
      }
    }
  }, [jobs, onDismiss])

  if (jobs.length === 0) return null

  return (
    <div className="jobp" role="status" aria-live="polite">
      {jobs.map((j) => {
        const running = j.status === 'running'
        const elapsed = running ? Date.now() - j.startedAt : (j.durationMs ?? 0)
        return (
          <div key={j.jobId} className="jobp-row" data-status={j.status}>
            <span className="jobp-icon" aria-hidden="true">
              {running ? <Loader2 size={11} className="jobp-spin" />
                : j.status === 'completed' ? <Check size={11} />
                : j.status === 'killed' ? <X size={11} />
                : <X size={11} />}
            </span>
            <SquareTerminal size={11} className="jobp-kind" aria-hidden="true" />
            <span className="jobp-label num" title={j.label}>{j.label || j.kind}</span>
            <span className="jobp-time num">
              {fmtElapsed(elapsed)}
              {!running && j.status === 'killed' && <span className="jobp-tag">已中止</span>}
              {!running && j.status === 'failed' && <span className="jobp-tag">失败</span>}
            </span>
          </div>
        )
      })}
    </div>
  )
}

export default JobPanel
