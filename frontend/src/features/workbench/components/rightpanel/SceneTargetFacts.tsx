import { UiIcon } from '@/shared/icons/UiIcon'
import { MessageSquare01 } from '@untitledui/icons'
import type { StageVisual } from '@/features/workbench/model/stageVisual'
import type { SideTab } from '@/features/workbench/model/workbenchConsole'
import type { AgentReference } from '@/api/studioApi'

export interface SceneTargetFactsProps {
  preview: StageVisual | null
  setSideTab: (v: SideTab) => void
  target: AgentReference
}

/** 右栏的修改目标说明：显示当前目标的作用范围和所选预览的类型、版本与生成时间，并可回到对话提意见。 */
export function SceneTargetFacts({ preview, setSideTab, target }: SceneTargetFactsProps) {
  return (
    <div className="fw-scroll wb-target-facts"><span className="wb-target-kicker">修改目标</span><h3>{target.label}</h3><p>{target.kind === 'project' ? '本次意见作用于整个项目；选中具体预览或内容后，可以缩小修改范围。' : '意见会连同当前目标一起发送。查看发送记录可核对当时的范围。'}</p>{preview && <dl><dt>预览类型</dt><dd>{preview.tierLabel}</dd><dt>{preview.origin === 'editor' ? '编辑版本' : '工作流版本'}</dt><dd>v{preview.revision}</dd><dt>预览生成于</dt><dd>{new Date(preview.createdAt).toLocaleString('zh-CN')}</dd></dl>}<button type="button" className="wb-btn-ghost" onClick={() => setSideTab('chat')}><UiIcon icon={MessageSquare01} size="sm" /> 对这个目标提意见</button></div>
  )
}
