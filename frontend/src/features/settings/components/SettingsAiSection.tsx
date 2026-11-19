import type * as React from 'react'
import { Popover, PopoverTrigger, PopoverContent } from '@/shared/ui/popover'
import { Icon, Row, Seg } from '@/features/settings/components/SettingsParts'
import { setHarnessSelection } from '@/features/harness/hooks/useHarnessSelection'
import { UiIcon, SemIcons } from '@/shared/icons/UiIcon'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { REASONING_LABEL, type Reasoning, type ModelPrefs, type Harness } from '@/features/harness/model/harnesses'
import { CONTEXTS } from '@/features/settings/model/settingsOptions'
import type { HarnessModel, HarnessDescriptor } from '@/api/harnesses'
import type { Settings } from '@/features/settings/model/settings-model'
import type { DshAccess, HarnessListState, HarnessAvailability } from '@/features/harness/hooks/useHarnesses'

export interface SettingsAiSectionProps {
  connectedHarnesses: Harness[]
  curPrefs: ModelPrefs
  modelsFor: (harnessId: string) => { models: HarnessModel[]; source: 'server' | 'none' | 'unknown' }
  onChange: (next: Settings) => void
  pendingHarnesses: Harness[]
  pickHarness: (id: string) => void
  pickOpen: string | null
  probe: { refresh: (force?: boolean) => Promise<void>; access: DshAccess; listState: HarnessListState; harnesses: HarnessDescriptor[]; cachedAt: string | null; note: string | null; modelsByHarness: Record<string, HarnessModel[]> }
  set: <K extends keyof Settings>(key: K, value: Settings[K]) => void
  setPickOpen: React.Dispatch<React.SetStateAction<string | null>>
  setPref: (patch: Partial<ModelPrefs>) => void
  setShowInstall: React.Dispatch<React.SetStateAction<boolean>>
  settings: Settings
  showInstall: boolean
  stateOf: (id: string) => { state: HarnessAvailability; note: string | null }
}

/** 从 SettingsScreen.tsx 原样拆出的界面区块；props 与原处的变量同名。 */
export function SettingsAiSection({ connectedHarnesses, curPrefs, modelsFor, onChange, pendingHarnesses, pickHarness, pickOpen, probe, set, setPickOpen, setPref, setShowInstall, settings, showInstall, stateOf }: SettingsAiSectionProps) {
  return (
    <section className="set-sec">

      {/* 已接入引擎三列等宽排列，只渲染实际接入项。 */}
      <div className="set-hcards">
        {connectedHarnesses.map((h) => {
          const on = h.id === settings.harness
          return (
            <div key={h.id} className="set-hcard" data-on={on || undefined} title={stateOf(h.id).note ?? undefined}>
              {/* logo 占满卡片左侧整列（不再是一行里的小方块） */}
              <span className="set-hcard-side" style={{ '--h-color': h.color } as React.CSSProperties}>
                <i style={{ maskImage: `url(${h.icon})`, WebkitMaskImage: `url(${h.icon})` }} />
              </span>
              <div className="set-hcard-main">
                <div className="set-hcard-top">
                  <div className="set-agent-who">
                    <b>{h.name}</b>
                    <small>
                      <em data-ready />本机引擎已载入
                    </small>
                  </div>
                  <Popover modal open={pickOpen === h.id}
                           onOpenChange={(o) => setPickOpen(o ? h.id : null)}>
                    <PopoverTrigger asChild>
                      <button type="button" className="set-agent-pick"
                              aria-label={`${h.name} 的模型：${on ? settings.model : '默认'}`}>
                        <span className="set-agent-pick-ic" style={{ '--h-color': h.color } as React.CSSProperties}>
                          <i style={{ maskImage: `url(${h.icon})`, WebkitMaskImage: `url(${h.icon})` }} />
                        </span>
                        <span className="v">{on ? (modelsFor(h.id).models.find((m) => m.id === settings.model)?.label ?? '选择模型') : '选择模型'}</span>
                        <Icon name="chevron-down" className="ui-icon set-agent-pick-chev" />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent className="set-pick" align="start" sideOffset={6}>
                      <div className="set-pick-head">模型</div>
                      <div className="set-pick-list" role="listbox" aria-label={`${h.name} 的模型`}>
                        {modelsFor(h.id).models.map((m) => {
                          const cur = on && settings.model === m.id
                          return (
                            <button key={m.id} type="button" role="option" aria-selected={cur}
                                    className="set-pick-item" data-on={cur || undefined}
                                    onClick={() => {
                                      setHarnessSelection({ harness: h.id, model: m.id, reasoningEffort: undefined })
                                      onChange({ ...settings, harness: h.id, model: m.id })
                                      setPickOpen(null)
                                    }}>
                              <span className="set-pick-item-ic" style={{ '--h-color': h.color } as React.CSSProperties}>
                                <i style={{ maskImage: `url(${h.icon})`, WebkitMaskImage: `url(${h.icon})` }} />
                              </span>
                              <span className="set-pick-item-v">{m.label}</span>
                              {cur && <Icon name="check" className="ui-icon set-pick-item-ck" />}
                            </button>
                          )
                        })}
                      </div>
                    </PopoverContent>
                  </Popover>
                  {on ? <span className="set-default-engine"><UiIcon icon={SemIcons.check} size="xs" />默认</span> : <button type="button" className="set-default-engine" onClick={() => pickHarness(h.id)}>设为默认</button>}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* 待安装：未接入的引擎收在这里，展开看它需要什么。
          不是可有可无的装饰 —— 用户要知道「为什么它不在上面」。
          没有待接入引擎时整行不渲染：一个计数为 0 的折叠入口展开后什么也没有。 */}
      {pendingHarnesses.length > 0 && <div className="set-agent-more">
        <button type="button" className="set-agent-more-head"
                aria-expanded={showInstall || undefined}
                onClick={() => setShowInstall((v) => !v)}>
          <Icon name="download" />
          <span>待接入的引擎</span>
          <small>{pendingHarnesses.length}</small>
          <Icon name="chevron-down" className="ui-icon set-agent-more-chev" />
        </button>
        {showInstall && (
          <div className="set-agent-more-body">
            <p className="set-hint">
              以下引擎尚未接入，暂不能发送任务。
            </p>
            <div className="set-hcards set-pending-hcards">
              {pendingHarnesses.map((h) => (
                <div key={h.id} className="set-hcard" data-pending>
                  <span className="set-hcard-side" style={{ '--h-color': h.color } as React.CSSProperties}>
                    <i style={{ maskImage: `url(${h.icon})`, WebkitMaskImage: `url(${h.icon})` }} />
                  </span>
                  <div className="set-agent-who">
                    <b>{h.name}</b>
                    <small>
                      {stateOf(h.id).note ?? '未检测到可用引擎，请检查本机安装与配置。'}
                    </small>
                  </div>
                  <span className="set-agent-tag">待接入</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>}

      <div className="set-group">
      <h4 className="set-subhead">连接</h4>
      {/* 原来是一行灰字按钮夹在小标题和输入框之间，看起来像说明文字。
          改为一行正式设置：标签说明它做什么，右侧是按钮。 */}
      <Row label="本机引擎与模型">
        <Button variant="outline" size="sm" onClick={() => void probe.refresh(true)}>重新检测</Button>
      </Row>
      <Row label="服务端点" hint="尚未验证连通性">
        <Input aria-label="服务端点" className="set-endpoint" value={settings.harnessEndpoint} spellCheck={false}
               onChange={(e) => set('harnessEndpoint', e.target.value)}
               placeholder="http://127.0.0.1:8788/v1" />
      </Row>
      </div>

      <div className="set-group">
      <h4 className="set-subhead">模型偏好</h4>
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
  )
}
