/**
 * 中栏的六个阶段。判定只认真实产物（见 Workbench.centerStage 的优先级注释）：
 * 返工 → 修改中，任务在跑 → 制作中，门全确认 → 交付前，
 * 有画面 → 审片时，只绑了参考 → 探索方向，否则 → 刚开始。
 * 产物视图（选了产物）和编辑预览是覆盖层，不算阶段。
 */
export type CenterStage = 'start' | 'explore' | 'produce' | 'revise' | 'review' | 'deliver'

export const STAGE_LABEL: Record<CenterStage, string> = {
  start: '刚开始',
  explore: '探索方向',
  produce: '制作中',
  revise: '修改中',
  review: '审片时',
  deliver: '交付前',
}
