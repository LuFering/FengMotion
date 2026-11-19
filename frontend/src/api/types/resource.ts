/** API 契约 · 资源状态（五维正交）。纯类型，规则见 api/contracts.ts 文件头。 */
import type { Id } from './common'

/* ======================= 资源状态（五维正交） ======================= */

/**
 * 页面职责合同 §1.1 的五维资源状态。五个维度各自独立，禁止压成一个 `ready`。
 * 适用于素材、特效、参考片等「可被引用」的资源。
 */
export type ResourceSourceType = 'builtin' | 'imported' | 'generated' | 'sample'

/** 处理到哪一步（解析 / 转码 / 抽帧等）。 */
export type ResourceProcessingStatus = 'pending' | 'processing' | 'ready' | 'failed'

/**
 * 人确认过吗。五值不可互相压平（对账决定 A）：
 *   `none`         从未提审 —— 新导入素材的初始值
 *   `pending`      已提审未出结论 —— 是「还没审」
 *   `needs_review` 审过，结论是「需要修改后再提」—— 是「审了、要求改」，不能压成 pending
 *   `approved`     审核通过
 *   `rejected`     终局否定，不再采用
 * 非法转换（如 none → approved）必须后端拒绝。授权状态 licenseStatus 完全独立，
 * 任何审核转换都不改授权。
 */
export type ResourceReviewStatus = 'none' | 'pending' | 'needs_review' | 'approved' | 'rejected'

/** 现在还能用吗。`deprecated` 是终态，不可回到 enabled。 */
export type ResourceAvailability = 'enabled' | 'disabled' | 'deprecated'

/** 引用关系：资源被谁用了。多值，不是状态。 */
export interface ResourceRef {
  kind: 'project' | 'workflow' | 'task' | 'scene'
  id: Id
  label: string
}
