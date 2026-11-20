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

/** 一行摘要：按工具归组，保留首次出现顺序（就是实际发生顺序）。 */
export function summarizeTools(tools: ProcessToolCall[]): string {
  const groups = new Map<string, number>()
  for (const t of tools) groups.set(t.name, (groups.get(t.name) ?? 0) + 1)
  const parts = [...groups.entries()].map(([name, n]) => `${toolLabel(name)} ${n} 次`)
  return parts.join(' · ')
}
