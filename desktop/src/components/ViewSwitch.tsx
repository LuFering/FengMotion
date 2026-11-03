/**
 * 视图切换器（对话 ⇄ 工作台）
 *
 * 对话视图与工作台是同一个会话的两种呈现（见 Conversation.tsx 顶部注释），
 * 所以两边必须能互相切过去，并且**按钮长得一样、落在同一个角落** ——
 * 否则切过去会像换了一个应用（作者反馈：「点工作台进去以后没有按钮回对话」）。
 *
 * 只做一件事：渲染两枚胶囊按钮 + 把点击转成 onSwitch(target)。
 * 具体跳哪个视图由调用方决定（对话视图走 onOpenWorkbench，工作台走 onNavigate）。
 */
export type ViewSwitchTarget = 'conversation' | 'workbench'

export function ViewSwitch({
  current, onSwitch, workbenchDisabled = false,
}: {
  current: ViewSwitchTarget
  onSwitch: (target: ViewSwitchTarget) => void
  /** 还没开始制作时工作台没有可看的内容，禁用而不是跳到一个空壳 */
  workbenchDisabled?: boolean
}) {
  const go = (target: ViewSwitchTarget) => {
    if (target === current) return
    if (target === 'workbench' && workbenchDisabled) return
    onSwitch(target)
  }
  const isCurrent = (target: ViewSwitchTarget) => (target === current ? 'page' : undefined)
  return (
    <div className="view-switch" role="group" aria-label="对话与工作台切换">
      <button type="button" aria-current={isCurrent('conversation')}
              title="回到对话，查看完整思考过程" onClick={() => go('conversation')}>
        对话
      </button>
      <button type="button" aria-current={isCurrent('workbench')}
              disabled={workbenchDisabled}
              title={workbenchDisabled ? '开始制作后可进入工作台' : '进入工作台，查看完整制作过程'}
              onClick={() => go('workbench')}>
        工作台
      </button>
    </div>
  )
}
