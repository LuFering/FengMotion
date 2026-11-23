import '@/features/settings/styles/settings-page-chrome.css'
import { setHarnessSelection } from '@/features/harness/hooks/useHarnessSelection'
import { UiIcon, SemIcons } from '@/shared/icons/UiIcon'
import { CpuChip01, Database01, Film01, HelpCircle, Palette, PuzzlePiece01, Sliders01, Star01 } from '@untitledui/icons'
import { useEffect, useRef, useState } from 'react'
import '@/features/settings/styles/settings-refined.css'
import { HARNESSES, DEFAULT_PREFS, prefsKey, loadPrefs, savePrefs, type ModelPrefs } from '@/features/harness/model/harnesses'
import { assetStats } from '@/features/assets/services/assetApiService'
import { resetLibrary } from '@/features/assets/services/assetService'
import { type Settings, type ThemeId, type WallpaperId, FEEDBACK, applyBackup, readBackup } from '@/features/settings/model/settings-model'
import { useHarnesses, availabilityOf, modelsOf } from '@/features/harness/hooks/useHarnesses'
import { Dialog, DialogContent, DialogTitle } from '@/shared/ui/dialog'
import { Button } from '@/shared/ui/button'
import pkg from '../../../package.json'
import { Row, Seg } from '@/features/settings/components/SettingsParts'
import { SettingsDataSection } from '@/features/settings/components/SettingsDataSection'
import { SettingsAiSection } from '@/features/settings/components/SettingsAiSection'
import { SettingsAppearanceSection } from '@/features/settings/components/SettingsAppearanceSection'

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

export type { Settings, ThemeId } from '@/features/settings/model/settings-model'

type SectionId =
  | 'general' | 'appearance' | 'ai' | 'creation'
  | 'plugins' | 'lab' | 'data' | 'about'

/* pending：功能尚未接入，导航里归到「尚未接入」小标签下弱化显示（settings-ui 契约 §2） */
const SECTIONS: Array<{ id: SectionId; label: string; icon: string; pending?: true }> = [
  { id: 'general', label: '通用', icon: 'compass' },
  { id: 'appearance', label: '外观', icon: 'sun' },
  { id: 'ai', label: 'AI 与模型', icon: 'boxes' },
  { id: 'creation', label: '创作与预览', icon: 'clapperboard', pending: true },
  { id: 'plugins', label: '插件', icon: 'ungroup', pending: true },
  { id: 'lab', label: '实验室', icon: 'sparkles', pending: true },
  { id: 'data', label: '数据与存储', icon: 'cylinder' },
  { id: 'about', label: '关于与反馈', icon: 'circle-help' },
]

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
  /* 统计读服务端素材库：素材页已经迁到服务端，这里若还读 IndexedDB，
     用户在设置里看到的条数会和素材页对不上。 */
  const refreshStats = () => {
    void assetStats()
      .then((s) => setStats(s))
      .catch(() => setStats(null))
  }

  /* 弹窗打开时重置本地状态。setState 放进微任务：
     直接在 effect 里同步 setState 会触发级联渲染（react 规则 set-state-in-effect）。 */
  useEffect(() => {
    if (!open) return
    let cancelled = false
    void Promise.resolve().then(() => {
      if (cancelled) return
      setPrefs(loadPrefs())
      setNotice('')
      setConfirmWipe(false)
      refreshStats()
    })
    return () => {
      cancelled = true
    }
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

  /**
   * 清空**浏览器里的旧素材索引**（IndexedDB）。
   *
   * 注意范围：素材库已迁到服务端，这个操作**不会删除服务端素材**。
   * 界面上必须把这件事说清楚 —— 否则用户点完看到「已清空」，
   * 回到素材页发现文件都还在，会以为清空失效或者删错了地方。
   */
  const onWipeLibrary = async () => {
    setNotice('正在清空浏览器中的旧素材索引…')
    try {
      await resetLibrary()
      refreshStats()
      setConfirmWipe(false)
      setNotice('已清空浏览器中的旧素材索引；素材库里的文件不受影响')
    } catch (err) {
      setNotice(`清空失败：${err instanceof Error ? err.message : '未知错误'}`)
    }
  }

  const set = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    onChange({ ...settings, [key]: value })

  const harness = HARNESSES.find((h) => h.id === settings.harness) ?? HARNESSES[0]
  /**
   * 引擎可用性按**真实探测**判定（`/api/capabilities` 的 agent 项 + `/api/harnesses`），
   * 不用本地 `h.ready`（那是演示数据，会把「未接入」说成「已接入」）。
   */
  const probe = useHarnesses()
  const stateOf = (id: string) => availabilityOf(probe, id)
  const connectedHarnesses = HARNESSES.filter((h) => stateOf(h.id).state === 'available')
  const pendingHarnesses = HARNESSES.filter((h) => stateOf(h.id).state !== 'available')
  /**
   * 模型列表以**后端目录**为准（`/api/harnesses/{id}/models`）。
   *
   * 不用本地 `h.models`：本地那份是产品侧写的模型名（deepseek-chat 等），
   * 而 DSH 路由里实际只有 deepseek-v4.1-flash（后端实测）。选一个不存在的模型必然失败。
   */
  const modelsFor = (harnessId: string) => modelsOf(probe, harnessId)

  const pickHarness = (id: string) => {
    const h = HARNESSES.find((x) => x.id === id)
    if (!h) return
    const models = modelsFor(id).models
    const chosen = models.find((m) => m.id === settings.model) ?? models.find((m) => m.default) ?? models[0]
    if (!chosen) return
    setHarnessSelection({ harness: id, model: chosen.id, reasoningEffort: undefined })
    onChange({ ...settings, harness: id, model: chosen.id })
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
  const filteredSections = SECTIONS.filter((s) => s.label.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  const navIcons = { general: Sliders01, appearance: Palette, ai: CpuChip01, creation: Film01, plugins: PuzzlePiece01, lab: Star01, data: Database01, about: HelpCircle }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="set-dlg set-refined" showCloseButton aria-describedby={undefined}
                     onOpenAutoFocus={(e) => {
                       /* 不让焦点抢到「查找设置分类」：落在当前分区的导航项上 */
                       e.preventDefault()
                       document.querySelector<HTMLElement>('.set-refined .set-nav-item[data-on]')?.focus()
                     }}>
        <div className="set-dlg-head">
          <UiIcon icon={SemIcons.settings} size="md" /><DialogTitle className="set-dlg-title">设置</DialogTitle>
        </div>

        <div className="set-dlg-body">
          <nav className="set-nav" aria-label="设置分区">
            <div className="set-nav-search"><UiIcon icon={SemIcons.search} size="sm" /><input aria-label="查找设置分类" placeholder="查找设置分类" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape' && query) { e.stopPropagation(); setQuery('') } if (e.key === 'Enter' && filteredSections[0]) { setSection(filteredSections[0].id); setQuery('') } }}/></div>
            {(() => {
              const item = (s: (typeof SECTIONS)[number]) => {
                const NavIcon = navIcons[s.id]
                return <button key={s.id} type="button" className="set-nav-item"
                        data-on={section === s.id || undefined}
                        data-pending={s.pending || undefined}
                        aria-current={section === s.id ? 'true' : undefined}
                        onClick={() => { setSection(s.id); setNotice(''); setConfirmWipe(false) }}>
                  <NavIcon size={16} />
                  <span className="set-nav-txt">
                    <b>{s.label}</b>
                  </span>
                </button>
              }
              const ready = filteredSections.filter((s) => !s.pending)
              const later = filteredSections.filter((s) => s.pending)
              return <>
                {ready.map(item)}
                {later.length > 0 && <p className="set-nav-label">尚未接入</p>}
                {later.map(item)}
              </>
            })()}
            {filteredSections.length === 0 && <p className="set-search-empty">没有匹配的分类</p>}
          </nav>

          {/* 分区标题已移除：用 aria-label 保留给读屏软件的分区名 */}
          <div className="set-panel" key={section} role="region" aria-label={activeSection.label}>
            {/* ── 通用 ─────────────────────────────────────── */}
            {section === 'general' && (
              <section className="set-sec">
                <div className="set-group">
                <h4 className="set-subhead">启动</h4>
                <Row label="启动时打开">
                  <Seg ariaLabel="启动时打开" value={settings.startView}
                       options={[{ value: 'home', label: '首页' }, { value: 'conversation', label: '我的创作' }]}
                       onChange={(v) => set('startView', v as Settings['startView'])} />
                </Row>
                </div>

                <div className="set-group">
                  <h4 className="set-subhead">快捷键<small>暂不可自定义</small></h4>
                  <div className="set-keys">
                    {SHORTCUTS.map((k) => (
                      <div className="set-key" key={`${k.area}-${k.name}`}>
                        {/* 左：名称 + 作用范围两行；右：按键。范围原先夹在名称和按键之间，像一段无关灰字 */}
                        <span className="set-key-name">{k.name}<em>{k.area}</em></span>
                        <span className="set-key-keys">{k.keys.map((key) => <kbd key={key}>{key}</kbd>)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </section>
            )}

            {/* ── 外观 ─────────────────────────────────────── */}
            {section === 'appearance' && (
              <SettingsAppearanceSection
                onChange={onChange}
                onPickWallpaper={onPickWallpaper}
                onThemeChange={onThemeChange}
                set={set}
                settings={settings}
                wallInputRef={wallInputRef}
                wallPreview={wallPreview}
              />
            )}

            {/* ── AI 与模型 ─────────────────────────────────── */}
            {section === 'ai' && (
              <SettingsAiSection
                connectedHarnesses={connectedHarnesses}
                curPrefs={curPrefs}
                modelsFor={modelsFor}
                onChange={onChange}
                pendingHarnesses={pendingHarnesses}
                pickHarness={pickHarness}
                pickOpen={pickOpen}
                probe={probe}
                set={set}
                setPickOpen={setPickOpen}
                setPref={setPref}
                setShowInstall={setShowInstall}
                settings={settings}
                showInstall={showInstall}
                stateOf={stateOf}
              />
            )}

            {/* 默认值还没有消费方，保留已有数据，界面不把它当作已生效能力。 */}
            {section === 'creation' && (
              <section className="set-sec">
                <div className="set-unavailable"><UiIcon icon={SemIcons.film} size="xl" /><h3>创作默认值尚未生效</h3><p>视频规格仍在场景编辑器中设置。</p></div>
                <div className="set-group"><h4 className="set-subhead">已保留的偏好</h4><Row label="画幅 / 帧率 / 分辨率"><span className="num">{settings.aspectRatio} · {settings.fps} fps · {settings.resolution}</span></Row><Row label="循环播放"><span>{settings.previewLoop ? '开启' : '关闭'}</span></Row><Row label="时间显示"><span>{{timecode: '时间码', seconds: '秒数', frames: '帧数'}[settings.timeDisplay]}</span></Row><Row label="渲染完成提醒"><span>{settings.notifyOnRender ? '开启' : '关闭'}</span></Row></div>
              </section>
            )}

            {section === 'plugins' && (
              <section className="set-sec"><div className="set-unavailable"><UiIcon icon={PuzzlePiece01} size="xl" /><h3>插件服务尚未接入</h3><p>还没有插件机制，这里暂无可安装或启停的内容。</p></div></section>
            )}

            {section === 'lab' && (
              <section className="set-sec"><div className="set-unavailable"><UiIcon icon={Star01} size="xl" /><h3>暂没有可启用的实验功能</h3><p>实验开关只在对应功能真正可用时出现，不提供无效开关。</p></div></section>
            )}

            {/* ── 数据与存储 ────────────────────────────────── */}
            {section === 'data' && (
              <SettingsDataSection
                backupInputRef={backupInputRef}
                confirmWipe={confirmWipe}
                notice={notice}
                onChange={onChange}
                onPickBackup={onPickBackup}
                onThemeChange={onThemeChange}
                onWipeLibrary={onWipeLibrary}
                setConfirmWipe={setConfirmWipe}
                setNotice={setNotice}
                setPrefs={setPrefs}
                settings={settings}
                stats={stats}
              />
            )}

            {/* ── 关于与反馈 ────────────────────────────────── */}
            {section === 'about' && (
              <section className="set-sec">
                <div className="set-group">
                <h4 className="set-subhead">应用</h4>
                <Row label="产品"><span>FengMotion Desktop</span></Row>
                <Row label="版本"><span className="num">v{APP_VERSION}</span></Row>
                <Row label="数据存放">
                  <span>本机，不上传</span>
                </Row>
                </div>

                <div className="set-group">
                <h4 className="set-subhead">反馈</h4>
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
