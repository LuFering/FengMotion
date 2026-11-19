import {
  promptFirstGraph,
  type WfGraph,
  type WorkflowPresetMeta,
} from '@/features/workflow/model/workflowTemplates'
import type { ApplyPresetResult, WorkflowPreset } from '@/api/skillPresets'

export function extractPresetMeta(preset: WorkflowPreset): WorkflowPresetMeta {
  return {
    id: preset.id,
    name: preset.name || preset.mapping.name,
    slug: preset.mapping.slug,
    commitSha: preset.commitSha,
    skillPath: preset.skillPath,
    sourceRepo: preset.sourceRepo,
    requiredInputs: preset.mapping.requiredInputs.map((r) => ({ ...r })),
    reviewChecklist: [...preset.mapping.reviewChecklist],
  }
}

/**
 * 根据后端启用的 skill 预设构建工作流初始图：
 * - prompt 节点带上 promptScaffold（只作填写提示，不写进 text）、默认时长与画幅
 * - 若有 requiredInputs 则自动添加 refs 节点并带出素材提示
 * - review 节点带上 reviewChecklist 审片检查项
 */
export function buildGraphFromSkillPreset(preset: WorkflowPreset): WfGraph {
  const base = promptFirstGraph('general')
  const m = preset.mapping

  const promptNode = base.nodes.find((n) => n.type === 'prompt')
  if (promptNode) {
    promptNode.params = {
      ...promptNode.params,
      /* 骨架不能当成用户原文：首次运行时 text 会逐字写进 prompt.original.md，
         「品牌名：/ Logo 文件：」这类没填的模板项会变成创作依据。text 只放用户写的内容。 */
      text: '',
      promptScaffold: m.promptScaffold || '',
      duration: m.defaults?.duration ?? '',
      ratio: m.defaults?.ratio || '16:9',
    }
  }

  if (m.requiredInputs.length > 0) {
    base.nodes.push({
      id: 'n-refs',
      type: 'refs',
      position: { x: 60, y: 360 },
      params: {
        projectId: '',
        assetIds: [] as string[],
        refSegmentIds: [] as string[],
        requiredInputs: m.requiredInputs.map((r) => ({ ...r })),
      },
    })
    base.edges.push({
      id: 'e3',
      source: 'n-refs',
      sourcePort: 'refs',
      target: 'n-create',
      targetPort: 'refs',
    })
  }

  const reviewNode = base.nodes.find((n) => n.type === 'review')
  if (reviewNode) {
    reviewNode.params = {
      ...reviewNode.params,
      customChecklist: [...m.reviewChecklist],
    }
  }

  return base
}

/** 将 B4 PresetApplyService.ApplyResult 整理成面向用户的简明日志。 */
export function formatApplyPresetSummary(presetName: string, result: ApplyPresetResult): string {
  const guideTxt =
    result.guide === 'written' ? '已写入 skill-guide.md'
      : result.guide === 'replaced' ? '已更新 skill-guide.md'
        : 'skill-guide.md 未变化'
  const parts: string[] = [`已将「${presetName}」预设落地到项目：${guideTxt}`]
  if (result.componentsCopied > 0) parts.push(`复制参考组件 ${result.componentsCopied} 个`)
  const draftSummary = (result.drafts ?? []).map((d) => {
    const label = d.name === 'lookdev-brief' ? '视觉构想' : d.name === 'film-plan' ? '导演处理' : d.name
    const act = d.action === 'written' ? '已写入' : d.action === 'replaced' ? '已替换' : d.action === 'kept' ? '保留原有内容' : '未变化'
    return `${label}${act}`
  })
  if (draftSummary.length > 0) parts.push(draftSummary.join('、'))
  if (result.warnings?.length) parts.push(`提示：${result.warnings.join('；')}`)
  return parts.join('；')
}
