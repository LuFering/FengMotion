/**
 * 侧栏过程摘要的**纯逻辑**（无 JSX，可被 Node 测试直接导入）。
 *
 * <p>抽出来的原因：`.tsx` 含 JSX，纯 Node 的 strip-types 无法导入，
 * 于是「归组摘要」这类规则只能靠肉眼核对。放到 `.ts` 里就能直接测。</p>
 */

export interface ProcessToolCall {
  callId?: string
  name: string
  arguments?: string
  done?: boolean
  isError?: boolean
}

/** 把工具名说成人话 —— 侧栏空间小，英文函数名太占地方。 */
const TOOL_LABEL: Record<string, string> = {
  bash: '执行命令',
  read: '读取文件',
  write: '写入文件',
  edit: '编辑文件',
  web_fetch: '读取网页',
  web_search: '搜索网页',
  todo_write: '更新待办',
}

export function toolLabel(name: string): string {
  const key = name.toLowerCase()
  if (TOOL_LABEL[key]) return TOOL_LABEL[key]
  /* 未知工具保留原名：编一个中文名会让人以为它做了别的事 */
  return name
}

/**
 * 单步的执行状态 —— **缺失 `done` 不能当成完成**。
 *
 * <p>后端在工具开始时只写 `callId`/`name`/`arguments`，**不写 `done`**；
 * 只有收到对应结果事件才回填。所以 `done` 缺失意味着
 * 「不知道结果」，不是「已完成」。</p>
 *
 * <p>把它显示成「完成」是最坏的一种谎报：用户会以为这一步成功了，
 * 而实际可能是流中断、进程被杀、或结果事件没到。</p>
 */
export type ToolStepState = 'done' | 'running' | 'failed' | 'unknown'

export function toolStepState(
  t: { done?: boolean; isError?: boolean },
  /**
   * 这一轮是否仍在执行。
   *
   * <p>为什么需要它：实时流里开始帧只有 `arguments`、没有 `done`，
   * 而这一轮明显还在跑 —— 此时说「状态未知」也不准确，应该说「进行中」。
   * 反过来，这一轮**已经结束**却仍缺 `done`，那就真的是状态未知
   * （结果事件没到、流中断、进程被杀），不能猜成完成，也不必说进行中。</p>
   */
  roundRunning = false,
): ToolStepState {
  if (t.isError) return 'failed'
  if (t.done === true) return 'done'
  if (t.done === false) return 'running'
  /* 缺 done：本轮还在跑 → 进行中；本轮已结束 → 真的不知道 */
  return roundRunning ? 'running' : 'unknown'
}

/** 状态的中文说法。`unknown` 如实说「状态未知」，不猜。 */
export const TOOL_STATE_LABEL: Record<ToolStepState, string> = {
  done: '完成',
  running: '进行中',
  failed: '失败',
  unknown: '状态未知',
}

/** 一行摘要：按工具归组，保留首次出现顺序（就是实际发生顺序）。 */
export function summarizeTools(tools: ProcessToolCall[]): string {
  const groups = new Map<string, number>()
  for (const t of tools) groups.set(t.name, (groups.get(t.name) ?? 0) + 1)
  const parts = [...groups.entries()].map(([name, n]) => `${toolLabel(name)} ${n} 次`)
  return parts.join(' · ')
}


/** 参数只取第一行、截断：侧栏是速览，完整内容在完整对话区看。 */
export function firstLine(args: string): string {
  const one = args.replace(/\s+/g, ' ').trim()
  return one.length > 60 ? `${one.slice(0, 60)}…` : one
}
