import { type Node } from '@xyflow/react'
import { QUALITY_QUESTIONS, type GateEval, type WfNodeStatus } from '@/features/workflow/services/workflowService'

export type FmNodeData = {
  defType: string
  params: Record<string, unknown>
  status: WfNodeStatus | 'idle'
  gateEval?: GateEval | null
  laneSummary?: string
  onToggleLane?: () => void
  renderMode?: 'real' | 'demo'
  renderFile?: string
}

export type FmNode = Node<FmNodeData, 'fm' | 'lane'>

export const ARTIFACT_STATUS_LABEL: Record<string, string> = {
  missing: '尚无产物',
  draft: '草稿',
  candidate: '待确认',
  confirmed: '已确认',
}

export function pfSummary(defType: string, p: Record<string, unknown>): string {
  switch (defType) {
    case 'prompt':
      return String(p.text ?? '').trim() ? `${String(p.text).trim().slice(0, 42)}…` : '尚未填写提示词'
    case 'refs': {
      const na = ((p.assetIds as string[] | undefined) ?? []).length
      const nr = ((p.refSegmentIds as string[] | undefined) ?? []).length
      return na + nr === 0 ? '未添加参考 · 可直接创作' : `${na} 项素材 · ${nr} 条参考`
    }
    case 'capability': {
      const n = ((p.techniqueIds as string[] | undefined) ?? []).length
      return n ? `${n} 项能力候选（只检索）` : '未选择能力'
    }
    case 'create':
      return `${String(p.mode ?? 'sketch')} · ${String(p.resolution ?? '1080p')}`
    case 'review': {
      const checks = (p.checks as Record<string, boolean> | undefined) ?? {}
      if (checks.done && !checks.rework) return '审片通过'
      if (checks.rework && !checks.done) return '需要修改 · 待返工'
      const done = QUALITY_QUESTIONS.filter((q) => checks[q]).length
      return `quality-bar 已确认 ${done}/${QUALITY_QUESTIONS.length}`
    }
    case 'delivery':
      return String(p.notes ?? '').trim() ? String(p.notes).trim().slice(0, 42) : '等待审片通过后输出'
    default:
      return ''
  }
}

export const NODE_COPY: Record<string, { title: string; description: string }> = {
  prompt: { title: '创作需求', description: '写下目标、要求与必须保留的细节' },
  refs: { title: '素材与参考', description: '添加素材，确定参考的使用边界' },
  capability: { title: '创作能力', description: '选取适合当前画面的技法与组件' },
  create: { title: '制作与渲染', description: '配置制作方式与输出规格' },
  review: { title: '审片与修改', description: '查看结果，选择通过或记录修改要求' },
  delivery: { title: '交付', description: '确定性交付：审片通过且通过最新渲染时输出成片' },
}

/* ── Inspector ───────────────────────────────────────────────────── */

export const RUN_STATUS_TXT: Record<string, string> = {
  pending: '待处理',
  running: '运行中',
  completed: '已完成',
  failed: '失败',
  skipped: '已跳过',
  awaiting_info: '等待补充',
  cancelled: '已取消',
}
