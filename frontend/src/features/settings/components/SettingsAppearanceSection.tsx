import type * as React from 'react'
import { THEMES, WALLPAPERS, SCOPES } from '@/features/settings/model/settingsOptions'
import { UiIcon, SemIcons } from '@/shared/icons/UiIcon'
import { Icon, Row, Seg } from '@/features/settings/components/SettingsParts'
import { Button } from '@/shared/ui/button'
import { DEFAULT_SETTINGS, type WallpaperScope, type Settings, type ThemeId, type WallpaperId } from '@/features/settings/model/settings-model'
import { Slider } from '@/shared/ui/slider'
import { Checkbox } from '@/shared/ui/checkbox'

export interface SettingsAppearanceSectionProps {
  onChange: (next: Settings) => void
  onPickWallpaper: (e: React.ChangeEvent<HTMLInputElement>) => Promise<void>
  onThemeChange: (theme: ThemeId) => void
  set: <K extends keyof Settings>(key: K, value: Settings[K]) => void
  settings: Settings
  wallInputRef: React.RefObject<HTMLInputElement | null>
  wallPreview: (id: WallpaperId) => { dataWall: 'custom'; style: { backgroundImage: string } } | { dataWall: WallpaperId; style: undefined }
}

/** 设置页的外观分区：主题选择，壁纸（含自定义图片、显示范围与遮罩强度），以及减弱动效开关。 */
export function SettingsAppearanceSection({ onChange, onPickWallpaper, onThemeChange, set, settings, wallInputRef, wallPreview }: SettingsAppearanceSectionProps) {
  return (
    <section className="set-sec">
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
              {t.desc && <small>{t.desc}</small>}
            </span>
            {settings.theme === t.id && <UiIcon icon={SemIcons.check} size="sm" className="set-ck" />}
          </button>
        ))}
      </div>

      <div className="set-group">
      <h4 className="set-subhead">壁纸</h4>
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

      <Row label="显示范围">
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
      <div className="set-group">
      <h4 className="set-subhead">界面</h4>
      <Row label="减弱动效" hint="压平界面动画与过渡；低性能设备或容易晕动时开启">
        <Checkbox checked={settings.reduceMotion}
                  onCheckedChange={(v) => set('reduceMotion', v === true)}
                  aria-label="减弱动效" />
      </Row>
      </div>
    </section>
  )
}
