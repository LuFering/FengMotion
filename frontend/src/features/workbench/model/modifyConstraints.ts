import { type ConstraintKey } from '@/features/workbench/model/workbenchConsole'

/**
 * 真实修改路径**实际会执行**的约束。
 *
 * <p>其余约束后端第一版没有实现，真实请求根本不发它们。
 * 界面因此必须禁用这些开关 —— 让用户勾选一个不会生效的条件，
 * 比根本没有这个开关更糟：他会拿一个没被保证的结果去用。</p>
 *
 * <p>这里与后端 `TaskRequestGuard`/`Constraints.unenforced()` 的判断保持一致，
 * 改后端支持范围时这里也要改。</p>
 */
export const REAL_MODIFY_SUPPORTED_CONSTRAINTS = new Set<ConstraintKey>(['limitToSelection'])
