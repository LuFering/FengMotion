/**
 * 「哪些元素改过」：源码每次刷新后元素轨会重新采集，拿新旧两份比。
 *
 * <p>元素按源码位置（文件:行:列）记，AI 在上面插了几行，下面所有元素的位置都会变 ——
 * 只按位置比会把整片都标成改过。所以位置对不上时再按「名称 + 类型 + 文字 + 出现时段」认一次：
 * 都一样就是同一个元素挪了位置，没改。</p>
 *
 * <p>已经标过的改动跟着元素走（位置变了也换成新位置），直到用户清掉。</p>
 */
import type { LiveLayerItem } from '@/features/workbench/model/livePreviewProtocol'

const look = (item: LiveLayerItem) => JSON.stringify([item.name, item.kind, item.text ?? '', !!item.full])
const when = (item: LiveLayerItem) => JSON.stringify(item.ranges)

/**
 * @param prev 上一次采到的元素
 * @param next 这一次采到的元素
 * @param changed 已经标过的元素（按 prev 里的 key）
 * @returns 这一次之后应当标出的元素（按 next 里的 key）
 */
export function diffLayers(prev: LiveLayerItem[], next: LiveLayerItem[], changed: ReadonlySet<string>): Set<string> {
  const byKey = new Map(prev.map((p) => [p.key, p]))
  const byLook = new Map<string, LiveLayerItem[]>()
  for (const p of prev) byLook.set(look(p), [...(byLook.get(look(p)) ?? []), p])
  const used = new Set<string>()
  const out = new Set<string>()
  /* 先认位置没变的，再拿剩下的按外观认，免得挪了位置的元素抢走别人的旧记录 */
  const pending: LiveLayerItem[] = []
  for (const n of next) {
    const old = byKey.get(n.key)
    if (old && look(old) === look(n)) {
      used.add(old.key)
      if (changed.has(old.key) || when(old) !== when(n)) out.add(n.key)
    } else pending.push(n)
  }
  for (const n of pending) {
    const candidates = (byLook.get(look(n)) ?? []).filter((p) => !used.has(p.key))
    const old = candidates.find((p) => when(p) === when(n)) ?? candidates[0]
    if (!old) { out.add(n.key); continue }
    used.add(old.key)
    if (changed.has(old.key) || when(old) !== when(n)) out.add(n.key)
  }
  return out
}
