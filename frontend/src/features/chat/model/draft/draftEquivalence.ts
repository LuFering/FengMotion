import type { DraftAttachment, TargetSnapshot } from './draftTypes'

/**
 * 对比两份目标快照是否等价。
 *
 * <p><strong>必须覆盖快照的全部字段</strong>：这个函数同时用于
 * ① 草稿脏检查（判断这次更新是否「什么都没变」）
 * ② 发送成功后的「哪些部分该清」判断。
 * 早先漏了 `bbox`（画面框选）与 `references`（引用），
 * 于是用户只改框选区域或引用时会被判成「没变」——
 * 轻则更新被直接忽略，重则成功后把他新改的目标清掉。</p>
 */
/** 仅供回归测试：把内部的快照等价判断暴露出来。 */
export function isEquivalentSnapshotForTest(a: TargetSnapshot | null, b: TargetSnapshot | null): boolean {
  return isEquivalentSnapshot(a, b)
}

export function isEquivalentSnapshot(a: TargetSnapshot | null, b: TargetSnapshot | null): boolean {
  if (a === b) return true
  if (!a || !b) return false
  if (a.version !== b.version) return false
  /* 版本来源与确认状态**必须一起比**：
     只更新这两个字段时（例如旧快照补上来源、或后端恢复后确认状态变化），
     漏比就会被判成「没变」—— 更新被静默丢弃，成功后的清理判断也会错。 */
  if (a.versionSeries !== b.versionSeries) return false
  if (a.versionConfirmed !== b.versionConfirmed) return false
  if (a.scope !== b.scope) return false
  if (a.intentAction !== b.intentAction) return false
  if (a.previewImage !== b.previewImage) return false
  if (a.label !== b.label) return false
  if (a.pinned !== b.pinned) return false
  const aSpan = a.rangeSpan
  const bSpan = b.rangeSpan
  if (Boolean(aSpan) !== Boolean(bSpan)) return false
  if (aSpan && bSpan && (aSpan.start !== bSpan.start || aSpan.end !== bSpan.end)) return false
  /* 画面框选：四个数逐项比，任一不同就是不同目标 */
  const aBox = a.bbox
  const bBox = b.bbox
  if (Boolean(aBox) !== Boolean(bBox)) return false
  if (aBox && bBox) {
    for (let i = 0; i < 4; i++) {
      if (aBox[i] !== bBox[i]) return false
    }
  }
  /* 引用：**完整比较全部字段**，不能只挑 id/role/label。
     引用允许携带其他字段（projectId、action、kind、素材来源等），
     只改这些字段时若被判成「未变」，轻则草稿更新被静默丢弃，
     重则成功后把用户刚改的引用清掉。
     顺序敏感（与后端序列化规则一致）。 */
  return isEquivalentReferences(a.references, b.references)
}

/**
 * 引用数组的完整等价判断。
 *
 * <p>用稳定的逐字段深比较，而不是白名单：白名单必然会漏字段，
 * 而这个函数同时决定「草稿要不要更新」和「成功后清不清」，
 * 漏一个字段就是一次静默丢数据。</p>
 */
function isEquivalentReferences(
  a: Array<Record<string, unknown>> | undefined | null,
  b: Array<Record<string, unknown>> | undefined | null,
): boolean {
  const al = a ?? []
  const bl = b ?? []
  if (al.length !== bl.length) return false
  for (let i = 0; i < al.length; i++) {
    if (!deepEqual(al[i], bl[i])) return false
  }
  return true
}

/** 结构相等：对象键序无关，数组保序，忽略 undefined 字段。 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a === null || b === null || a === undefined || b === undefined) return a === b
  if (typeof a !== typeof b) return false
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    return a.every((v, i) => deepEqual(v, b[i]))
  }
  if (typeof a === 'object') {
    const ao = a as Record<string, unknown>
    const bo = b as Record<string, unknown>
    const keys = new Set([...Object.keys(ao), ...Object.keys(bo)])
    for (const k of keys) {
      if (!deepEqual(ao[k], bo[k])) return false
    }
    return true
  }
  return false
}

/** 浅度对比附件数组 */
export function isEquivalentAttachments(a: DraftAttachment[], b: DraftAttachment[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i].name !== b[i].name || a[i].fileId !== b[i].fileId || a[i].uploadId !== b[i].uploadId) {
      return false
    }
  }
  return true
}
