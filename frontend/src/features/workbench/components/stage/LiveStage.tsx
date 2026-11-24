import { useState } from 'react'
import type { LiveAiSubmit } from '@/api/sourceRender'
import { UiIcon, SemIcons } from '@/shared/icons/UiIcon'
import { FlipBackward } from '@untitledui/icons'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shared/ui/tooltip'
import type { LivePreview } from '@/features/workbench/hooks/stage/useLivePreview'
import { toTimecode } from '@/features/workbench/model/liveEdit'
import { LiveEditBar, type DrawerId } from '@/features/workbench/components/stage/live-edit/LiveEditBar'
import '@/features/workbench/styles/workbench/live-stage.css'

/**
 * 实时画面：iframe 里运行项目源码（见 frontend/live-preview），外层放播放条、工作稿改动胶囊、状态与报错，
 * 选中元素后弹出微型工具条（LiveEditBar）。
 *
 * <p>播放条的形态与成片播放器一致（悬浮胶囊、36px 圆钮、18px 白色图标、等宽时间码）；
 * 源码改了预览窗口会自己刷新并停回原来那一帧、选回原来的元素。</p>
 */
export function LiveStage({ live, onAskAi, busy, onRender, renderBusy }: {
  live: LivePreview
  /** 交给 AI：工作台的提交入口；返回是否已提交 */
  onAskAi: LiveAiSubmit
  busy: boolean
  /** 出片：渲染当前工作稿，生成新版本 */
  onRender: () => void
  renderBusy: boolean
}) {
  const ratio = live.meta ? live.meta.width / live.meta.height : 16 / 9
  const [errorOpen, setErrorOpen] = useState(true)
  /* 抽屉跟着「点中的那个元素」：写回源码后画面刷新、元素被选回来，抽屉还开着 */
  const [drawerState, setDrawerState] = useState<{ key: string; id: DrawerId | null } | null>(null)
  const selKey = live.selection?.kind === 'element' ? live.selection.element.chain[0]?.src ?? 'el' : live.selection ? 'region' : null
  const drawer = drawerState && drawerState.key === selKey ? drawerState.id : null
  const setDrawer = (id: DrawerId | null) => setDrawerState(selKey ? { key: selKey, id } : null)

  const error = live.buildError ?? live.runtimeError
  const errorKind = live.buildError ? '编译失败' : '画面运行出错'
  const total = live.meta ? live.meta.durationInFrames : 0
  const progress = total > 1 ? live.frame / (total - 1) : 0

  return (
    <div className="fw-live" style={{ '--live-ratio': ratio } as React.CSSProperties}>
      {live.url && (
        <iframe ref={live.bindFrame} src={live.url} className="fw-live-frame" title="工程实时预览"
                /* 不同来源 + sandbox：工程代码拿不到应用页面和桌面接口 */
                sandbox="allow-scripts allow-same-origin" allow="autoplay; fullscreen" />
      )}

      {(!live.meta || live.reloading) && !live.missing && (
        <div className="fw-live-veil" data-soft={live.reloading || undefined} role="status">
          <UiIcon icon={SemIcons.loading} size="sm" className="fw-live-spin" />
          {live.reloading ? '源码已更新' : '正在运行工程源码…'}
        </div>
      )}
      {live.missing && <div className="fw-live-veil" role="alert">找不到要预览的画面；工程里只有 {live.missing.join('、') || '（无）'}</div>}

      {/* 工作稿改动：写回过源码就出现；出片才生成新版本 */}
      {(live.worktree?.dirty ?? live.edits > 0) && (
        <div className="fw-live-edits" role="status">
          <span className="fw-live-edits-dot" aria-hidden="true" />
          <span>工作稿 · 有未出片的改动</span>
          <Tooltip delayDuration={350}>
            <TooltipTrigger asChild>
              <button type="button" className="fw-live-edits-btn" aria-label="撤销" disabled={live.commit.pending || live.edits === 0} onClick={live.undo}>
                <UiIcon icon={FlipBackward} size="xs" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={6}>撤销上一处修改（⌘Z）</TooltipContent>
          </Tooltip>
          <button type="button" className="fw-live-edits-render" disabled={renderBusy || live.commit.pending} onClick={onRender}>
            {renderBusy ? '出片中…' : '出片'}
          </button>
        </div>
      )}

      {error && errorOpen && (
        <div className="fw-live-error" role="alert">
          <div className="fw-live-error-head">
            <UiIcon icon={SemIcons.error} size="sm" />
            <span>{errorKind}{live.buildError ? ' · 画面停在上一次成功的结果' : ''}</span>
            <button type="button" className="fw-live-x" aria-label="收起" onClick={() => setErrorOpen(false)}>
              <UiIcon icon={SemIcons.close} size="xs" />
            </button>
          </div>
          <pre className="fw-live-error-body">{error}</pre>
          <button type="button" className="fw-live-btn" disabled={busy}
                  onClick={() => void onAskAi(`工程源码${errorKind}，请修复，不要改动其他画面：\n${error}`)}>
            交给 AI 修复
          </button>
        </div>
      )}
      {error && !errorOpen && (
        <button type="button" className="fw-live-error-pill" onClick={() => setErrorOpen(true)}>
          <UiIcon icon={SemIcons.error} size="xs" />{errorKind}
        </button>
      )}

      {/* 只留读数（打磨方案 §5 第 2 条）：播放、逐帧、定位都在时间线顶栏，这里是一根进度细线 + 右下角读数，不接收点击 */}
      {live.meta && (
        <div className="fw-live-readout" aria-hidden="true">
          <span className="fw-live-line"><i style={{ width: `${progress * 100}%` }} /></span>
          <span className="fw-live-time num">{toTimecode(live.frame, live.fps)}<em> / {toTimecode(Math.max(0, total - 1), live.fps)}</em></span>
        </div>
      )}

      <LiveEditBar live={live} drawer={drawer} setDrawer={setDrawer} onAskAi={onAskAi} busy={busy} />
    </div>
  )
}
