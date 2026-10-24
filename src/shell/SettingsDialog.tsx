import { useEffect, useRef, useState } from 'react'

/**
 * 设置弹窗 —— 复用 paba 的原生 <dialog> 模式（.delete-dialog）。
 *
 * 内容：逐行设置项 + Agent Harness 选配。
 * ⚠️ 演示适配器：只改本地偏好，不写后端、不验证凭证。
 */

export type HarnessId = 'claude' | 'codex' | 'hermes' | 'custom'

export type ThemeId = 'dark' | 'light' | 'tactile'

export interface Settings {
  theme: ThemeId
  harness: HarnessId
  harnessEndpoint: string
  model: string
  autoPreview: boolean
  showTimeline: boolean
  exportDir: string
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'dark',
  harness: 'claude',
  harnessEndpoint: 'http://127.0.0.1:8788/v1',
  model: 'deepseek-v4.1-flash',
  autoPreview: true,
  showTimeline: true,
  exportDir: '~/ai-video-desktop/renders',
}

const HARNESSES: Array<{ id: HarnessId; label: string; desc: string }> = [
  { id: 'claude',  label: 'Claude',  desc: 'Claude Code harness · 支持第三方模型端点' },
  { id: 'codex',   label: 'Codex',   desc: 'OpenAI Codex CLI' },
  { id: 'hermes',  label: 'Hermes',  desc: 'Hermes agent runtime' },
  { id: 'custom',  label: '自定义',  desc: '自填兼容 Anthropic API 的端点' },
]

function Icon({ name, className = 'ui-icon' }: { name: string; className?: string }) {
  return (
    <svg className={className} aria-hidden="true">
      <use href={`./assets/paba-icons.svg#${name}`} />
    </svg>
  )
}

export function SettingsDialog({
  open, onClose, settings, onChange,
}: {
  open: boolean
  onClose: () => void
  settings: Settings
  onChange: (next: Settings) => void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const [draft, setDraft] = useState(settings)

  useEffect(() => { setDraft(settings) }, [settings, open])

  // paba 用原生 dialog：showModal() 才有 ::backdrop 和焦点陷阱
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (open && !el.open) el.showModal()
    if (!open && el.open) el.close()
  }, [open])

  const set = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    setDraft((d) => ({ ...d, [key]: value }))

  return (
    <dialog ref={ref} className="delete-dialog" id="settings-dialog"
            aria-label="设置"
            onCancel={(e) => { e.preventDefault(); onClose() }}>
      <div className="delete-dialog-heading">
        <span className="delete-dialog-icon" style={{ background: 'color-mix(in srgb, var(--acc) 12%, var(--surf))', color: 'var(--acc)' }}>
          <Icon name="settings" />
        </span>
        <h2>设置</h2>
        <button type="button" className="iconbtn" onClick={onClose} aria-label="关闭">
          <Icon name="x" />
        </button>
      </div>

      <div className="settings-body">
        {/* ── Agent Harness ─────────────────────────────── */}
        <section className="settings-section">
          <h3>Agent Harness</h3>
          <p className="settings-hint">
            选择驱动本工作台的 agent 运行时。演示模式下不验证连接。
          </p>

          <div className="harness-grid" role="radiogroup" aria-label="Agent Harness">
            {HARNESSES.map((h) => (
              <button key={h.id} type="button" role="radio"
                      aria-checked={draft.harness === h.id}
                      className="harness-card"
                      data-active={draft.harness === h.id || undefined}
                      onClick={() => set('harness', h.id)}>
                <span className="harness-check">
                  {draft.harness === h.id && <Icon name="square-check" />}
                </span>
                <span className="harness-text">
                  <b>{h.label}</b>
                  <em>{h.desc}</em>
                </span>
              </button>
            ))}
          </div>

          <Row label="模型端点" hint="兼容 Anthropic API 的 base URL">
            <input className="settings-input" value={draft.harnessEndpoint}
                   onChange={(e) => set('harnessEndpoint', e.target.value)}
                   placeholder="http://127.0.0.1:8788/v1" />
          </Row>
          <Row label="模型" hint="harness 使用的默认模型 ID">
            <input className="settings-input" value={draft.model}
                   onChange={(e) => set('model', e.target.value)}
                   placeholder="claude-opus-5" />
          </Row>
        </section>

        {/* ── 工作台 ────────────────────────────────────── */}
        <section className="settings-section">
          <h3>工作台</h3>
          <Row label="自动预览" hint="AI 改动后自动跳到它刚动的那一帧">
            <Toggle checked={draft.autoPreview}
                    onChange={(v) => set('autoPreview', v)} />
          </Row>
          <Row label="显示时间线" hint="工作区底部的场景时间线">
            <Toggle checked={draft.showTimeline}
                    onChange={(v) => set('showTimeline', v)} />
          </Row>
          <Row label="导出目录" hint="渲染产物的存放位置">
            <input className="settings-input" value={draft.exportDir}
                   onChange={(e) => set('exportDir', e.target.value)} />
          </Row>
        </section>

        <p className="settings-note">
          演示适配器：以上设置只保存在本地，不会连接真实后端，也不验证凭证。
        </p>
      </div>

      <div className="delete-dialog-actions">
        <button type="button" className="settings-btn" onClick={onClose}>取消</button>
        <button type="button" className="delete-dialog-confirm"
                onClick={() => { onChange(draft); onClose() }}>
          <Icon name="square-check" />保存
        </button>
      </div>
    </dialog>
  )
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="settings-row">
      <div className="settings-row-label">
        <b>{label}</b>
        {hint && <em>{hint}</em>}
      </div>
      <div className="settings-row-control">{children}</div>
    </div>
  )
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={checked}
            className="settings-toggle" data-on={checked || undefined}
            onClick={() => onChange(!checked)}>
      <span />
    </button>
  )
}
