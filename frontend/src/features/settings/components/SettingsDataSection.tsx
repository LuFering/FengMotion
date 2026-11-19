import type * as React from 'react'
import { Row } from '@/features/settings/components/SettingsParts'
import { formatBytes } from '@/features/assets/services/assetApiService'
import { settingsBytes } from '@/features/settings/model/settingsOptions'
import { Button } from '@/shared/ui/button'
import { downloadBackup, clearModelPrefs, normalizeSettings, DEFAULT_SETTINGS, type Settings, type ThemeId } from '@/features/settings/model/settings-model'
import { loadPrefs, type ModelPrefs } from '@/features/harness/model/harnesses'

export interface SettingsDataSectionProps {
  backupInputRef: React.RefObject<HTMLInputElement | null>
  confirmWipe: boolean
  notice: string
  onChange: (next: Settings) => void
  onPickBackup: (e: React.ChangeEvent<HTMLInputElement>) => Promise<void>
  onThemeChange: (theme: ThemeId) => void
  onWipeLibrary: () => Promise<void>
  setConfirmWipe: React.Dispatch<React.SetStateAction<boolean>>
  setNotice: React.Dispatch<React.SetStateAction<string>>
  setPrefs: React.Dispatch<React.SetStateAction<Record<string, ModelPrefs>>>
  settings: Settings
  stats: { count: number; bytes: number } | null
}

/** 设置页的数据分区：本机占用，设置的导出与导入，清除对话偏好、清空浏览器旧素材索引和恢复默认设置。 */
export function SettingsDataSection({ backupInputRef, confirmWipe, notice, onChange, onPickBackup, onThemeChange, onWipeLibrary, setConfirmWipe, setNotice, setPrefs, settings, stats }: SettingsDataSectionProps) {
  return (
    <section className="set-sec">

      <div className="set-group">
      <h4 className="set-subhead">本机占用</h4>
      <Row label="素材">
        <span className="num">{stats ? `${stats.count} 项 · ${formatBytes(stats.bytes)}` : '读取中…'}</span>
      </Row>
      <Row label="设置与偏好" hint="仅存本机，不上传">
        <span className="num">JSON · 约 {settingsBytes()} KB</span>
      </Row>

      </div>
      <div className="set-group">
      <h4 className="set-subhead">备份与恢复</h4>
      <Row label="导出设置" hint="不含素材文件">
        <Button variant="outline" size="sm"
                onClick={() => {
                  const name = downloadBackup(settings)
                  setNotice(`已导出 ${name}`)
                }}>
          导出…
        </Button>
      </Row>
      <Row label="导入设置">
        <Button variant="outline" size="sm" onClick={() => backupInputRef.current?.click()}>
          导入…
        </Button>
        <input ref={backupInputRef} type="file" accept="application/json,.json" hidden
               onChange={onPickBackup} />
      </Row>

      </div>
      <div className="set-group">
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
      <Row label="清空浏览器中的旧素材索引"
           hint="仅清除旧版存在浏览器里的素材数据，不删除素材库里的文件。">
        {!confirmWipe
          ? <Button variant="destructive" size="sm" onClick={() => setConfirmWipe(true)}>清空…</Button>
          : <Button variant="outline" size="sm" onClick={() => setConfirmWipe(false)}>取消</Button>}
      </Row>
      {confirmWipe && (
        <div className="set-hint" role="alertdialog" aria-label="确认清空本地素材">
          <p style={{ margin: '0 0 6px', color: 'var(--bad)' }}>
            这一步会删除浏览器里的旧素材数据，<b>不影响素材库</b>：
          </p>
          <ul style={{ margin: '0 0 8px', paddingLeft: 18, lineHeight: 1.7 }}>
            <li>浏览器 IndexedDB 里旧版存的素材文件会被删除，<b>不可撤销</b>；</li>
            <li>素材库（应用管理的目录）里的文件<b>不会</b>被删除，素材页仍然可用；</li>
            <li>如果还有旧素材没迁移，删掉后就再也迁移不过来了。</li>
          </ul>
          <Button variant="destructive" size="sm" onClick={onWipeLibrary}>
            我明白，清空旧索引
          </Button>
        </div>
      )}
      <Row label="恢复默认设置" hint="壁纸与自定义图片也会清除">
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
  )
}
