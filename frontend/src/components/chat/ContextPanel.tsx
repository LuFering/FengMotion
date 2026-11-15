/**
 * ContextPanel —— 上下文占用详情卡片（点输入框里那个圆圈弹出）。
 *
 * 版式按你给的效果图实现：
 *   ┌ Context ─────────────────── [Compact] ┐
 *   │ 175.6K of 200K                          │
 *   │ █████████████ ████ ██ █ █ ░░            │
 *   │ ● Chat  ● Files  ● Tools  ● System  ● Memory │
 *   └─────────────────────────────────────────┘
 *
 * 数据来源是本项目后端真实上报的 usage / context 帧：
 *   promptTokens     已占用
 *   contextWindow    窗口（分母）
 *   breakdown        五档分档（system / memory / files / results / chat）
 *
 * 分档口径对齐 magpie 的 prompt.parts：实测其各项之和等于总数，
 * 说明这套分类是自洽的。DSH 自带的 contextBreakdown 只有三档
 * （system/tools/message），把附件与工具输出都埋进 message，
 * 回答不了「哪一块在膨胀」这个真正的问题。
 */

import { useEffect, useRef } from 'react'
import type { ContextBreakdown } from '@/types/contracts'
import './context-panel.css'

/** 图例里的一档。 */
interface Segment {
  id: string
  name: string
  tokens: number
  color: string
}

export interface ContextPanelProps {
  /** 已占用 token */
  used: number
  /** 上下文窗口 */
  window: number
  /** 五档分档；后端还没上报时为 null（此时只画总数，不画分档条） */
  breakdown: ContextBreakdown | null
  /** 工具 schema 占用（后端单独上报，用于在分档缺失时兜底） */
  tools: number | null
  /** 关闭 */
  onClose: () => void
  /** 触发压缩（暂时没有后端能力时传 undefined，按钮置灰） */
  onCompact?: () => void
}

/** 大数字缩写：175600 → 175.6K */
function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`
  return String(Math.round(n))
}

/* 配色取自效果图：Chat 青、Files 蓝、Tools 紫、System 粉、Memory 绿 */
const COLORS = {
  chat: '#2ab3c8',
  files: '#3b82f6',
  tools: '#8b5cf6',
  system: '#ec4899',
  memory: '#10b981',
} as const

export function ContextPanel({
  used,
  window: win,
  breakdown,
  tools,
  onClose,
  onCompact,
}: ContextPanelProps) {
  const ref = useRef<HTMLDivElement>(null)

  /* 点外面关闭：卡片盖在输入框上方，用户点别处就是「不想看了」 */
  useEffect(() => {
    const onDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose()
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  /*
   * 组装图例。有分档就用真实五档；没有分档时退回「总数 - 工具」的粗分，
   * 让卡片仍然可用，而不是空着 —— 但会明确标出这还是粗分。
   */
  const segments: Segment[] = []
  if (breakdown) {
    /* 后端把工具 schema 计进了 systemTokens（system 提示词与工具定义
       本来就是一起发出去的），但效果图里 Tools 是独立一档。
       这里按后端的合计口径如实拆回去，避免和总数对不上。 */
    segments.push(
      { id: 'chat', name: 'Chat', tokens: breakdown.chatTokens, color: COLORS.chat },
      { id: 'files', name: 'Files', tokens: breakdown.filesTokens, color: COLORS.files },
      { id: 'tools', name: 'Tools', tokens: tools ?? 0, color: COLORS.tools },
      {
        id: 'system',
        name: 'System',
        tokens: Math.max(0, breakdown.systemTokens - (tools ?? 0)),
        color: COLORS.system,
      },
      { id: 'memory', name: 'Memory', tokens: breakdown.memoryTokens, color: COLORS.memory },
    )
  }

  const safeWin = Math.max(1, win)
  const ratio = Math.min(1, used / safeWin)
  const hasBreakdown = breakdown !== null && segments.some((s) => s.tokens > 0)

  return (
    <div ref={ref} className="cpanel" role="dialog" aria-label="上下文占用">
      <div className="cpanel-head">
        <span className="cpanel-title">Context</span>
        <button
          type="button"
          className="cpanel-compact"
          disabled={!onCompact}
          title={onCompact ? '压缩历史以释放上下文' : '当前引擎不支持手动压缩'}
          onClick={onCompact}
        >
          Compact
        </button>
      </div>

      <p className="cpanel-num">
        <strong>{fmt(used)}</strong>
        <span> of {fmt(win)}</span>
      </p>

      {/* 分段条：先铺满已占用部分，剩余为底色空槽 */}
      <div
        className="cpanel-track"
        role="img"
        aria-label={`上下文占用 ${Math.round(ratio * 100)}%：${fmt(used)} / ${fmt(win)}`}
      >
        {hasBreakdown
          ? segments
              .filter((s) => s.tokens > 0)
              .map((s) => (
                <span
                  key={s.id}
                  className="cpanel-seg"
                  data-id={s.id}
                  style={{ width: `${(s.tokens / safeWin) * 100}%`, background: s.color }}
                />
              ))
          : null}
        <span className="cpanel-rest" />
      </div>

      <ul className="cpanel-legend">
        {hasBreakdown ? (
          segments.map((s) => (
            <li key={s.id} className="cpanel-chip">
              <i style={{ background: s.color }} aria-hidden />
              <span>{s.name}</span>
              <em className="cpanel-tok">{fmt(s.tokens)}</em>
            </li>
          ))
        ) : (
          <li className="cpanel-chip" data-dim="">
            <span>分档数据还没到（跑完一轮后出现）</span>
          </li>
        )}
      </ul>
    </div>
  )
}

export default ContextPanel
