/**
 * 文件改动：从 `write` / `edit` 的工具参数推导「这一轮动了哪些文件、改了什么」。
 *
 * ## 为什么从工具参数推导，而不是读 dsh 的改动摘要
 *
 * dsh 内部有 `workspaceChanges` 服务（提供 summary / diff），但：
 * - `workspace/changes` 事件只带 `{turn}`，**没有文件内容**
 * - 内容由 Host 的 HTTP 接口 `/api/changes.summary` 提供，而 SDK 模式是
 *   stdio JSON-RPC，根本没开这个端口
 * - SDK 只暴露 5 个方法（prompt / resume / wait / directory get,set），没有改动接口
 *
 * 而 `write` 的参数带全文 `content`、`edit` 的带 `old_string` / `new_string` ——
 * 新旧文本都在手里，diff 可以自己算。所以这里不依赖任何额外接口。
 *
 * ## 为什么只算行级增删
 *
 * 工具参数里的 `old_string` / `new_string` 是**局部片段**，不是整文件快照。
 * 拿它做完整 unified diff 会得出「整个文件只有这几行」的错误结论。
 * 所以这里只记录「这个片段改了几行」，并明确标注这是**片段级**统计。
 */

/** 一次改动。 */
export interface FileChange {
  path: string
  /** `write` = 新建/整体覆盖；`edit` = 局部替换。 */
  kind: 'write' | 'edit'
  /** 新增行数（按片段计，不是整文件）。 */
  added: number
  /** 删除行数（按片段计）。 */
  deleted: number
  /** 片段内改动明细，用于展开查看。 */
  hunks: { before: string[]; after: string[] }[]
}

/** 工具记录的最小形状（与 useChat 的 executedTools 对齐）。 */
type ToolLike = { name: string; arguments?: string; isError?: boolean }

/** 按行切分，丢掉末尾那个空元素（文件以换行结尾是常态，不该算一行）。 */
function toLines(text: string): string[] {
  if (text.length === 0) return []
  const lines = text.split('\n')
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  return lines
}

/**
 * 片段级的增删统计。
 *
 * 不追求「最小编辑集」——那需要真正的 LCS diff，而这几个片段的规模不值得。
 * 这里给的是「新片段有几行是新增的、旧片段有几行被删掉」的上界估计，
 * 用于让人判断改动大小，不作为精确行号依据。
 */
function countDelta(before: string[], after: string[]): { added: number; deleted: number } {
  /* 公共前后缀剥掉，剩下的就是要增要删的部分。 */
  let head = 0
  while (head < before.length && head < after.length && before[head] === after[head]) head++
  let tail = 0
  while (
    tail < before.length - head &&
    tail < after.length - head &&
    before[before.length - 1 - tail] === after[after.length - 1 - tail]
  ) tail++
  return {
    deleted: Math.max(0, before.length - head - tail),
    added: Math.max(0, after.length - head - tail),
  }
}

/**
 * 从工具调用里推导文件改动。
 *
 * 按 path 合并：同一文件在一轮里被写多次，累加增删，
 * 而不是列成好几条 —— 用户想知道「这个文件最后被改成什么样、改了多少」。
 *
 * @param tools 当前会话的工具调用记录
 * @returns 按首次出现顺序排列的改动；失败的调用不计入（没改成）
 */
export function collectFileChanges(tools: ToolLike[] | undefined): FileChange[] {
  const byPath = new Map<string, FileChange>()
  for (const t of tools ?? []) {
    if (t.isError) continue
    if (t.name !== 'write' && t.name !== 'edit') continue
    let args: Record<string, unknown>
    try {
      const parsed = JSON.parse(t.arguments ?? '')
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue
      args = parsed as Record<string, unknown>
    } catch {
      continue
    }
    const path = typeof args.file_path === 'string' ? args.file_path : ''
    if (!path) continue

    if (t.name === 'write') {
      const content = typeof args.content === 'string' ? args.content : ''
      const after = toLines(content)
      const prev = byPath.get(path)
      const next: FileChange = {
        path,
        kind: 'write',
        added: (prev?.added ?? 0) + after.length,
        /* 覆盖写不产生删除统计：它没有「旧内容」可比。
           硬算会把「重写整个文件」误报成大量删除。 */
        deleted: prev?.deleted ?? 0,
        hunks: [...(prev?.hunks ?? []), { before: [], after }],
      }
      byPath.set(path, next)
      continue
    }

    /* edit：old_string / new_string 是局部片段。也支持 edits 数组形态。 */
    const pairs: { before: string; after: string }[] = []
    if (typeof args.old_string === 'string' || typeof args.new_string === 'string') {
      pairs.push({
        before: typeof args.old_string === 'string' ? args.old_string : '',
        after: typeof args.new_string === 'string' ? args.new_string : '',
      })
    }
    if (Array.isArray(args.edits)) {
      for (const e of args.edits) {
        const rec = (e ?? {}) as Record<string, unknown>
        pairs.push({
          before: typeof rec.old_string === 'string' ? rec.old_string : '',
          after: typeof rec.new_string === 'string' ? rec.new_string : '',
        })
      }
    }
    if (pairs.length === 0) continue

    const prev = byPath.get(path)
    let added = prev?.added ?? 0
    let deleted = prev?.deleted ?? 0
    const hunks = [...(prev?.hunks ?? [])]
    for (const p of pairs) {
      const b = toLines(p.before)
      const a = toLines(p.after)
      const d = countDelta(b, a)
      added += d.added
      deleted += d.deleted
      hunks.push({ before: b, after: a })
    }
    byPath.set(path, { path, kind: prev?.kind === 'write' ? 'write' : 'edit', added, deleted, hunks })
  }
  return [...byPath.values()]
}
