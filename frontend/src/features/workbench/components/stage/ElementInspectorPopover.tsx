import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowUp, RefreshCw01, Scan, Stars02, Target04, Type01 } from '@untitledui/icons'
import { UiIcon, SemIcons } from '@/shared/icons/UiIcon'
import { formatMediaTime } from '@/features/workbench/model/previewGeometry'
import type { ElementInspector, InspectorTarget } from '@/features/workbench/hooks/stage/useElementInspector'
import type { NormRect } from '@/features/workbench/model/elementEdit'
import '@/features/workbench/styles/workbench/element-edit.css'

/** 小窗与落点之间的间距，以及离窗口边缘至少留多少 */
const GAP = 14
const EDGE = 12

/**
 * 点选画面后，在鼠标右侧弹出的属性小窗。
 *
 * <p>上半是属性（元素的文字可以直接改，时间、位置、版本只读），下半是「交给 AI」。
 * 挂到 body 上用 fixed 定位：画面框会裁掉溢出，放在里面靠近底边时小窗会被切掉一半。
 * 右侧放不下就翻到左侧，上下贴住窗口边缘。</p>
 */
export function ElementInspectorPopover({ inspector, fps }: { inspector: ElementInspector; fps: number }) {
  const { target, anchor } = inspector
  if (!target || !anchor) return null
  /* 换了选择就重建：文字草稿、AI 输入都属于上一个目标，不能带过来 */
  const key = target.kind === 'element' ? `e:${target.element.id}:${target.frame}`
    : target.kind === 'point' ? `p:${target.point.x}:${target.point.y}:${target.frame}`
      : `r:${target.rect.x}:${target.rect.y}:${target.rect.w}:${target.rect.h}:${target.frame}`
  return createPortal(<Popover key={key} inspector={inspector} target={target} anchor={anchor} fps={fps} />, document.body)
}

function Popover({ inspector, target, anchor, fps }: { inspector: ElementInspector; target: InspectorTarget; anchor: { x: number; y: number }; fps: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number; side: 'right' | 'left' } | null>(null)
  const original = target.kind === 'element' ? target.element.properties.text : ''
  const [text, setText] = useState(original)
  const [ask, setAsk] = useState('')

  /* 量自己的尺寸再定位；内容变高（报错、换行）时跟着重排 */
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const place = () => {
      const { width, height } = el.getBoundingClientRect()
      const right = anchor.x + GAP
      const side = right + width <= window.innerWidth - EDGE ? 'right' : 'left'
      const left = side === 'right' ? right : Math.max(EDGE, anchor.x - GAP - width)
      const top = Math.min(Math.max(EDGE, anchor.y - 24), window.innerHeight - height - EDGE)
      setPos({ left, top, side })
    }
    place()
    const observer = new ResizeObserver(place)
    observer.observe(el)
    window.addEventListener('resize', place)
    return () => { observer.disconnect(); window.removeEventListener('resize', place) }
  }, [anchor.x, anchor.y])

  const timeOf = (frame: number) => formatMediaTime(frame / fps)
  const pct = (n: number) => `${Math.round(n * 100)}%`
  const box: NormRect | null = target.kind === 'element' ? target.element.placement?.bounds ?? null
    : target.kind === 'region' ? target.rect : null

  const title = target.kind === 'element' ? target.element.label : target.kind === 'region' ? '框选区域' : '画面这一处'
  const icon = target.kind === 'element' ? Type01 : target.kind === 'region' ? Scan : Target04
  const changed = target.kind === 'element' && text !== original
  const canEdit = target.kind === 'element' && !inspector.editBlocked
  const sendAi = () => { if (ask.trim()) inspector.sendToAi(ask) }

  return (
    <div ref={ref} className="el-inspector" role="dialog" aria-label={`${title}的属性`}
         data-side={pos?.side} style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: -9999 }}
         onPointerDown={(e) => e.stopPropagation()}>
      <header className="el-insp-head">
        <span className="el-insp-icon"><UiIcon icon={icon} size="sm" /></span>
        <span className="el-insp-title">{title}</span>
        {target.kind === 'element' && <code className="el-insp-id">{target.element.id}</code>}
        <button type="button" className="el-insp-x" aria-label="关闭" title="关闭 (Esc)" onClick={inspector.close}>
          <UiIcon icon={SemIcons.close} size="xs" />
        </button>
      </header>

      <div className="el-insp-body">
        {target.kind === 'element' && (
          <label className="el-field el-field-text">
            <span className="el-field-k">文字</span>
            <textarea className="el-insp-input" value={text} rows={Math.min(4, Math.max(1, text.split('\n').length))}
                      maxLength={2000} disabled={!canEdit || inspector.saving}
                      onChange={(e) => setText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && changed) { e.preventDefault(); void inspector.applyText(text) }
                      }} />
          </label>
        )}
        <dl className="el-props">
          <div>
            <dt>时间</dt>
            <dd>
              {target.kind === 'element' && target.element.placement ? (
                <button type="button" className="el-link num" title="跳到元素出现的第一帧"
                        onClick={() => inspector.seekTo(target.element.placement!.startFrame)}>
                  {timeOf(target.element.placement.startFrame)} – {timeOf(target.element.placement.endFrame)}
                </button>
              ) : <span className="num">{timeOf(target.frame)}</span>}
            </dd>
          </div>
          <div>
            <dt>位置</dt>
            <dd className="num">
              {box
                ? `x ${pct(box.x)} · y ${pct(box.y)} · 宽 ${pct(box.w)} · 高 ${pct(box.h)}`
                : target.kind === 'point' ? `x ${pct(target.point.x)} · y ${pct(target.point.y)}` : '—'}
            </dd>
          </div>
          {inspector.version !== null && (
            <div>
              <dt>版本</dt>
              <dd>
                v{inspector.version}
                {inspector.declared ? <span className="el-ok"> · 已校验</span> : null}
                {!inspector.isLatest && <span className="el-dim"> · 历史版本</span>}
              </dd>
            </div>
          )}
        </dl>

        {/* 为什么不能直接改：一句话，不是红色报错 —— 交给 AI 仍然可用 */}
        {inspector.editBlocked && (target.kind !== 'element' || !inspector.declared || !inspector.isLatest) && (
          <p className="el-insp-note">{inspector.editBlocked}</p>
        )}
        {inspector.failure && (
          <p className="el-insp-fail" role="alert">
            <span>{inspector.failure.text}</span>
            {inspector.failure.reload && (
              <button type="button" className="el-mini-btn" onClick={inspector.reload}>
                <UiIcon icon={RefreshCw01} size="xs" />重新读取
              </button>
            )}
          </p>
        )}

        {target.kind === 'element' && (
          <div className="el-insp-actions">
            {inspector.saving ? (
              <span className="el-saving"><UiIcon icon={SemIcons.loading} size="xs" className="el-spin" />正在渲染新版本…</span>
            ) : (
              <>
                <button type="button" className="el-btn" data-variant="ghost" disabled={!changed} onClick={() => setText(original)}>还原</button>
                <button type="button" className="el-btn" data-variant="primary" disabled={!changed || !canEdit}
                        title={canEdit ? '渲染并生成新版本 (Ctrl+Enter)' : inspector.editBlocked}
                        onClick={() => void inspector.applyText(text)}>应用修改</button>
              </>
            )}
          </div>
        )}
      </div>

      {/* 交给 AI：一句话说怎么改，元素区域和当前画面一起挂上 */}
      <div className="el-insp-ai">
        <span className="el-insp-ai-k"><UiIcon icon={Stars02} size="xs" />交给 AI</span>
        <div className="el-ask">
          <textarea className="el-ask-input" value={ask} rows={1} placeholder="告诉 AI 怎么改…"
                    disabled={inspector.aiSending || inspector.saving}
                    onChange={(e) => setAsk(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); sendAi() }
                    }} />
          <button type="button" className="el-ask-send" aria-label="交给 AI" title="交给 AI (Enter)"
                  disabled={!ask.trim() || inspector.aiSending || inspector.saving} onClick={sendAi}>
            {inspector.aiSending
              ? <UiIcon icon={SemIcons.loading} size="xs" className="el-spin" />
              : <UiIcon icon={ArrowUp} size="xs" />}
          </button>
        </div>
      </div>
    </div>
  )
}
