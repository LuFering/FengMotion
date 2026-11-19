import type { AgentReference } from '@/api/studioApi'
import type { StageVisual } from '@/features/workbench/model/stageVisual'
import type { TimeSpan } from '@/features/workbench/model/timeRange'

export type ExecutableLocalTargetResult =
  | { status: 'valid_frame'; target: AgentReference; image: string }
  | { status: 'valid_span'; target: AgentReference; span: TimeSpan }
  | { status: 'unsupported_target'; target: AgentReference; reason: string }
  | { status: 'none' }

/**
 * 严格按提交能力和有效性判断目标：
 * 绝不凭 kind !== 'project' 盲目放行，杜绝把不可执行的目标滑入无范围的整片修改。
 */
export function evaluateExecutableLocalTarget(
  references: AgentReference[],
  viewedPreview: StageVisual | null,
  capturedPreviewCurrent: { id: string; image: string } | null,
  previewDuration: number,
  timelineManifest: any
): ExecutableLocalTargetResult {
  const target = references.find((ref) => ref.role === 'target' && ref.kind !== 'project')
  if (!target) return { status: 'none' }

  // 1. 检查是否为画面单帧/框选区域修改
  if (target.kind === 'preview' && target.endTimeSeconds === undefined && (target.timeSeconds !== undefined || target.bbox || target.id.endsWith(':image:'))) {
    if (!viewedPreview || target.source?.visualId !== viewedPreview.id) {
      return { status: 'unsupported_target', target, reason: '引用画面已不可用或已切换版本，请重新在当前画面中选择或框选。' }
    }
    if (!capturedPreviewCurrent?.image || capturedPreviewCurrent.id !== target.id) {
      return { status: 'unsupported_target', target, reason: '所引用画面未提取到有效图像快照，请重新选择或框选画面。' }
    }
    return { status: 'valid_frame', target, image: capturedPreviewCurrent.image }
  }

  // 2. 检查是否为时间选区修改
  if (target.kind === 'preview' && typeof target.timeSeconds === 'number' && typeof target.endTimeSeconds === 'number' && target.endTimeSeconds > target.timeSeconds) {
    if (!viewedPreview || target.source?.visualId !== viewedPreview.id) {
      return { status: 'unsupported_target', target, reason: '选区所属的视频已改变或不可用，请重新在当前视频中选择时间范围。' }
    }
    if (target.id.startsWith('clip:')) {
      const clipStillMatches = timelineManifest?.tracks?.some((track: any) => track.clips.some((clip: any) =>
        target.id === `clip:${JSON.stringify([viewedPreview.id, track.id, clip.id])}` &&
        Math.abs(clip.start - target.timeSeconds!) < 0.001 &&
        Math.abs(Math.min(previewDuration, clip.start + clip.duration) - target.endTimeSeconds!) < 0.001,
      ))
      if (!clipStillMatches) {
        return { status: 'unsupported_target', target, reason: '所引用片段的轨道信息已变化或不可用，请重新选择片段。' }
      }
    }
    return { status: 'valid_span', target, span: { start: target.timeSeconds, end: target.endTimeSeconds } }
  }

  // 3. 不属于上述任何可提交的局部目标（例如 artifact、缺少必要时间/图像属性、或 scene 目标）
  return {
    status: 'unsupported_target',
    target,
    reason: `目标「${target.label || target.kind}」暂不支持作为局部修改范围提交。请选择时间段或画面区域，或确认整片修改。`,
  }
}
