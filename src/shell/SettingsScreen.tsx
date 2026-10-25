import { useState } from 'react'
import { HARNESSES } from '@/data/harnesses'
import { type Settings, type ThemeId } from '@/shell/settings-model'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'

/**
 * 设置 —— 大窗弹窗（shadcn Dialog / Radix：Esc、遮罩点击、右上 X 都能关）。
 *
 * 布局沿用全屏版的双栏：左侧分区导航（hm-nav 的 pill 项）+ 右侧内容面板，
 * 只是整体缩进一个居中大窗里，不再整屏接管。
 *
 * 视觉沿用项目范式：行 = 引擎选择器弹层的行（透明底 / hover hole / 选中 soft + 勾），
 * 单选圆点 = cv3-hp-radio；标题行走 pj-bar 的 13px/600。
 *
 * 即改即生效：没有「保存」按钮 —— 每项改动直接写回 App 的 settings
 * 并持久化到 localStorage（模型与读写见 settings-model.ts）。
 *
 * ⚠️ 演示态：引擎数据来自 data/harnesses.ts（与首页 / 对话输入区同一份，
 *    只有 DeepSeek 标记已接入）；服务端点只存本机，不验证连通性。
 *    旧版的 autoPreview / showTimeline / exportDir 没有任何消费方，已删除 ——
 *    设置弹窗里不放不生效的项。
 */

export type { Settings, ThemeId } from '@/shell/settings-model'

type SectionId = 'appearance' | 'harness' | 'about'

const SECTIONS: Array<{ id: SectionId; label: string; icon: string }> = [
  { id: 'appearance', label: '外观', icon: 'sun' },
  { id: 'harness', label: '引擎与模型', icon: 'boxes' },
  { id: 'about', label: '关于', icon: 'circle-help' },
]

/** 主题样片的三条色带 = 各主题的 bg / surf / acc（设计常量，与 brand.css 一致） */
const THEMES: Array<{ id: ThemeId; label: string; desc: string }> = [
  { id: 'dark', label: '深色', desc: '默认 · 纯黑工作台' },
  { id: 'light', label: '浅色', desc: '亮色界面' },
  { id: 'tactile', label: '纸感', desc: 'A2 触感 · 纸面' },
]

function Icon({ name, className = 'ui-icon' }: { name: string; className?: string }) {
  return (
    <svg className={className} aria-hidden="true">
      <use href={`./assets/paba-icons.svg#${name}`} />
    </svg>
  )
}

export function SettingsScreen({
  open, onClose, settings, onChange, onThemeChange,
}: {
  open: boolean
  onClose: () => void
  settings: Settings
  onChange: (next: Settings) => void
  /** 主题走 App 的 changeTheme：带全局过渡类，避免切换闪屏 */
  onThemeChange: (theme: ThemeId) => void
}) {
  const [section, setSection] = useState<SectionId>('appearance')

  const set = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    onChange({ ...settings, [key]: value })

  const harness = HARNESSES.find((h) => h.id === settings.harness) ?? HARNESSES[0]

  const pickHarness = (id: string) => {
    const h = HARNESSES.find((x) => x.id === id)
    if (!h) return
    onChange({ ...settings, harness: id, model: h.models.includes(settings.model) ? settings.model : h.models[0] })
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="set-dlg" showCloseButton aria-describedby={undefined}>
        <div className="set-dlg-head">
          <DialogTitle className="set-dlg-title">设置</DialogTitle>
          <span className="set-dlg-sub">即改即生效，存在本机。</span>
        </div>

        <div className="set-dlg-body">
          <nav className="set-nav" aria-label="设置分区">
            {SECTIONS.map((s) => (
              <button key={s.id} type="button" className="set-nav-item"
                      data-on={section === s.id || undefined}
                      aria-current={section === s.id ? 'true' : undefined}
                      onClick={() => setSection(s.id)}>
                <Icon name={s.icon} />
                <span>{s.label}</span>
              </button>
            ))}
          </nav>

          <div className="set-panel" key={section}>
            {section === 'appearance' && (
              <section className="set-sec">
                <h3 className="set-sec-head">外观</h3>
                <p className="set-hint">整个应用即时切换，选择会记住。</p>
                <div className="set-rows" role="radiogroup" aria-label="主题">
                  {THEMES.map((t) => (
                    <button key={t.id} type="button" role="radio"
                            aria-checked={settings.theme === t.id}
                            className="set-rowbtn"
                            data-on={settings.theme === t.id || undefined}
                            onClick={() => onThemeChange(t.id)}>
                      <span className="set-swatch" data-theme={t.id} aria-hidden="true"><i /><i /><i /></span>
                      <span className="set-rowtxt">
                        <b>{t.label}</b>
                        <small>{t.desc}</small>
                      </span>
                      {settings.theme === t.id && <Icon name="check" className="ui-icon set-ck" />}
                    </button>
                  ))}
                </div>
              </section>
            )}

            {section === 'harness' && (
              <section className="set-sec">
                <h3 className="set-sec-head">引擎与模型</h3>
                <p className="set-hint">
                  新会话默认使用的执行引擎，与首页、对话输入区共用同一份数据；未接入的引擎如实标出。
                </p>
                <div className="set-rows" role="radiogroup" aria-label="默认引擎">
                  {HARNESSES.map((h) => (
                    <button key={h.id} type="button" role="radio"
                            aria-checked={h.id === settings.harness}
                            className="set-rowbtn"
                            data-on={h.id === settings.harness || undefined}
                            onClick={() => pickHarness(h.id)}>
                      <span className="set-hmark"
                            style={{
                              '--h-color': h.color,
                              maskImage: `url(${h.icon})`,
                              WebkitMaskImage: `url(${h.icon})`,
                            } as React.CSSProperties} />
                      <span className="set-rowtxt">
                        <b>{h.name}</b>
                        <small>{h.ready ? `${h.models.length} 个模型 · 可发送` : '未接入 · 接入后可发送'}</small>
                      </span>
                      <span className="set-hstate" data-ready={h.ready || undefined}>
                        <i />{h.ready ? '已接入' : '未接入'}
                      </span>
                      {h.id === settings.harness && <Icon name="check" className="ui-icon set-ck" />}
                    </button>
                  ))}
                </div>

                <h4 className="set-subhead">默认模型 · {harness.short}</h4>
                <div className="set-rows" role="radiogroup" aria-label="默认模型">
                  {harness.models.map((m) => (
                    <button key={m} type="button" role="radio"
                            aria-checked={settings.model === m}
                            className="set-rowbtn set-mrow"
                            data-on={settings.model === m || undefined}
                            onClick={() => set('model', m)}>
                      <span className="set-radio" aria-hidden="true" />
                      <code className="num">{m}</code>
                      {settings.model === m && <Icon name="check" className="ui-icon set-ck" />}
                    </button>
                  ))}
                </div>

                <h4 className="set-subhead">服务端点</h4>
                <Row label="API Base URL" hint="演示态：只保存在本机，不做连通性验证">
                  <Input className="set-endpoint" value={settings.harnessEndpoint} spellCheck={false}
                         onChange={(e) => set('harnessEndpoint', e.target.value)}
                         placeholder="http://127.0.0.1:8788/v1" />
                </Row>
              </section>
            )}

            {section === 'about' && (
              <section className="set-sec">
                <h3 className="set-sec-head">关于</h3>
                <Row label="产品"><span>FengMotion Desktop · 本地优先</span></Row>
                <Row label="数据存放">
                  <span>素材索引存本机 IndexedDB；设置与会话偏好存 localStorage，不上传。</span>
                </Row>
                <Row label="引擎接入">
                  <span>当前仅 DeepSeek 已接入；其余引擎接入后在此启用。</span>
                </Row>
              </section>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="set-row">
      <div className="set-row-label">
        <b>{label}</b>
        {hint && <em>{hint}</em>}
      </div>
      <div className="set-row-control">{children}</div>
    </div>
  )
}
