import { ArrowUpRight, FileText, ListChecks, LoaderCircle, Film, ArrowRight } from 'lucide-react'
import type { StageState } from '@/data/stageVisual'
import { useHarnesses, availabilityOf } from '@/shell/useHarnesses'

export function MonitorStageEmpty({ stage, brief, correctionCount = 0, onDiscuss, onOpenExecution, onEdit, onRealRender, realRenderBusy, realRunning }: {
  stage: StageState; brief: string; correctionCount?: number; onDiscuss: () => void; onOpenExecution: () => void; onEdit: () => void
  realRunning?: boolean
  /** 提交一次真实渲染（会在项目目录里产出可播放的 mp4）；不传则不显示该入口 */
  onRealRender?: () => void
  realRenderBusy?: boolean
}) {
  /* 引擎可用性读真实探测，不写死。
     原来这里固定显示「Agent 尚未连接」——在 Agent 已经接入之后，
     那句话会让人以为做不了任何事（真机截图确认过）。 */
  const probe = useHarnesses()
  const agentReady = availabilityOf(probe, 'deepseek').state === 'available'
  const running = stage.lastRunStatus === 'running'
  const title = running ? '制作记录正在更新' : stage.lastRunStatus === 'failed' ? '制作遇到了问题' : stage.lastRunStatus === 'cancelled' ? '已暂停这次制作' : '等待第一份画面'
  const status = running ? (realRunning ? '正在制作' : '演示执行中') : stage.lastRunStatus === 'failed' ? '运行未完成' : stage.lastRunStatus === 'cancelled' ? '运行已停止' : stage.hasRun ? '已有演示记录 · 暂无预览' : '尚未开始制作'
  return <div className="wb-preflight wb-studio-preflight" aria-live="polite">
    <div className="wb-waiting-stage">
      <div className="wb-waiting-state"><span className={running ? 'is-running' : ''}/>{status}</div>
      <div className="wb-waiting-content">
        <div className="wb-waiting-symbol" aria-hidden="true">{running ? <LoaderCircle size={30} className="animate-spin"/> : <Film size={30} strokeWidth={1.3}/>}</div>
        <h2>{title}</h2>
        <p>{running ? (realRunning ? '正在处理制作任务。' : '演示正在记录制作过程，你可以继续补充要求。') : '从一个场景开始，让想法有具体的样子。'}</p>
        <div className="wb-waiting-actions">
          <button type="button" className="wb-start-editor" onClick={onEdit}>打开场景编辑器<ArrowRight size={15}/></button>
          <button type="button" className="wb-view-execution" onClick={onOpenExecution}><ListChecks size={14}/>制作记录</button>
          {/* 真实渲染：与「制作记录」里的演示任务区分开，文案直说「真实」。
              这是目前唯一能真的产出一个 mp4 的入口。 */}
          {onRealRender && (
            <button type="button" className="wb-view-execution" onClick={onRealRender}
                    disabled={realRenderBusy}>
              {realRenderBusy ? <LoaderCircle size={14} className="animate-spin"/> : <Film size={14}/>}
              {realRenderBusy ? '正在提交…' : '真实渲染预览'}
            </button>
          )}
        </div>
      </div>
      <span className="wb-waiting-caption">画面预览</span>
    </div>
    <section className="wb-studio-brief">
      <div className="wb-studio-brief-head"><span><FileText size={14}/>创作简报</span><button type="button" onClick={onDiscuss}>查看要求<ArrowUpRight size={13}/></button></div>
      <p>{brief.trim() || '还没有制作要求。写下你想做什么，以及希望观众看到什么。'}</p>
      {correctionCount > 0 && <button type="button" className="wb-studio-corrections" onClick={onDiscuss}>{correctionCount} 条后续纠正<ArrowUpRight size={12}/></button>}
    </section>
    <div className="wb-studio-availability" data-ready={agentReady || undefined}>
      <span/>{agentReady
        ? 'Agent 已连接，可以让它开始制作。'
        : 'Agent 尚未连接，当前可使用本机场景编辑与导出。'}
    </div>
  </div>
}
