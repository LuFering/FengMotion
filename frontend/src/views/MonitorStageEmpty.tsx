import type { StageState } from '@/data/stageVisual'

/**
 * 监看画面区的空状态。
 *
 * <p>保留原来的画幅边界与外层结构（没有画面时仍是一块有边界的空场），
 * 只把「红框圈出的那几块」内容去掉：</p>
 * <ul>
 *   <li>左上角「尚未开始制作」状态角标</li>
 *   <li>标题下方那句引导说明</li>
 *   <li>「打开场景编辑器 / 制作记录 / 开始制作」按钮排</li>
 *   <li>右下角「画面预览」角标</li>
 *   <li>底部整块「创作简报」（含「查看要求」与「Agent 已连接」行）</li>
 * </ul>
 *
 * <p>为什么不删这些：写要求与发起制作在左侧对话栏已有完整路径，
 * 这里再给一份入口，用户反而不知道该点哪个；一份空简报也只重复了
 * 「还没有制作要求」这句已经说过的话。</p>
 *
 * <p>标题与图标保留 —— 它回答的是「这块区域是什么、现在处于什么状态」，
 * 不是又一个动作入口。</p>
 */
export function MonitorStageEmpty({ stage, realRunning }: {
  stage: StageState
  /** 真实任务在跑（与演示执行区分）：只影响标题文案 */
  realRunning?: boolean
  /* 以下参数保留在签名里，调用方继续按原形状传参（内容已不再渲染） */
  brief?: string
  correctionCount?: number
  onDiscuss?: () => void
  onOpenExecution?: () => void
  onEdit?: () => void
  onRealRender?: () => void
  realRenderBusy?: boolean
  renderTargetLabel?: string
}) {
  const running = stage.lastRunStatus === 'running'
  /* 真实任务在跑时用「正在制作」，演示执行时说明是演示 —— 两句话不能混成一句。 */
  const runningTitle = realRunning ? '正在制作第一份画面' : '正在制作第一份画面（演示）'
  const waiting = stage.lastRunStatus === 'awaiting_info'
  const title = running ? runningTitle
    : waiting ? '等待你补充制作要求'
      : stage.lastRunStatus === 'failed' ? '制作遇到了问题'
        : stage.lastRunStatus === 'cancelled' ? '已暂停这次制作'
          : '等待第一份画面'
  return (
    <div className="wb-preflight wb-studio-preflight" aria-live="polite">
      <div className="wb-waiting-stage">
        <div className="wb-waiting-content flex flex-col items-center justify-center">
          <h2 className="text-base font-medium text-[var(--tx2)]">{title}</h2>
          <p className="text-xs text-[var(--tx3)] mt-2 leading-relaxed">
            {waiting
              ? '在左侧控制台补充要求或提问，AI 将据此继续完善画面。'
              : running
              ? '画面生成后在这里播放。'
              : stage.lastRunStatus === 'failed'
              ? '可在左侧查看失败原因，调整要求后重试。'
              : stage.lastRunStatus === 'cancelled'
              ? '可在左侧查看制作记录，再决定如何继续。'
              : '在左侧提出制作要求。'}
          </p>
        </div>
      </div>
    </div>
  )
}
