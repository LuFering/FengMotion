/**
 * **逐字段**的编辑版本号。
 *
 * <p>为什么不能只用一个共同轮次：用户等待发送结果时只换了目标，
 * 共同轮次一推进，旧文字也会被保留下来 —— 界面上看就是
 * 「上一条好像没发出去」，与实际不符。</p>
 *
 * <p>所以四个可清理的字段各自记版本：文本、附件、目标、意图。
 * 只有「提交之后没被单独编辑过」的字段才清掉。</p>
 */
export type EditableField = 'text' | 'attachments' | 'targetSnapshot' | 'intentAction' | 'continuationScopeMode'
export type FieldVersions = Record<EditableField, number>

export const fieldVersions = new Map<string, FieldVersions>()

const ZERO_VERSIONS: FieldVersions = {
  text: 0, attachments: 0, targetSnapshot: 0, intentAction: 0, continuationScopeMode: 0,
}

export function versionsOf(key: string): FieldVersions {
  let v = fieldVersions.get(key)
  if (!v) {
    v = { ...ZERO_VERSIONS }
    fieldVersions.set(key, v)
  }
  return v
}

/** 推进指定字段的版本。 */
export function bumpFields(key: string, fields: EditableField[]): void {
  if (fields.length === 0) return
  const v = { ...versionsOf(key) }
  for (const f of fields) v[f] += 1
  fieldVersions.set(key, v)
}
