import type * as React from 'react'
import { fmtSize, shortenDir } from '@/features/home/model/homeFormat'
import { HARNESSES, type ModelPrefs, type Harness } from '@/features/harness/model/harnesses'
import { AVAILABILITY_LABEL, type HarnessAvailability, type DshAccess, type HarnessListState } from '@/features/harness/hooks/useHarnesses'
import type { Attachment, Workdir } from '@/features/home/Home'
import type { HarnessModel, HarnessDescriptor } from '@/api/harnesses'

export interface HomeComposerProps {
  addFiles: (files: File[], forced?: Attachment['kind']) => void
  attachments: Attachment[]
  currentPrefs: ModelPrefs
  currentWorkdir: Workdir | null
  dirInputRef: React.RefObject<HTMLInputElement | null>
  draft: string
  dragging: boolean
  effectiveModel: string
  fileRef: React.RefObject<HTMLInputElement | null>
  harness: Harness
  harnessId: string
  harnessPane: string | null
  harnessState: { state: HarnessAvailability; note: string | null }
  harnessStateOf: (id: string) => { state: HarnessAvailability; note: string | null }
  imageRef: React.RefObject<HTMLInputElement | null>
  menu: 'workdir' | 'add' | 'harness' | 'intent' | null
  modelsOfHarness: (id: string) => { models: HarnessModel[]; source: 'server' | 'none' | 'unknown' }
  notReady: boolean
  phrase: string
  phraseChunks: RegExpMatchArray
  probe: { refresh: (force?: boolean) => Promise<void>; access: DshAccess; listState: HarnessListState; harnesses: HarnessDescriptor[]; cachedAt: string | null; note: string | null; modelsByHarness: Record<string, HarnessModel[]> }
  readyCount: number
  removeAttachment: (name: string, size: number) => void
  selectWorkdir: (path: string) => void
  send: () => Promise<void>
  setDraft: React.Dispatch<React.SetStateAction<string>>
  setDragging: React.Dispatch<React.SetStateAction<boolean>>
  setHarnessId: (harness: string) => void
  setHarnessPane: React.Dispatch<React.SetStateAction<string | null>>
  setMenu: React.Dispatch<React.SetStateAction<'workdir' | 'add' | 'harness' | 'intent' | null>>
  setModel: (model: string) => void
  setPref: (patch: Partial<ModelPrefs>) => void
  setWorkdirPath: React.Dispatch<React.SetStateAction<string | null>>
  startError: string
  startIntent: 'create' | 'chat'
  starting: boolean
  taRef: React.RefObject<HTMLTextAreaElement | null>
  toast: string
  videoRef: React.RefObject<HTMLInputElement | null>
  workdirPath: string | null
  workdirs: Workdir[]
}

/** 首页的需求输入框：文字与附件输入、工作目录选择、执行引擎与模型设置、发送按钮及下方的状态提示。 */
export function HomeComposer({ addFiles, attachments, currentPrefs, currentWorkdir, dirInputRef, draft, dragging, effectiveModel, fileRef, harness, harnessId, harnessPane, harnessState, harnessStateOf, imageRef, menu, modelsOfHarness, notReady, phrase, phraseChunks, probe, readyCount, removeAttachment, selectWorkdir, send, setDraft, setDragging, setHarnessId, setHarnessPane, setMenu, setModel, setPref, setWorkdirPath, startError, startIntent, starting, taRef, toast, videoRef, workdirPath, workdirs }: HomeComposerProps) {
  return (
    <div className="hf-sample">
      <div className="hf-composer" data-drag={dragging || undefined}
           inert={starting}
           style={{ '--brand': harness.color } as React.CSSProperties}
           onDragOver={(e) => {
             if (starting) return
             if (!e.dataTransfer.types.includes('Files')) return
             e.preventDefault()
             setDragging(true)
           }}
           onDragLeave={(e) => {
             /* 只有真正离开 composer 才收高亮，避免掠过子元素时闪 */
             if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
             setDragging(false)
           }}
           onDrop={(e) => {
             e.preventDefault()
             if (starting) return
             setDragging(false)
             const files = Array.from(e.dataTransfer.files ?? [])
             if (!files.length) return
             addFiles(files)
             setMenu(null)
           }}>
        {dragging && <div className="hf-dropmask" aria-hidden="true">松手添加为附件</div>}
        {attachments.length > 0 && (
          <div className="hf-chips">
            {attachments.map((a) => (
              <span className="hf-chip" key={`${a.kind}-${a.name}-${a.size}`}>
                <svg className="hf-chip-icon" viewBox="0 0 24 24" aria-hidden="true">
                  {a.kind === 'image'
                    ? <><rect x="3" y="4" width="18" height="16" rx="3" /><circle cx="9" cy="10" r="1.6" /><path d="M4 17l5-4 4 3 3-2 4 3" /></>
                    : a.kind === 'video'
                      ? <><rect x="3" y="5" width="18" height="14" rx="3" /><path d="M10 9l5 3-5 3z" /></>
                      : <><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /></>}
                </svg>
                <span className="hf-chip-name" title={a.name}>{a.name}</span>
                <span className="hf-chip-size">{fmtSize(a.size)}</span>
                <button type="button" onClick={() => removeAttachment(a.name, a.size)} aria-label={`移除 ${a.name}`}>
                  <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" /></svg>
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="hf-ta">
          <textarea ref={taRef} rows={1} value={draft}
                    disabled={starting}
                    placeholder=""
                    onChange={(e) => setDraft(e.target.value)}
                    onPaste={(e) => {
                      /* 截图粘贴 / 复制文件：有文件就走附件，纯文本交给默认行为 */
                      const files = Array.from(e.clipboardData?.files ?? [])
                      if (!files.length) return
                      e.preventDefault()
                      addFiles(files)
                    }}
                    onKeyDown={(e) => {
                      /* Enter 发送（与下方提示一致）；中文输入法组字中不触发，Shift+Enter 换行 */
                      if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                        e.preventDefault()
                        void send()
                      }
                    }}
                    aria-label="描述你想做的视频" />
          {!draft && (
            <div className="hf-ph" aria-hidden="true" key={phrase}>
              {phraseChunks.map((chunk, i) => (
                <span key={`${phrase}-${i}`} style={{ animationDelay: `${60 + i * 85}ms` }}>
                  {chunk}
                </span>
              ))}
            </div>
          )}
        </div>
        {toast && <div className="hf-toast" role="status">{toast}</div>}
        <div className="hf-toolbar">
          <div className="hf-btnwrap">
            <button className="hf-ibtn" type="button" title="添加附件" aria-expanded={menu === 'add'}
                    onClick={() => setMenu(menu === 'add' ? null : 'add')}>
              <svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg>
            </button>
            {menu === 'add' && (
              <div className="hf-menu">
                {/* 单行样式：左侧类型图标 + 名称，不接受更长的解释文字 */}
                <button type="button" onClick={() => fileRef.current?.click()}>
                  <svg className="hf-mi" viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /></svg>
                  <span>文件</span>
                </button>
                <button type="button" onClick={() => imageRef.current?.click()}>
                  <svg className="hf-mi" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="3" /><circle cx="9" cy="10" r="1.6" /><path d="M4 17l5-4 4 3 3-2 4 3" /></svg>
                  <span>图片</span>
                </button>
                <button type="button" onClick={() => videoRef.current?.click()}>
                  <svg className="hf-mi" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="3" /><path d="M10 9l5 3-5 3z" /></svg>
                  <span>视频</span>
                </button>
              </div>
            )}
          </div>
          <div className="hf-modewrap" data-open={menu === 'workdir' || undefined}>
            <button className="hf-modechip hf-workdir-chip" type="button" aria-expanded={menu === 'workdir'}
                    disabled={starting} onClick={() => setMenu(menu === 'workdir' ? null : 'workdir')}>
              <svg className="hf-folder" viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg>
              {/* 按钮显示当前目录名（超长截到 6 个字符加省略号），未选时才是「工作目录」 */}
              <span title={currentWorkdir ? currentWorkdir.path : undefined}>
                {currentWorkdir ? shortenDir(currentWorkdir.label) : startIntent === 'create' ? '新建项目' : '本页对话'}
              </span>
              <svg className="hf-chev" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6" /></svg>
            </button>
            {menu === 'workdir' && (
              <div className="hf-menu hf-workdir-menu">
                <div className="hf-wd-list">
                  <button type="button" className={workdirPath === null ? 'is-sel' : undefined} onClick={() => { setWorkdirPath(null); setMenu(null) }}>
                    <span>{startIntent === 'create' ? '新建视频项目' : '本页临时对话'}</span>
                  </button>
                  {workdirs.map((d) => (
                    <button key={d.path} type="button" className={workdirPath === d.path ? 'is-sel' : undefined}
                            title={d.path}
                            onClick={() => selectWorkdir(d.path)}>
                      <svg className="hf-wd-folder" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg>
                      <span>{d.label}</span><span className="hf-ck">✓</span>
                    </button>
                  ))}
                </div>
                <div className="hf-wd-sep" />
                <button type="button" className="hf-wd-add" onClick={() => dirInputRef.current?.click()}>
                  <svg className="hf-wd-plus" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
                  <span>添加工作目录…</span>
                </button>
              </div>
            )}
          </div>
          <span className="hf-spacer" />
          <span className="hf-count">{draft.length || ''}</span>
          <div className="hf-btnwrap hf-harnesswrap"
               data-connected={harnessState.state === 'available' || undefined}
               style={{ '--brand': harness.color } as React.CSSProperties}>
            {/* 引擎按钮：接入 = 绿点 + 引擎图标 | 模型名；未接入 = 黄点 + 引擎图标 + 未接入AI */}
            <button className="hf-harness" type="button" aria-haspopup="dialog"
                    data-off={notReady || undefined}
                    aria-expanded={menu === 'harness'} title={notReady ? '该引擎未接入' : '切换执行引擎'}
                    onClick={() => { setHarnessPane(null); setMenu(menu === 'harness' ? null : 'harness') }}>
              <span className="hf-harness-seg" data-off={notReady || undefined}>
                <i aria-hidden="true" />
                <span className="hf-harness-mark" aria-hidden="true"
                      style={{ '--brand': harness.color, maskImage: `url(${harness.icon})`, WebkitMaskImage: `url(${harness.icon})` } as React.CSSProperties} />
                {notReady ? <span className="hf-harness-off">未接入AI</span>
                  : <><span className="hf-harness-div" aria-hidden="true" /><span className="hf-harness-model">{effectiveModel}</span></>}
              </span>
              <svg className="hf-chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
            </button>
            {menu === 'harness' && (
              <div className="hf-harness-pop" role="dialog" aria-label="执行引擎" data-pane={harnessPane || undefined}>
                <div className="hf-hp-scroll">
                  {/* 一级：引擎列表；二级：该引擎的模型（从右侧滑入） */}
                  <div className="hf-hp-pane" data-active={harnessPane === null || undefined}>
                    <div className="hf-hp-head">
                      <b>执行引擎</b>
                      <span>
                        {probe.listState === 'loading' ? '正在探测…' : `${readyCount} 个已载入`}
                      </span>
                    </div>
                    <div className="hf-hp-list" role="listbox" aria-label="引擎">
                      {HARNESSES.map((h) => {
                        const state = harnessStateOf(h.id)
                        return (
                        <button key={h.id} type="button" className="hf-hp-item" role="option"
                                aria-selected={h.id === harnessId}
                                data-off={state.state !== 'available' || undefined}
                                title={state.note ?? undefined}
                                onClick={() => {
                                  setHarnessId(h.id)
                                  setModel(modelsOfHarness(h.id).models[0]?.id ?? '')
                                  setHarnessPane(h.id)
                                }}>
                          <span className="hf-hp-logo" aria-hidden="true"
                                style={{ '--brand': h.color, maskImage: `url(${h.icon})`, WebkitMaskImage: `url(${h.icon})` } as React.CSSProperties} />
                          <span className="hf-hp-txt">
                            <b style={{ color: h.color }}>{h.name}</b>
                            <small>{AVAILABILITY_LABEL[state.state]}{state.state === 'not_connected' ? '，仅展示' : ''}</small>
                          </span>
                          {h.id === harnessId && <span className="hf-hp-ck" aria-hidden="true">✓</span>}
                          <svg className="hf-hp-go" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
                        </button>
                        )
                      })}
                    </div>
                  </div>
                  <div className="hf-hp-pane hf-hp-models" data-active={harnessPane !== null || undefined}>
                    <div className="hf-hp-head">
                      <button type="button" className="hf-hp-back" onClick={() => setHarnessPane(null)}>
                        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>引擎
                      </button>
                      <b>{harness.name}</b>
                    </div>
                    <div className="hf-hp-list" role="listbox" aria-label="模型">
                      {modelsOfHarness(harness.id).models.map((m) => (
                        <div key={m.id} className="hf-hp-modelwrap" data-open={(effectiveModel === m.id && harnessPane !== null) || undefined}>
                          <button type="button" className="hf-hp-item hf-hp-model" role="option"
                                  aria-selected={m.id === effectiveModel} aria-expanded={effectiveModel === m.id && harnessPane !== null}
                                  onClick={() => setModel(m.id)}>
                            <span className="hf-hp-radio" aria-hidden="true" />
                            <span className="hf-hp-txt"><b>{m.label}</b></span>
                            <span className="hf-hp-ck" aria-hidden="true">✓</span>
                            <svg className="hf-hp-go hf-hp-go-down" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
                          </button>
                          {/* 选中模型下方展开的设置抽屉：思考强度 + 最大上下文 */}
                          {effectiveModel === m.id && harnessPane !== null && (
                            <div className="hf-hp-drawer">
                              <div className="hf-hp-row">
                                <span className="hf-hp-label">思考强度</span>
                                <div className="hf-hp-seg" role="radiogroup" aria-label="思考强度">
                                  {([['off', '关闭'], ['standard', '标准'], ['enhanced', '增强']] as const).map(([v, label]) => (
                                    <button key={v} type="button" role="radio" aria-checked={currentPrefs.reasoning === v}
                                            className={currentPrefs.reasoning === v ? 'on' : undefined}
                                            onClick={() => setPref({ reasoning: v })}>{label}</button>
                                  ))}
                                </div>
                              </div>
                              <div className="hf-hp-row">
                                <span className="hf-hp-label">最大上下文</span>
                                <div className="hf-hp-seg" role="radiogroup" aria-label="最大上下文">
                                  {([32, 64, 128] as const).map((v) => (
                                    <button key={v} type="button" role="radio" aria-checked={currentPrefs.context === v}
                                            className={currentPrefs.context === v ? 'on' : undefined}
                                            onClick={() => setPref({ context: v })}>{v}K</button>
                                  ))}
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
          <button className="hf-send" type="button" disabled={starting || notReady || (!draft.trim() && !attachments.length)}
                  title={starting ? '正在准备…' : notReady ? `${harness.name} 未接入` : startIntent === 'create' ? '准备制作：带入需求后确认发送' : '准备对话：不修改工程'}
                  onClick={() => void send()} aria-label={starting ? '正在准备' : startIntent === 'create' ? '准备制作' : '准备对话'}>
            <svg viewBox="0 0 24 24"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
          </button>
        </div>
      </div>
      {starting && <p className="hf-entry-status" role="status">正在准备项目与会话…</p>}
      {startError && <p className="hf-entry-error" role="alert">{startError}</p>}
      <div className="hf-sample-hint" data-off={notReady || undefined}>
        {notReady
          ? harnessState.state === 'misconfigured'
            ? `${harness.name} 配置有误，暂时不能发送`
            : harnessState.state === 'unknown'
              ? `${harness.name} 接入状态未知，暂时不能发送`
              : `${harness.name} 未接入，暂时不能发送`
          : 'Enter 继续 · Shift + Enter 换行 · 支持拖放 / 粘贴文件'}
      </div>
    </div>
  )
}
