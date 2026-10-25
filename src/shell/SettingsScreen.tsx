import { useEffect, useRef, useState } from 'react'
import { HARNESSES, REASONING_LABEL, DEFAULT_PREFS, prefsKey, loadPrefs, savePrefs,
         type ModelPrefs, type Reasoning } from '@/data/harnesses'
import { formatBytes, initLibrary, listAssets, resetLibrary } from '@/services/assetService'
import { type Settings, type ThemeId, DEFAULT_SETTINGS,
         applyBackup, clearModelPrefs, downloadBackup, readBackup } from '@/shell/settings-model'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Button } from '@/components/ui/button'
import pkg from '../../package.json'

const APP_VERSION = pkg.version

/**
 * 设置 —— 大窗弹窗（shadcn Dialog / Radix：Esc、遮罩点击、右上 X 都能关）。
 *
 * 布局沿用双栏：左侧分区导航（hm-nav 的 pill 项）+ 右侧内容面板。
 * 每一项都必须真实生效，不放没有消费方的摆设：
 *   · 通用     默认进入视图（App 启动时读取）；
 *   · 外观     三主题即时切换 + 减弱动效（html[data-motion] 全局压平）；
 *   · 对话     新会话默认偏好 —— 直接读写对话选择器用的同一份
 *              loadPrefs/savePrefs（按当前默认引擎+模型记），下次进对话生效；
 *   · 引擎与模型  默认引擎 / 默认模型 / 服务端点（与首页、对话同源）；
 *   · 数据     本地素材索引的真实统计（listAssets）+ 恢复默认设置；
 *   · 关于     产品与数据存放说明。
 * 演示态边界：服务端点只存本机不验证；语言/账户等没有真实设施的东西不放假入口。
 */

export type { Settings, ThemeId } from '@/shell/settings-model'

type SectionId = 'general' | 'appearance' | 'chat' | 'harness' | 'data' | 'about'

const SECTIONS: Array<{ id: SectionId; label: string; icon: string }> = [
  { id: 'general', label: '通用', icon: 'compass' },
  { id: 'appearance', label: '外观', icon: 'sun' },
  { id: 'chat', label: '对话', icon: 'message-circle-question' },
  { id: 'harness', label: '引擎与模型', icon: 'boxes' },
  { id: 'data', label: '数据', icon: 'cylinder' },
  { id: 'about', label: '关于', icon: 'circle-help' },
]

/** 主题样片的三条色带 = 各主题的 bg / surf / acc（设计常量，与 brand.css 一致） */
const THEMES: Array<{ id: ThemeId; label: string; desc: string }> = [
  { id: 'dark', label: '深色', desc: '默认 · 纯黑工作台' },
  { id: 'light', label: '浅色', desc: '亮色界面' },
  { id: 'tactile', label: '纸感', desc: 'A2 触感 · 纸面' },
]

const CONTEXTS = [32, 64, 128] as const

function Icon({ name, className = 'ui-icon' }: { name: string; className?: string }) {
  return (
    <svg className={className} aria-hidden="true">
      <use href={`./assets/paba-icons.svg#${name}`} />
    </svg>
  )
}

/** 分段选择：复用 paba 全局的 .ch-tabs（bg hole + 按下 surf） */
function Seg({ value, options, onChange, ariaLabel }: {
  value: string
  options: Array<{ value: string; label: string }>
  onChange: (v: string) => void
  ariaLabel: string
}) {
  return (
    <div className="ch-tabs" role="radiogroup" aria-label={ariaLabel}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio"
                aria-pressed={value === o.value}
                onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
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
  const [section, setSection] = useState<SectionId>('general')
  /** 对话默认偏好：与对话选择器同一份 localStorage 数据，打开弹窗时刷新 */
  const [prefs, setPrefs] = useState<Record<string, ModelPrefs>>(() => loadPrefs())
  /** 本地素材索引统计：打开弹窗时真实读取一次 */
  const [stats, setStats] = useState<{ count: number; bytes: number } | null>(null)
  /** 数据分区的操作回执（导入成功/失败、清理结果），只活在本弹窗内 */
  const [notice, setNotice] = useState('')
  const backupInputRef = useRef<HTMLInputElement>(null)

  /** 读一次索引统计（清库/导入后也要重新读） */
  const refreshStats = () => {
    void initLibrary()
      .then(() => listAssets())
      .then((list) => setStats({ count: list.length, bytes: list.reduce((s, a) => s + a.sizeBytes, 0) }))
      .catch(() => setStats(null))
  }

  useEffect(() => {
    if (!open) return
    setPrefs(loadPrefs())
    setNotice('')
    refreshStats()
  }, [open])

  /** 导入备份：读文件 → 校验 → 应用 → 回执 */
  const onPickBackup = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      const text = await file.text()
      const backup = readBackup(text)
      applyBackup(backup)
      onChange(backup.settings)
      onThemeChange(backup.settings.theme)
      setPrefs(loadPrefs())
      setNotice(`已导入 ${file.name}`)
    } catch (err) {
      setNotice(`导入失败：${err instanceof Error ? err.message : '文件读不出来'}`)
    }
  }

  /** 重建素材索引：二次确认后真的删库并重新种入内置素材 */
  const onResetLibrary = async () => {
    if (!window.confirm('将删除本机素材索引（含你导入的文件），只用内置素材重建。不可撤销，确定继续？')) return
    setNotice('正在重建…')
    try {
      await resetLibrary()
      refreshStats()
      setNotice('素材索引已重建')
    } catch (err) {
      setNotice(`重建失败：${err instanceof Error ? err.message : '未知错误'}`)
    }
  }

  const set = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    onChange({ ...settings, [key]: value })

  const harness = HARNESSES.find((h) => h.id === settings.harness) ?? HARNESSES[0]

  const pickHarness = (id: string) => {
    const h = HARNESSES.find((x) => x.id === id)
    if (!h) return
    onChange({ ...settings, harness: id, model: h.models.includes(settings.model) ? settings.model : h.models[0] })
  }

  const prefKey = prefsKey(harness.id, settings.model)
  const curPrefs = prefs[prefKey] ?? DEFAULT_PREFS
  const setPref = (patch: Partial<ModelPrefs>) => {
    const all = { ...prefs, [prefKey]: { ...(prefs[prefKey] ?? DEFAULT_PREFS), ...patch } }
    setPrefs(all)
    savePrefs(all)
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="set-dlg" showCloseButton aria-describedby={undefined}>
        <div className="set-dlg-head">
          <DialogTitle className="set-dlg-title">设置</DialogTitle>
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
            {section === 'general' && (
              <section className="set-sec">
                <h3 className="set-sec-head">通用</h3>
                <Row label="默认进入视图" hint="打开应用时先进入哪个界面">
                  <Seg ariaLabel="默认进入视图" value={settings.startView}
                       options={[{ value: 'home', label: '首页' }, { value: 'conversation', label: '我的创作' }]}
                       onChange={(v) => set('startView', v as Settings['startView'])} />
                </Row>
              </section>
            )}

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
                <div className="set-row">
                  <div className="set-row-label">
                    <b>减弱动效</b>
                    <em>压平界面动画与过渡；低性能设备或容易晕动时开启</em>
                  </div>
                  <Checkbox checked={settings.reduceMotion}
                            onCheckedChange={(v) => set('reduceMotion', v === true)}
                            aria-label="减弱动效" />
                </div>
              </section>
            )}

            {section === 'chat' && (
              <section className="set-sec">
                <h3 className="set-sec-head">对话</h3>
                <p className="set-hint">
                  新会话默认的思考强度与最大上下文，作用于当前默认引擎与模型
                  （{harness.short} · {settings.model}）；对话输入区的选择器可按模型单独调整，
                  这里的改动下次进入对话时生效。
                </p>
                <Row label="思考强度">
                  <Seg ariaLabel="默认思考强度" value={curPrefs.reasoning}
                       options={(Object.keys(REASONING_LABEL) as Reasoning[]).map((r) => ({ value: r, label: REASONING_LABEL[r] }))}
                       onChange={(v) => setPref({ reasoning: v as Reasoning })} />
                </Row>
                <Row label="最大上下文">
                  <Seg ariaLabel="默认最大上下文" value={String(curPrefs.context)}
                       options={CONTEXTS.map((c) => ({ value: String(c), label: String(c) }))}
                       onChange={(v) => setPref({ context: Number(v) as ModelPrefs['context'] })} />
                </Row>
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

            {section === 'data' && (
              <section className="set-sec">
                <h3 className="set-sec-head">数据</h3>

                <h4 className="set-subhead">本机占用</h4>
                <Row label="素材索引" hint="素材本体存在本机 IndexedDB，刷新与重启都在">
                  <span className="num">{stats ? `${stats.count} 项 · ${formatBytes(stats.bytes)}` : '读取中…'}</span>
                </Row>

                <h4 className="set-subhead">备份与恢复</h4>
                <Row label="导出设置" hint="下载一份 JSON：设置 + 每个模型的对话偏好（不含素材文件）">
                  <Button variant="outline" size="sm"
                          onClick={() => {
                            const name = downloadBackup(settings)
                            setNotice(`已导出 ${name}`)
                          }}>
                    导出…
                  </Button>
                </Row>
                <Row label="导入设置" hint="从备份文件恢复；不合格的文件会被拒绝并说明原因">
                  <Button variant="outline" size="sm" onClick={() => backupInputRef.current?.click()}>
                    导入…
                  </Button>
                  <input ref={backupInputRef} type="file" accept="application/json,.json" hidden
                         onChange={onPickBackup} />
                </Row>
                {notice && <p className="set-notice">{notice}</p>}

                <h4 className="set-subhead">清理</h4>
                <Row label="清除对话偏好" hint="思考强度与最大上下文回到默认（标准 · 64）">
                  <Button variant="outline" size="sm"
                          onClick={() => {
                            const had = clearModelPrefs()
                            setPrefs(loadPrefs())
                            setNotice(had ? '对话偏好已清除' : '本来就没有自定义偏好')
                          }}>
                    清除
                  </Button>
                </Row>
                <Row label="重建素材索引" hint="删掉本机素材索引（含导入的文件），重新种入内置素材；不可撤销">
                  <Button variant="destructive" size="sm"
                          onClick={onResetLibrary}>
                    重建…
                  </Button>
                </Row>
                <Row label="恢复默认设置" hint="主题、通用、对话偏好、引擎与模型全部回到默认值">
                  <Button variant="outline" size="sm"
                          onClick={() => { if (window.confirm('把所有设置恢复为默认值？')) onChange({ ...DEFAULT_SETTINGS }) }}>
                    恢复默认
                  </Button>
                </Row>
              </section>
            )}

            {section === 'about' && (
              <section className="set-sec">
                <h3 className="set-sec-head">关于</h3>
                <Row label="产品"><span>FengMotion Desktop</span></Row>
                <Row label="版本"><span className="num">v{APP_VERSION}</span></Row>
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
