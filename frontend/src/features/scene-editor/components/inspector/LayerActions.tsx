import { UiIcon, SemIcons } from '@/shared/icons/UiIcon'
import { EyeOff, Lock01, ArrowUp, ArrowDown } from '@untitledui/icons'
import type { EditorLayer } from '@/features/scene-editor/model/types'

export interface LayerActionsProps {
  layer: EditorLayer
  onDelete: () => void
  onDuplicate: () => void
  onLayer: (patch: Partial<EditorLayer>) => void
  onReorder: (direction: number) => void
}

/** 检查器中当前图层的操作按钮：显隐、锁定、复制、上下移动和删除。 */
export function LayerActions({ layer, onDelete, onDuplicate, onLayer, onReorder }: LayerActionsProps) {
  return (
    <div className="se-layer-actions">
      <button
        type="button"
        title={layer.visible ? '隐藏图层' : '显示图层'}
        aria-label={layer.visible ? '隐藏图层' : '显示图层'}
        onClick={() => onLayer({ visible: !layer.visible })}
      >
        {layer.visible ? <UiIcon icon={SemIcons.eye} size="sm" /> : <UiIcon icon={EyeOff} size="sm" />}
      </button>
      <button
        type="button"
        title="切换图层锁定"
        aria-label="切换图层锁定"
        onClick={() => onLayer({ locked: !layer.locked })}
      >
        {layer.locked ? <UiIcon icon={Lock01} size="sm" /> : <UiIcon icon={Lock01} size="sm" />}
      </button>
      <button type="button" title="复制图层" aria-label="复制图层" onClick={onDuplicate}>
        <UiIcon icon={SemIcons.copy} size="sm" />
      </button>
      <button type="button" title="图层上移" aria-label="图层上移" onClick={() => onReorder(1)}>
        <UiIcon icon={ArrowUp} size="sm" />
      </button>
      <button type="button" title="图层下移" aria-label="图层下移" onClick={() => onReorder(-1)}>
        <UiIcon icon={ArrowDown} size="sm" />
      </button>
      <button type="button" title="删除图层（可撤销）" aria-label="删除图层" onClick={onDelete}>
        <UiIcon icon={SemIcons.trash} size="sm" />
      </button>
    </div>
  )
}
