import { ArrowUpRight, FileText, ListChecks, LoaderCircle, Film, ArrowRight } from 'lucide-react'
import type { StageState } from '@/data/stageVisual'

export function MonitorStageEmpty({ stage, brief, correctionCount = 0, onDiscuss, onOpenExecution, onEdit }: {
  stage: StageState; brief: string; correctionCount?: number; onDiscuss: () => void; onOpenExecution: () => void; onEdit: () => void
}) {
  const running = stage.lastRunStatus === 'running'
  const title = running ? '制作记录正在更新' : stage.lastRunStatus === 'failed' ? '制作遇到了问题' : stage.lastRunStatus === 'cancelled' ? '已暂停这次制作' : '等待第一份画面'
  const status = running ? '演示执行中' : stage.lastRunStatus === 'failed' ? '运行未完成' : stage.lastRunStatus === 'cancelled' ? '运行已停止' : stage.hasRun ? '已有演示记录 · 暂无预览' : '尚未开始制作'
  return <div className="wb-preflight wb-studio-preflight" aria-live="polite">
    <div className="wb-waiting-stage">
      <div className="wb-waiting-state"><span className={running ? 'is-running' : ''}/>{status}</div>
      <div className="wb-waiting-content">
        <div className="wb-waiting-symbol" aria-hidden="true">{running ? <LoaderCircle size={30} className="animate-spin"/> : <Film size={30} strokeWidth={1.3}/>}</div>
        <h2>{title}</h2>
        <p>{running ? '演示正在记录制作过程，你可以继续补充要求。' : '从一个场景开始，让想法有具体的样子。'}</p>
        <div className="wb-waiting-actions">
          <button type="button" className="wb-start-editor" onClick={onEdit}>打开场景编辑器<ArrowRight size={15}/></button>
          <button type="button" className="wb-view-execution" onClick={onOpenExecution}><ListChecks size={14}/>制作记录</button>
        </div>
      </div>
      <span className="wb-waiting-caption">画面预览</span>
    </div>
    <section className="wb-studio-brief">
      <div className="wb-studio-brief-head"><span><FileText size={14}/>创作简报</span><button type="button" onClick={onDiscuss}>查看要求<ArrowUpRight size={13}/></button></div>
      <p>{brief.trim() || '还没有制作要求。写下你想做什么，以及希望观众看到什么。'}</p>
      {correctionCount > 0 && <button type="button" className="wb-studio-corrections" onClick={onDiscuss}>{correctionCount} 条后续纠正<ArrowUpRight size={12}/></button>}
    </section>
    <div className="wb-studio-availability"><span/>Agent 尚未连接，当前可使用本机场景编辑与导出。</div>
  </div>
}
