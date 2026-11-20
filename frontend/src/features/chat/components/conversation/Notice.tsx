import type { ReactNode } from 'react'
import { UiIcon, SemIcons } from '@/shared/icons/UiIcon'

export type NoticeTone = 'info' | 'loading' | 'warn' | 'error'

const TONE_ICON = {
  info: SemIcons.info,
  loading: SemIcons.loading,
  warn: SemIcons.warning,
  error: SemIcons.error,
} as const

/**
 * 对话页里所有「说明一件事」的提示条：读取中、没读全、没保存、仅本页、演示回复、本轮未改动……
 *
 * <p>以前每种提示各有一套样式（左色条、红底块、灰底块、裸文字），同一屏能出现四种长相，
 * 用户分不清哪条要紧。现在统一成一种：图标 + 一句话 + 至多一个按钮，靠图标和图标色区分轻重，
 * 底色始终是同一档浅底。原始错误信息放进悬停提示，不塞进正文那一句话里。</p>
 */
export function Notice({ tone = 'info', children, detail, action, onDismiss, role }: {
  tone?: NoticeTone
  children: ReactNode
  /** 悬停时给的原始信息（例如后端返回的错误），正文只说结论 */
  detail?: string
  action?: { label: string; onClick: () => void }
  onDismiss?: () => void
  role?: 'status' | 'alert' | 'note'
}) {
  return (
    <div className="cv3-notice" data-tone={tone} role={role ?? (tone === 'error' ? 'alert' : 'status')} title={detail}>
      <UiIcon icon={TONE_ICON[tone]} size="sm" className={`cv3-notice-icon${tone === 'loading' ? ' cv3-spin' : ''}`} />
      <span className="cv3-notice-text">{children}</span>
      {action && (
        <button type="button" className="cv3-notice-btn" onClick={action.onClick}>{action.label}</button>
      )}
      {onDismiss && (
        <button type="button" className="cv3-notice-x" aria-label="关闭" title="关闭" onClick={onDismiss}>
          <UiIcon icon={SemIcons.close} size="xs" />
        </button>
      )}
    </div>
  )
}
