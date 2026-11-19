import { UiIcon, SemIcons } from '@/shared/icons/UiIcon'
import type { AgentReference } from '@/api/studioApi'

/* ── 右栏：场景检查器（次级视图）────────────────────────────
   场景是编辑对象，AI 只是它的一个动作。这里把「改哪一场、这一场是什么、
   当前参数/约束/引用/执行状态」放在一处；默认右栏是对话。 */
export function ReferenceChips({ references, onRemoveReference, onLocateReference,
  onToggleReferenceRole, onClearReferences, onOpenResourcePicker }:
  { references: AgentReference[]
    onRemoveReference: (id: string) => void; onLocateReference: (ref: AgentReference) => void
    onToggleReferenceRole: (id: string) => void; onClearReferences: () => void
    onOpenResourcePicker: () => void }) {
  /* 三库引用单独标出来：它们决定 agent 会去读哪个文件、哪一段，
     和「当前目标/上下文」这类画面位置引用不是一回事。 */
  const libraryKinds = new Set(['asset', 'reference', 'technique'])
  return (
    <div className="fw-ref-chips">
      <button className="fw-ref-clear fw-ref-add" type="button" onClick={onOpenResourcePicker} title="从素材库 / 参考片库 / 特效库选择"><UiIcon icon={SemIcons.plus} size="sm" aria-hidden="true" />引用资源</button>
      {/* 未引用时不铺「当前目标：整个项目」这类默认文字 —— 它只是在描述
          输入框占位符已经说过的同一件事，空着反而更清楚。
          「+ 引用资源」按钮保留：那是挂素材/参考片/特效的唯一入口。 */}
      {references.length === 0
        ? null
        : references.map((ref) => (
          <span key={ref.id} className="fw-ref-chip" data-role={ref.role}>
            <button className="fw-ref-role" type="button" title={ref.kind === 'preview' && !ref.source.workflowId && ref.source.origin !== 'editor' ? '参考资料仅作为上下文' : '切换目标/上下文'} disabled={ref.kind === 'preview' && (ref.endTimeSeconds !== undefined || (!ref.source.workflowId && ref.source.origin !== 'editor'))}
                    onClick={() => onToggleReferenceRole(ref.id)}>{ref.role === 'target' ? '目标' : '上下文'}</button>
            <button className="fw-ref-label" type="button" title="定位到引用"
                    onClick={() => {
                      /* 三库资源没有「画面位置」可定位：点了只给一句说明，
                         不要假装跳转成功。 */
                      if (libraryKinds.has(ref.kind)) return
                      onLocateReference(ref)
                    }}>{ref.label}</button>
            <button type="button" title="移除引用" onClick={() => onRemoveReference(ref.id)}>×</button>
          </span>
        ))}
      {references.length > 0 && <button className="fw-ref-clear" type="button" onClick={onClearReferences}>清空</button>}
    </div>
  )
}
