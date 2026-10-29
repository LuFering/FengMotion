import { useEffect, useRef, useState } from 'react'
import { Search, Settings2, Check, CircleHelp, Sparkles, Plug, Clapperboard, Database, Cpu, Palette, SlidersHorizontal } from 'lucide-react'
import '@/styles/settings-refined.css'
import { HARNESSES, REASONING_LABEL, DEFAULT_PREFS, prefsKey, loadPrefs, savePrefs,
         type ModelPrefs, type Reasoning } from '@/data/harnesses'
import { formatBytes, initLibrary, listAssets, resetLibrary } from '@/services/assetService'
import { type Settings, type ThemeId, type WallpaperId, type WallpaperScope,
         DEFAULT_SETTINGS, FEEDBACK, applyBackup, clearModelPrefs, downloadBackup, readBackup,
         normalizeSettings } from '@/shell/settings-model'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Slider } from '@/components/ui/slider'
import { Button } from '@/components/ui/button'
import pkg from '../../package.json'

const APP_VERSION = pkg.version

/**
 * 设置 —— 大窗弹窗（shadcn Dialog / Radix：Esc、遮罩点击、右上 X 都能关）。
 *
 * 信息架构按《FengMotion设置功能规划》§1 的八分类重排：
 *   通用 / 外观 / AI 与模型 / 创作与预览 / 插件 / 实验室 / 数据与存储 / 关于与反馈。
 *
 * 铁律（规划 §11）：**没有消费方的不放控件**。
 * 判断标准只有一条 —— 改完之后应用是否真的发生用户能理解的变化。
 *   · 通用       启动视图（App 启动读取）+ 快捷键表（照真实键位写）
 *   · 外观       三主题即时切换、壁纸（含自定义图与遮罩）、显示范围、减弱动效
 *   · AI 与模型   默认引擎 / 模型 / 端点 / 思考强度 / 上下文上限
 *   · 创作与预览  显示尚未接入的状态，并保留既有偏好数据
 *   · 插件       目前没有插件机制 —— 如实说明，不放空列表和假开关
 *   · 实验室     分析开关未被消费，暂不提供无效操作
 *   · 数据与存储  真实素材统计、设置备份、清除偏好、清空本地素材（写明影响）
 *   · 关于与反馈  版本、数据存放、写邮件 / 复制邮箱 / GitHub Issues
 */

export type { Settings, ThemeId } from '@/shell/settings-model'

type SectionId =
  | 'general' | 'appearance' | 'ai' | 'creation'
  | 'plugins' | 'lab' | 'data' | 'about'

/**
 * 分区导航项：图标 + 主标题 + 一行灰字。
 * 两行结构取自 open-design 的 `.settings-nav-item > span > strong + small`：
 * 单行导航只能靠图标区分，八项并排后全是「看不出差别的四个字」；
 * 加一行副标题，眼睛不用读完全称就知道那栏放什么。
 */
const SECTIONS: Array<{ id: SectionId; label: string; desc: string; icon: string }> = [
  { id: 'general', label: '通用', desc: '启动、快捷键', icon: 'compass' },
  { id: 'appearance', label: '外观', desc: '主题、壁纸、动效', icon: 'sun' },
  { id: 'ai', label: 'AI 与模型', desc: '引擎、模型、连接', icon: 'boxes' },
  { id: 'creation', label: '创作与预览', desc: '规格偏好、接入状态', icon: 'clapperboard' },
  { id: 'plugins', label: '插件', desc: '扩展与接入', icon: 'ungroup' },
  { id: 'lab', label: '实验室', desc: '实验能力与接入状态', icon: 'sparkles' },
  { id: 'data', label: '数据与存储', desc: '占用、备份、清理', icon: 'cylinder' },
  { id: 'about', label: '关于与反馈', desc: '版本、邮箱、仓库', icon: 'circle-help' },
]

/** 主题样片的三条色带 = 各主题的 bg / surf / acc（设计常量，与 brand.css 一致） */
const THEMES: Array<{ id: ThemeId; label: string; desc: string }> = [
  { id: 'dark', label: '深色', desc: '默认 · 纯黑工作台' },
  { id: 'light', label: '浅色', desc: '亮色界面' },
  { id: 'tactile', label: '纸感', desc: 'A2 触感 · 纸面' },
]

/** 壁纸候选：id 与 wallpaper.css 的 data-wall 一一对应 */
const WALLPAPERS: Array<{ id: WallpaperId; label: string }> = [
  { id: 'none', label: '默认背景' },
  { id: 'aurora', label: '极光' },
  { id: 'dusk', label: '暮色' },
  { id: 'paper', label: '纸纹' },
  { id: 'grid', label: '网格' },
]

/** 显示范围：按真实视图 id 匹配（global = 全部） */
const SCOPES: Array<{ value: WallpaperScope; label: string }> = [
  { value: 'global', label: '全部页面' },
  { value: 'home', label: '仅首页' },
  { value: 'conversation', label: '仅我的创作' },
  { value: 'assets', label: '仅我的素材' },
  { value: 'production', label: '仅制作工作台' },
]

const CONTEXTS = [32, 64, 128] as const

/**
 * 快捷键表 —— 必须与真实操作一致（规划 §3），不是一张说明表。
 * 每一条都能在对应界面里按键复现：
 *   · 参考片库：空格播放/暂停、←/→ 切片段（RefLibrary 的 keydown）
 *   · 我的素材：←/→/↑/↓ 在卡片间移动焦点（Assets 的 keydown）
 *   · 预览/详情：Esc 关闭覆层（各视图统一）
 * 自定义快捷键尚未实现，这里如实标注「暂不可改」。
 */
const SHORTCUTS: Array<{ area: string; name: string; keys: string[] }> = [
  { area: '参考片库', name: '播放 / 暂停当前片段', keys: ['Space'] },
  { area: '参考片库', name: '上一个 / 下一个片段', keys: ['←', '→'] },
  { area: '我的素材', name: '在卡片间移动焦点', keys: ['←', '↑', '→', '↓'] },
  { area: '我的素材', name: '打开当前卡片的详情', keys: ['Enter'] },
  { area: '全局', name: '关闭覆层 / 弹窗 / 选择模式', keys: ['Esc'] },
]

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
                aria-checked={value === o.value}
                tabIndex={value === o.value ? 0 : -1}
                onKeyDown={(event) => {
                  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
                  event.preventDefault()
                  const step = ['ArrowRight', 'ArrowDown'].includes(event.key) ? 1 : -1
                  const next = (options.findIndex((option) => option.value === o.value) + step + options.length) % options.length
                  onChange(options[next].value)
                  const buttons = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="radio"]')
                  buttons?.[next]?.focus()
                }}
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
  const [query, setQuery] = useState('')
  /** 对话默认偏好：与对话选择器同一份 localStorage 数据，打开弹窗时刷新 */
  const [prefs, setPrefs] = useState<Record<string, ModelPrefs>>(() => loadPrefs())
  /** 本地素材索引统计：打开弹窗时真实读取一次 */
  const [stats, setStats] = useState<{ count: number; bytes: number } | null>(null)
  /** 数据分区的操作回执（导入成功/失败、清理结果），只活在本弹窗内 */
  const [notice, setNotice] = useState('')
  /** 清空素材的二次确认：影响说明展开后才允许执行 */
  const [confirmWipe, setConfirmWipe] = useState(false)
  /** 「待接入的引擎」展开态：默认收起，点开才显示未接入引擎的说明 */
  const [showInstall, setShowInstall] = useState(false)
  /** 哪个引擎的模型下拉开着（同一时间只开一个，magpie 的 picker 也是独占的） */
  const [pickOpen, setPickOpen] = useState<string | null>(null)
  const backupInputRef = useRef<HTMLInputElement>(null)
  const wallInputRef = useRef<HTMLInputElement>(null)

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
    setConfirmWipe(false)
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

  /**
   * 自定义壁纸：读成 data URL 存进设置。
   * 为什么存 data URL 而不是文件名：设置要能在刷新/重启后恢复，
   * 而浏览器不给页面留文件句柄；图片本身也不大（先压到 1920 以内）。
   */
  const onPickWallpaper = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!file.type.startsWith('image/')) { setNotice('请选择图片文件'); return }
    try {
      const dataUrl = await downscaleImage(file, 1920)
      onChange({ ...settings, wallpaper: 'custom', wallpaperCustom: dataUrl })
      setNotice('自定义壁纸已应用，并会随设置一起保存')
    } catch (err) {
      setNotice(`读图失败：${err instanceof Error ? err.message : '未知错误'}`)
    }
  }

  /** 清空本地素材并重建：二次确认（影响逐条写明）后真的删库 */
  const onWipeLibrary = async () => {
    setNotice('正在清空并重建…')
    try {
      await resetLibrary()
      refreshStats()
      setConfirmWipe(false)
      setNotice('已清空本地素材，只保留内置素材')
    } catch (err) {
      setNotice(`清空失败：${err instanceof Error ? err.message : '未知错误'}`)
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

  /** 壁纸预览：内置的走 data-wall 配方，自定义的给 inline 图 */
  const wallPreview = (id: WallpaperId) =>
    id === 'custom' && settings.wallpaperCustom
      ? { dataWall: 'custom' as const, style: { backgroundImage: `url(${settings.wallpaperCustom})` } }
      : { dataWall: id, style: undefined }

  /** 写邮件：mailto 预填收件人/主题/版本号；不附带任何对话或密钥（规划 §10） */
  const mailto = () => {
    const subject = encodeURIComponent(`FengMotion Desktop 反馈 · v${APP_VERSION}`)
    const body = encodeURIComponent(`\n\n——\n版本：v${APP_VERSION}\n（未附带任何对话、项目或密钥信息）`)
    window.location.href = `mailto:${FEEDBACK.email}?subject=${subject}&body=${body}`
  }

  const copyEmail = async () => {
    try {
      await navigator.clipboard.writeText(FEEDBACK.email)
      setNotice(`已复制 ${FEEDBACK.email}`)
    } catch {
      setNotice(`复制失败，邮箱是 ${FEEDBACK.email}`)
    }
  }

  const activeSection = SECTIONS.find((s) => s.id === section)!
  const filteredSections = SECTIONS.filter((s) => `${s.label} ${s.desc}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  const navIcons = { general: SlidersHorizontal, appearance: Palette, ai: Cpu, creation: Clapperboard, plugins: Plug, lab: Sparkles, data: Database, about: CircleHelp }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="set-dlg set-refined" showCloseButton aria-describedby={undefined}>
        <div className="set-dlg-head">
          <Settings2 size={17}/><DialogTitle className="set-dlg-title">设置</DialogTitle><span className="set-local-label">FengMotion Desktop · 本机偏好</span>
        </div>

        <div className="set-dlg-body">
          <nav className="set-nav" aria-label="设置分区">
            <div className="set-nav-search"><Search size={14}/><input aria-label="查找设置分类" placeholder="查找设置分类" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape' && query) { e.stopPropagation(); setQuery('') } if (e.key === 'Enter' && filteredSections[0]) { setSection(filteredSections[0].id); setQuery('') } }}/></div>
            {filteredSections.map((s) => {
              const NavIcon = navIcons[s.id]
              return <button key={s.id} type="button" className="set-nav-item"
                      data-on={section === s.id || undefined}
                      aria-current={section === s.id ? 'true' : undefined}
                      onClick={() => { setSection(s.id); setNotice(''); setConfirmWipe(false) }}>
                <NavIcon size={16} />
                <span className="set-nav-txt">
                  <b>{s.label}</b>
                  <small>{s.desc}</small>
                </span>
              </button>
            })}
            {filteredSections.length === 0 && <p className="set-search-empty">没有匹配的分类</p>}
            <div className="set-nav-foot">偏好保存在此浏览器</div>
          </nav>

          <div className="set-panel" key={section}>
            <header className="set-section-heading"><span>偏好设置</span><h2>{activeSection.label}</h2><p>{activeSection.desc}</p></header>
            {/* ── 通用 ─────────────────────────────────────── */}
            {section === 'general' && (
              <section className="set-sec">
                <h3 className="set-sec-head">通用</h3>
                <Row label="启动时打开" hint="下次启动应用先进入哪个界面">
                  <Seg ariaLabel="启动时打开" value={settings.startView}
                       options={[{ value: 'home', label: '首页' }, { value: 'conversation', label: '我的创作' }]}
                       onChange={(v) => set('startView', v as Settings['startView'])} />
                </Row>

                <div className="set-card">
                  <h4 className="set-subhead">快捷键</h4>
                  <p className="set-hint">查看各界面的快捷操作，暂不支持自定义。</p>
                  <div className="set-keys">
                    {SHORTCUTS.map((k) => (
                      <div className="set-key" key={`${k.area}-${k.name}`}>
                        <span>{k.name}</span>
                        <em>{k.area}</em>
                        {k.keys.map((key) => <kbd key={key}>{key}</kbd>)}
                      </div>
                    ))}
                  </div>
                </div>
              </section>
            )}

            {/* ── 外观 ─────────────────────────────────────── */}
            {section === 'appearance' && (
              <section className="set-sec">
                <h3 className="set-sec-head">外观</h3>
                <p className="set-hint">选择界面主题，即时预览。</p>
                <div className="set-theme-grid" role="radiogroup" aria-label="主题">
                  {THEMES.map((t) => (
                    <button key={t.id} type="button" role="radio"
                            aria-checked={settings.theme === t.id}
                            className="set-rowbtn"
                            data-on={settings.theme === t.id || undefined}
                            onClick={() => onThemeChange(t.id)}>
                      <span className="set-theme-preview" data-theme={t.id} aria-hidden="true"><i className="set-preview-bar"/><i className="set-preview-nav"/><i className="set-preview-stage"/><i className="set-preview-side"/></span>
                      <span className="set-rowtxt">
                        <b>{t.label}</b>
                        <small>{t.desc}</small>
                      </span>
                      {settings.theme === t.id && <Check size={14} className="set-ck" />}
                    </button>
                  ))}
                </div>

                <div className="set-card">
                <h4 className="set-subhead">壁纸</h4>
                <p className="set-hint">
                  设置应用背景。自定义图片随设置保存，视频画面保持原样。
                </p>
                <div className="set-walls" role="radiogroup" aria-label="壁纸">
                  {WALLPAPERS.map((w) => {
                    const pv = wallPreview(w.id)
                    return (
                      <button key={w.id} type="button" role="radio"
                              aria-checked={settings.wallpaper === w.id}
                              className="set-wall"
                              data-on={settings.wallpaper === w.id || undefined}
                              onClick={() => set('wallpaper', w.id)}>
                        <span className="set-wall-prev" data-wall={pv.dataWall} style={pv.style} />
                        <span className="set-wall-name">{w.label}</span>
                        {settings.wallpaper === w.id && (
                          <span className="set-wall-ck"><Icon name="check" /></span>
                        )}
                      </button>
                    )
                  })}
                  {/* 自定义：没有图时就是「上传」入口，有图时显示这张图 */}
                  <button type="button" role="radio"
                          aria-checked={settings.wallpaper === 'custom'}
                          className="set-wall"
                          data-on={settings.wallpaper === 'custom' || undefined}
                          onClick={() => {
                            if (settings.wallpaperCustom) set('wallpaper', 'custom')
                            else wallInputRef.current?.click()
                          }}>
                    {settings.wallpaperCustom
                      ? <span className="set-wall-prev" data-wall="custom"
                              style={{ backgroundImage: `url(${settings.wallpaperCustom})` }} />
                      : <span className="set-wall-add"><Icon name="image-plus" /></span>}
                    <span className="set-wall-name">
                      {settings.wallpaperCustom ? '自定义图片' : '选择图片…'}
                    </span>
                    {settings.wallpaper === 'custom' && (
                      <span className="set-wall-ck"><Icon name="check" /></span>
                    )}
                  </button>
                  <input ref={wallInputRef} type="file" accept="image/*" hidden onChange={onPickWallpaper} />
                </div>

                {/* 有自定义图时给一个替换入口，不然只能靠再点一次卡片 */}
                {settings.wallpaperCustom && (
                  <Row label="自定义图片" hint="已保存在本机设置里">
                    <Button variant="outline" size="sm" onClick={() => wallInputRef.current?.click()}>
                      替换…
                    </Button>
                    <Button variant="outline" size="sm"
                            onClick={() => onChange({ ...settings, wallpaperCustom: null, wallpaper: 'none' })}>
                      移除
                    </Button>
                  </Row>
                )}

                <Row label="显示范围" hint="壁纸出现在哪些界面">
                  <Seg ariaLabel="壁纸显示范围" value={settings.wallpaperScope}
                       options={SCOPES.map((s) => ({ value: s.value, label: s.label }))}
                       onChange={(v) => set('wallpaperScope', v as WallpaperScope)} />
                </Row>

                <Row label="背景遮罩" hint="压暗壁纸，保证上面的文字读得清">
                  <Slider className="set-slider" value={[settings.wallpaperDim]} min={0} max={90} step={5}
                          disabled={settings.wallpaper === 'none'}
                          onValueChange={(v) => set('wallpaperDim', v[0] ?? 0)}
                          aria-label="背景遮罩强度" />
                  <span className="set-range-val">{settings.wallpaperDim}%</span>
                </Row>
                <Row label="恢复默认背景" hint="只清壁纸，不动主题">
                  <Button variant="outline" size="sm"
                          onClick={() => onChange({ ...settings, wallpaper: 'none', wallpaperDim: DEFAULT_SETTINGS.wallpaperDim })}>
                    恢复
                  </Button>
                </Row>

                </div>
                <div className="set-card">
                <h4 className="set-subhead">界面</h4>
                <Row label="减弱动效" hint="压平界面动画与过渡；低性能设备或容易晕动时开启">
                  <Checkbox checked={settings.reduceMotion}
                            onCheckedChange={(v) => set('reduceMotion', v === true)}
                            aria-label="减弱动效" />
                </Row>
                </div>
              </section>
            )}

            {/* ── AI 与模型 ─────────────────────────────────── */}
            {section === 'ai' && (
              <section className="set-sec">
                <h3 className="set-sec-head">AI 与模型</h3>
                <p className="set-hint">
                  执行引擎负责跑任务与操作项目，模型服务提供模型与连接。与首页、对话输入区共用同一份数据。
                </p>

                {/* 已接入引擎三列等宽排列，只渲染实际接入项。 */}
                <div className="set-hcards">
                  {HARNESSES.filter((h) => h.ready).map((h) => {
                    const on = h.id === settings.harness
                    return (
                      <div key={h.id} className="set-hcard" data-on={on || undefined}>
                        {/* logo 占满卡片左侧整列（不再是一行里的小方块） */}
                        <span className="set-hcard-side" style={{ '--h-color': h.color } as React.CSSProperties}>
                          <i style={{ maskImage: `url(${h.icon})`, WebkitMaskImage: `url(${h.icon})` }} />
                        </span>
                        <div className="set-hcard-main">
                          <div className="set-hcard-top">
                            <div className="set-agent-who">
                              <b>{h.name}</b>
                              <small>
                                <em data-ready />对话适配器
                              </small>
                            </div>
                            <Popover open={pickOpen === h.id}
                                     onOpenChange={(o) => setPickOpen(o ? h.id : null)}>
                              <PopoverTrigger asChild>
                                <button type="button" className="set-agent-pick"
                                        aria-label={`${h.name} 的模型：${on ? settings.model : '默认'}`}>
                                  <span className="set-agent-pick-ic" style={{ '--h-color': h.color } as React.CSSProperties}>
                                    <i style={{ maskImage: `url(${h.icon})`, WebkitMaskImage: `url(${h.icon})` }} />
                                  </span>
                                  <span className="v">{on ? settings.model : '选择模型'}</span>
                                  <Icon name="chevron-down" className="ui-icon set-agent-pick-chev" />
                                </button>
                              </PopoverTrigger>
                              <PopoverContent className="set-pick" align="start" sideOffset={6}>
                                <div className="set-pick-head">模型</div>
                                <div className="set-pick-list" role="listbox" aria-label={`${h.name} 的模型`}>
                                  {h.models.map((m) => {
                                    const cur = on && settings.model === m
                                    return (
                                      <button key={m} type="button" role="option" aria-selected={cur}
                                              className="set-pick-item" data-on={cur || undefined}
                                              onClick={() => {
                                                onChange({ ...settings, harness: h.id, model: m })
                                                setPickOpen(null)
                                              }}>
                                        <span className="set-pick-item-ic" style={{ '--h-color': h.color } as React.CSSProperties}>
                                          <i style={{ maskImage: `url(${h.icon})`, WebkitMaskImage: `url(${h.icon})` }} />
                                        </span>
                                        <span className="set-pick-item-v">{m}</span>
                                        {cur && <Icon name="check" className="ui-icon set-pick-item-ck" />}
                                      </button>
                                    )
                                  })}
                                </div>
                              </PopoverContent>
                            </Popover>
                            {on ? <span className="set-default-engine"><Check size={12}/>默认</span> : <button type="button" className="set-default-engine" onClick={() => pickHarness(h.id)}>设为默认</button>}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>

                {/* 待安装：未接入的引擎收在这里，展开看它需要什么。
                    不是可有可无的装饰 —— 用户要知道「为什么它不在上面」。 */}
                <div className="set-agent-more">
                  <button type="button" className="set-agent-more-head"
                          aria-expanded={showInstall || undefined}
                          onClick={() => setShowInstall((v) => !v)}>
                    <Icon name="download" />
                    <span>待接入的引擎</span>
                    <small>{HARNESSES.filter((h) => !h.ready).length}</small>
                    <Icon name="chevron-down" className="ui-icon set-agent-more-chev" />
                  </button>
                  {showInstall && (
                    <div className="set-agent-more-body">
                      <p className="set-hint">
                        以下引擎尚未接入，暂不能发送任务。
                      </p>
                      <div className="set-hcards set-pending-hcards">
                        {HARNESSES.filter((h) => !h.ready).map((h) => (
                          <div key={h.id} className="set-hcard" data-pending>
                            <span className="set-hcard-side" style={{ '--h-color': h.color } as React.CSSProperties}>
                              <i style={{ maskImage: `url(${h.icon})`, WebkitMaskImage: `url(${h.icon})` }} />
                            </span>
                            <div className="set-agent-who">
                              <b>{h.name}</b>
                              <small>接入后可使用 {h.models.length} 个模型</small>
                            </div>
                            <span className="set-agent-tag">待接入</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                <div className="set-card">
                <h4 className="set-subhead">连接</h4>
                <Row label="服务端点" hint="连接地址保存在本机，尚未验证连通性">
                  <Input aria-label="服务端点" className="set-endpoint" value={settings.harnessEndpoint} spellCheck={false}
                         onChange={(e) => set('harnessEndpoint', e.target.value)}
                         placeholder="http://127.0.0.1:8788/v1" />
                </Row>
                </div>

                <div className="set-card">
                <h4 className="set-subhead">模型偏好</h4>
                <p className="set-hint">
                  作用于 {harness.short} · {settings.model}；对话输入区的选择器可按模型单独调整，
                  这里的改动下次进入对话时生效。
                </p>
                <Row label="思考强度">
                  <Seg ariaLabel="默认思考强度" value={curPrefs.reasoning}
                       options={(Object.keys(REASONING_LABEL) as Reasoning[]).map((r) => ({ value: r, label: REASONING_LABEL[r] }))}
                       onChange={(v) => setPref({ reasoning: v as Reasoning })} />
                </Row>
                <Row label="上下文上限">
                  <Seg ariaLabel="默认上下文上限" value={String(curPrefs.context)}
                       options={CONTEXTS.map((c) => ({ value: String(c), label: `${c}K` }))}
                       onChange={(v) => setPref({ context: Number(v) as ModelPrefs['context'] })} />
                </Row>
                </div>
              </section>
            )}

            {/* 默认值还没有消费方，保留已有数据，界面不把它当作已生效能力。 */}
            {section === 'creation' && (
              <section className="set-sec">
                <div className="set-unavailable"><Clapperboard size={28} strokeWidth={1.4}/><h3>创作默认值正在接入</h3><p>现有项目和编辑器暂未读取这里的偏好。视频规格仍在场景编辑器中设置。</p><span>尚未生效</span></div>
                <div className="set-card"><h4 className="set-subhead">已保留的偏好</h4><p className="set-hint">原有选择仍保留在本机，接入前不会修改任何项目。</p><Row label="画幅 / 帧率 / 分辨率"><span className="num">{settings.aspectRatio} · {settings.fps} fps · {settings.resolution}</span></Row><Row label="循环播放"><span>{settings.previewLoop ? '开启' : '关闭'}</span></Row><Row label="时间显示"><span>{{timecode: '时间码', seconds: '秒数', frames: '帧数'}[settings.timeDisplay]}</span></Row><Row label="渲染完成提醒"><span>{settings.notifyOnRender ? '开启' : '关闭'}</span></Row></div>
              </section>
            )}

            {section === 'plugins' && (
              <section className="set-sec"><div className="set-unavailable"><Plug size={28} strokeWidth={1.4}/><h3>插件服务尚未接入</h3><p>扩展加载与管理能力接入后，可以在这里查看、配置和停用插件。</p><span>暂无可管理的插件</span></div></section>
            )}

            {section === 'lab' && (
              <section className="set-sec"><div className="set-unavailable"><Sparkles size={28} strokeWidth={1.4}/><h3>暂没有可启用的实验功能</h3><p>参考片库当前展示已有片段，参考视频分析开关尚未接入实际执行。</p><span>等待接入</span></div></section>
            )}

            {/* ── 数据与存储 ────────────────────────────────── */}
            {section === 'data' && (
              <section className="set-sec">
                <h3 className="set-sec-head">数据与存储</h3>

                <div className="set-card">
                <h4 className="set-subhead">本机占用</h4>
                <Row label="素材" hint="素材本体存在本机 IndexedDB，刷新与重启都在">
                  <span className="num">{stats ? `${stats.count} 项 · ${formatBytes(stats.bytes)}` : '读取中…'}</span>
                </Row>
                <Row label="设置与偏好" hint="存在本机 localStorage，不上传">
                  <span className="num">JSON · 约 {settingsBytes()} KB</span>
                </Row>

                </div>
                <div className="set-card">
                <h4 className="set-subhead">备份与恢复</h4>
                <Row label="导出设置" hint="下载 JSON：主题、壁纸（含自定义图）、偏好与对话默认（不含素材文件）">
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

                </div>
                <div className="set-card">
                <h4 className="set-subhead">清理</h4>
                <Row label="清除对话偏好" hint="思考强度与上下文上限回到默认（标准 · 64）">
                  <Button variant="outline" size="sm"
                          onClick={() => {
                            const had = clearModelPrefs()
                            setPrefs(loadPrefs())
                            setNotice(had ? '对话偏好已清除' : '本来就没有自定义偏好')
                          }}>
                    清除
                  </Button>
                </Row>
                <Row label="清空本地素材并重建"
                     hint="删掉你导入到本机的素材文件与索引，只重新种入内置素材。">
                  {!confirmWipe
                    ? <Button variant="destructive" size="sm" onClick={() => setConfirmWipe(true)}>清空…</Button>
                    : <Button variant="outline" size="sm" onClick={() => setConfirmWipe(false)}>取消</Button>}
                </Row>
                {confirmWipe && (
                  <div className="set-hint" role="alertdialog" aria-label="确认清空本地素材">
                    <p style={{ margin: '0 0 6px', color: 'var(--bad)' }}>
                      这一步会真的删除文件，不只是刷新列表：
                    </p>
                    <ul style={{ margin: '0 0 8px', paddingLeft: 18, lineHeight: 1.7 }}>
                      <li>本机 IndexedDB 里你导入的所有素材文件会被删除，<b>不可撤销</b>；</li>
                      <li>引用这些素材的项目与工作流可能因此缺文件；</li>
                      <li>内置素材会重新种入，设置与项目本身不受影响。</li>
                    </ul>
                    <Button variant="destructive" size="sm" onClick={onWipeLibrary}>
                      我明白，清空并重建
                    </Button>
                  </div>
                )}
                <Row label="恢复默认设置" hint="主题、壁纸、通用、引擎与模型、创作偏好全部回到默认值">
                  <Button variant="outline" size="sm"
                          onClick={() => {
                            if (!window.confirm('把所有设置恢复为默认值？壁纸与自定义图片也会被清掉。')) return
                            const next = normalizeSettings({ ...DEFAULT_SETTINGS })
                            onChange(next)
                            onThemeChange(next.theme)
                            setNotice('设置已恢复默认')
                          }}>
                    恢复默认
                  </Button>
                </Row>
                </div>
                {notice && <p className="set-notice">{notice}</p>}
              </section>
            )}

            {/* ── 关于与反馈 ────────────────────────────────── */}
            {section === 'about' && (
              <section className="set-sec">
                <h3 className="set-sec-head">关于与反馈</h3>
                <Row label="产品"><span>FengMotion Desktop</span></Row>
                <Row label="版本"><span className="num">v{APP_VERSION}</span></Row>
                <Row label="数据存放">
                  <span>素材存本机 IndexedDB；设置与会话偏好存 localStorage，不上传。</span>
                </Row>
                <Row label="引擎接入">
                  <span>DeepSeek 对话适配器可配置；视频 Agent 与渲染连接状态以工作台为准。</span>
                </Row>

                <div className="set-card">
                <h4 className="set-subhead">反馈</h4>
                <p className="set-hint">
                  邮件只预填收件地址、主题和版本号，不附带对话、项目或密钥；
                  要贴截图请自己添加。
                </p>
                <div className="set-links">
                  <Button variant="outline" size="sm" onClick={mailto}>
                    写邮件…
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => void copyEmail()}>
                    复制邮箱
                  </Button>
                  <Button variant="outline" size="sm" asChild><a href={FEEDBACK.issuesUrl} target="_blank" rel="noreferrer">在 GitHub 提 Issue…</a></Button>
                </div>
                <Row label="邮箱"><span className="num">{FEEDBACK.email}</span></Row>
                <Row label="仓库">
                  <a href={FEEDBACK.repoUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--acc)' }}>
                    {FEEDBACK.repoUrl.replace('https://', '')}
                  </a>
                </Row>
                <Row label="已有问题">
                  <a href={FEEDBACK.issuesListUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--acc)' }}>
                    查看 Issues
                  </a>
                </Row>
                </div>
                {notice && <p className="set-notice">{notice}</p>}
              </section>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** 「设置与偏好」占用量：真实量一下 localStorage 里的设置 JSON，不估算 */
function settingsBytes(): number {
  try {
    const raw = localStorage.getItem('fengmotion:settings') ?? ''
    return Math.max(1, Math.ceil(new TextEncoder().encode(raw).byteLength / 1024))
  } catch { return 0 }
}

/** 把图片压到长边 ≤ max：自定义壁纸要塞进 localStorage，原图动辄几 MB */
function downscaleImage(file: File, max: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('文件读不出来'))
    reader.onload = () => {
      const img = new Image()
      img.onerror = () => reject(new Error('不是可识别的图片'))
      img.onload = () => {
        const scale = Math.min(1, max / Math.max(img.width, img.height))
        const w = Math.max(1, Math.round(img.width * scale))
        const h = Math.max(1, Math.round(img.height * scale))
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d')
        if (!ctx) { reject(new Error('画布不可用')); return }
        ctx.drawImage(img, 0, 0, w, h)
        resolve(canvas.toDataURL('image/jpeg', 0.86))
      }
      img.src = String(reader.result)
    }
    reader.readAsDataURL(file)
  })
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
