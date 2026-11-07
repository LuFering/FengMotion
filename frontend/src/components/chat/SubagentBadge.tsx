/**
 * 子代理徽标：会话里派过几个子代理，挂在标题左侧。
 *
 * ## 为什么需要它
 *
 * 子代理调用混在普通工具调用里，界面上一视同仁 —— 但「派了个分身去干别的活」
 * 和「跑一条 bash」不是一个量级：前者几十秒不回来，用户会以为卡住了。
 *
 * ## 为什么只显示次数，不显示「运行中 / 已完成」
 *
 * **拿不到**。这是实测结论，不是偷懒：
 *
 * - `subagent/catalog` 只是注册记录，字段只有 `childId` / `mode` / `label`，没有状态
 * - `subagent/end` 是内部 emit，**从不落成 session 事件**（一个含 50 次注册的
 *   真实会话里，它出现 0 次）
 * - `tool/result` 对 subagent 返回的是 `started subagent <id>` —— 表示「已派出」，
 *   不是「已完成」
 * - 完成状态只在 `subagentTiming` projection 里，而 projection 不走 session 事件流
 *
 * 第一版拿 `tool/result` 当完成信号，结果徽标显示「已完成」而正文同一时刻写着
 * 「子代理仍在运行」—— 自己骗自己。所以现在只陈述确定的事实：派过几次。
 *
 * ## 为什么只显示聚合计
 *
 * 一个任务可能并发派多个（实测单个会话 50 次注册）。标题栏放不下名字，
 * 而用户只需要知道「派过几个」。具体是谁、干了什么，工具列表里能看到。
 */
import { GitBranch } from 'lucide-react'
import './subagent-badge.css'

/** 从工具记录里挑出子代理调用。 */
export function pickSubagents(
  tools: { name: string; done?: boolean; isError?: boolean; arguments?: string }[] | undefined,
): { total: number; failed: number } {
  let total = 0
  let failed = 0
  for (const t of tools ?? []) {
    /* 工具名是 `subagent`；fork 变体是 `subagent_fork` 之类，用前缀匹配。
       不做大小写归一 —— 名字是 DSH 的契约，按原样比更安全。 */
    if (!t.name.startsWith('subagent')) continue
    total += 1
    /* isError 是可靠的：工具调用本身失败（例如参数不合法）。
       它说的是「没派出去」，不是「子代理失败了」—— 后者拿不到。 */
    if (t.isError) failed += 1
  }
  return { total, failed }
}

/**
 * 子代理徽标。
 *
 * @param tools 当前会话的工具调用记录（历史 + 本轮实时）
 */
export function SubagentBadge({
  tools,
}: {
  tools: { name: string; done?: boolean; isError?: boolean; arguments?: string }[] | undefined
}) {
  const { total, failed } = pickSubagents(tools)
  if (total === 0) return null

  /* 只区分「派出去了但有失败」和「都派出去了」两种。
     不区分运行中/已完成 —— 那个信息这一层拿不到。 */
  const state = failed > 0 ? 'failed' : 'ok'
  const label = failed > 0
    ? `派过 ${total} 个子代理，其中 ${failed} 个没派成功`
    : `派过 ${total} 个子代理`

  return (
    <span className="sub-badge" data-state={state} title={label}>
      <GitBranch size={12} aria-hidden="true" />
      <span className="sub-badge-num num">{total}</span>
    </span>
  )
}

export default SubagentBadge
