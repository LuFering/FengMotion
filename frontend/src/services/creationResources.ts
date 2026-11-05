import type { AgentReference, ModificationConstraints } from './studioApi'
import type { DeliverableAsset } from '@/shell/usePendingAssets'

export type LibraryReference = Extract<AgentReference, { kind: 'asset' | 'reference' | 'technique' }>

export function deliveredReferences(items: DeliverableAsset[]): LibraryReference[] {
  return items.map((item): LibraryReference => {
    if (item.source === 'ref') return {
      id: `reference:${item.assetId}`, kind: 'reference', role: 'context', label: item.name,
      segmentId: item.assetId, videoId: item.refVideoId,
      startMs: item.refStart === undefined ? undefined : Math.round(item.refStart * 1000),
      endMs: item.refEnd === undefined ? undefined : Math.round(item.refEnd * 1000),
      wants: [item.refWants, item.note].filter(Boolean).join('\n') || undefined,
    }
    if (item.source === 'fx') return {
      id: `technique:${item.fxId ?? item.assetId}`, kind: 'technique', role: 'context', label: item.name,
      techniqueId: item.fxId ?? item.assetId, version: item.fxVersion,
      intent: item.purpose === 'reference' ? 'reference' : 'apply',
    }
    return {
      id: `asset:${item.assetId}`, kind: 'asset', role: 'context', label: item.name,
      assetId: item.assetId, purpose: item.purpose, note: item.note,
    }
  })
}

export const libraryReferences = (refs: AgentReference[]) =>
  refs.filter((ref): ref is LibraryReference => ref.kind === 'asset' || ref.kind === 'reference' || ref.kind === 'technique')

/** 与界面所示范围同源；定位元数据是用户要求，仍需 agent 实际观察并实现。 */
export function creationIntent(prompt: string, refs: AgentReference[], constraints: ModificationConstraints, keepNotes: string): string {
  const locations = refs.filter((ref) => !['asset', 'reference', 'technique'].includes(ref.kind))
  const rules = [
    constraints.preserveCamera && '保留已有运镜',
    constraints.preserveCaptions && '保留已有字幕',
    constraints.reuseExistingComponents && '优先复用已有组件',
    constraints.limitToSelection && '将改动限制在指定目标',
    constraints.preserveOutsideSelection && '选区以外的画面保持不变',
    constraints.durationSeconds && `目标时长 ${constraints.durationSeconds} 秒`,
    constraints.resolution && `目标分辨率 ${constraints.resolution}`,
    keepNotes.trim(),
  ].filter(Boolean)
  return [prompt, locations.length ? `用户指定的目标与上下文（时间单位为秒；bbox 为画面归一化坐标）：\n${JSON.stringify(locations, null, 2)}` : '',
    rules.length ? `保留与修改要求：\n${rules.map((rule) => `- ${rule}`).join('\n')}` : '',
    '若无法定位目标、缺少实际画面或不能满足保留条件，请说明并询问，不要悄悄扩大修改范围。',
  ].filter(Boolean).join('\n\n')
}
