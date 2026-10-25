import { useEffect, useState } from 'react'
import { Player } from '@remotion/player'
import { Check, RotateCcw, SlidersHorizontal, X } from 'lucide-react'
import { EditableShot, type EditableShotSettings, type ShotMotion } from '@/remotion/EditableShot'

export function RemotionEditPreview({ settings, poster }: {
  settings: EditableShotSettings; poster?: string
}) {
  const durationInFrames = Math.max(30, Math.round(settings.durationSeconds * 30))
  return (
    <div className="fw-remotion-preview">
      <Player
        component={EditableShot}
        inputProps={{ ...settings, poster }}
        durationInFrames={durationInFrames}
        compositionWidth={1920}
        compositionHeight={1080}
        fps={30}
        controls
        loop
        acknowledgeRemotionLicense
        style={{ width: '100%', height: '100%' }}
      />
    </div>
  )
}

export function RemotionEditPanel({ settings, savedAt, isOverridden, onApply, onReset, onClose }: {
  settings: EditableShotSettings
  savedAt: string
  isOverridden: boolean
  onApply: (settings: EditableShotSettings) => void
  onReset: () => void
  onClose: () => void
}) {
  const [draft, setDraft] = useState(settings)
  const [copied, setCopied] = useState(false)
  useEffect(() => setDraft(settings), [settings])
  const update = <K extends keyof EditableShotSettings>(key: K, value: EditableShotSettings[K]) =>
    setDraft((d) => ({ ...d, [key]: value }))
  const changed = JSON.stringify(draft) !== JSON.stringify(settings)
  const copyProps = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(draft, null, 2))
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      setCopied(false)
    }
  }
  const exportProps = () => {
    const blob = new Blob([JSON.stringify(draft, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'shot-props.json'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="fw-scroll">
      <div className="flex flex-col gap-3 p-3.5">
        <div className="flex items-center gap-2">
          <SlidersHorizontal className="size-3.5 text-acc" />
          <div className="fw-scene-hd" style={{ margin: 0 }}>画面参数</div>
          <span className="spacer" />
          <button className="iconbtn" type="button" title="退出编辑" onClick={onClose}><X className="size-3.5" /></button>
        </div>
        <div className="flex items-center gap-2 text-[10.5px] text-dim">
          <span>{savedAt ? `本地已保存 · ${savedAt}` : '本地保存不可用'}</span>
          {isOverridden && <span className="fw-count">已修改</span>}
        </div>

        <label className="fw-edit-field">
          <span>标题</span>
          <input className="fw-edit-input" value={draft.title} onChange={(e) => update('title', e.target.value)} />
        </label>
        <label className="fw-edit-field">
          <span>副标题</span>
          <textarea className="fw-edit-input" rows={2} value={draft.subtitle} onChange={(e) => update('subtitle', e.target.value)} />
        </label>

        <div className="fw-edit-row">
          <label className="fw-edit-field">
            <span>强调色</span>
            <input className="fw-edit-color" type="color" value={draft.accent} onChange={(e) => update('accent', e.target.value)} />
          </label>
          <label className="fw-edit-field">
            <span>字号 · {draft.fontScale.toFixed(2)}×</span>
            <input type="range" min={0.7} max={1.4} step={0.05} value={draft.fontScale}
                   onChange={(e) => update('fontScale', Number(e.target.value))} />
          </label>
        </div>

        <div className="fw-edit-row">
          <label className="fw-edit-field">
            <span>动效</span>
            <select className="fw-edit-input" value={draft.motion} onChange={(e) => update('motion', e.target.value as ShotMotion)}>
              <option value="rise">上浮</option>
              <option value="fade">淡入</option>
              <option value="scale">缩放</option>
            </select>
          </label>
          <label className="fw-edit-field">
            <span>对齐</span>
            <select className="fw-edit-input" value={draft.align} onChange={(e) => update('align', e.target.value as 'left' | 'center')}>
              <option value="left">左对齐</option>
              <option value="center">居中</option>
            </select>
          </label>
        </div>

        <label className="fw-edit-field">
          <span>时长 · {draft.durationSeconds.toFixed(1)}s</span>
          <input type="range" min={2} max={12} step={0.5} value={draft.durationSeconds}
                 onChange={(e) => update('durationSeconds', Number(e.target.value))} />
        </label>

        <div className="flex gap-1.5">
          <button className="mini mini-strong h-8 flex-1" type="button" onClick={() => onApply(draft)}>
            <Check className="size-3" />应用到当前场景
          </button>
          <button className="mini h-8" type="button" onClick={() => setDraft(settings)} disabled={!changed}>
            <RotateCcw className="size-3" />撤销
          </button>
        </div>
        <div className="flex items-center gap-2">
          {isOverridden && <span className="fw-count">已应用修改</span>}
          <button className="mini h-7" type="button" onClick={onReset} disabled={!isOverridden}>恢复原参数</button>
          <span className="spacer" />
          <button className="mini h-7" type="button" onClick={onClose}>返回监看</button>
        </div>

        <details className="rounded-md border border-line bg-hole p-2">
          <summary className="cursor-pointer text-[10.5px] text-dim">查看全部参数</summary>
          <pre className="mt-2 overflow-auto text-[10px] leading-relaxed text-dim">{JSON.stringify(draft, null, 2)}</pre>
          <div className="mt-2 flex gap-1.5">
            <button className="mini h-7" type="button" onClick={copyProps}>{copied ? '已复制' : '复制 props'}</button>
            <button className="mini h-7" type="button" onClick={exportProps}>导出 JSON</button>
          </div>
        </details>
      </div>
    </div>
  )
}
