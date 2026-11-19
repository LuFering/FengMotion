import { Group, NumberField } from '@/features/scene-editor/components/inspector/InspectorFields'
import type { SceneDocument, ElementPatch } from '@/features/scene-editor/model/types'

export interface ElementLayoutGroupProps {
  document: SceneDocument
  onDocument: (patch: Partial<SceneDocument>) => void
  onPatch: (patch: ElementPatch) => void
  patch: ElementPatch
  selected: string | null
}

/** 检查器中选中元素的「位置与外观」分组：偏移、缩放、旋转、不透明度、显隐，以及恢复元素原貌。 */
export function ElementLayoutGroup({ document, onDocument, onPatch, patch, selected }: ElementLayoutGroupProps) {
  return (
    <Group title="位置与外观">
      <div className="se-field-row">
        <NumberField label="水平偏移" value={patch.x ?? 0} onChange={(x) => onPatch({ x })} />
        <NumberField label="垂直偏移" value={patch.y ?? 0} onChange={(y) => onPatch({ y })} />
      </div>
      <div className="se-field-row">
        <NumberField
          label="缩放倍率"
          min={0.1}
          max={5}
          step={0.05}
          value={patch.scale ?? 1}
          onChange={(scale) => onPatch({ scale })}
        />
        <NumberField
          label="旋转角度"
          min={-360}
          max={360}
          value={patch.rotation ?? 0}
          onChange={(rotation) => onPatch({ rotation })}
        />
      </div>
      <NumberField
        label="不透明度倍率"
        min={0}
        max={1}
        step={0.05}
        value={patch.opacity ?? 1}
        onChange={(opacity) => onPatch({ opacity })}
      />
      <label className="se-check">
        <input
          type="checkbox"
          checked={patch.visible !== false}
          onChange={(e) => onPatch({ visible: e.target.checked })}
        />
        显示此元素
      </label>
      <button
        type="button"
        className="se-action"
        onClick={() =>
          onDocument({
            patches: Object.fromEntries(
              Object.entries(document.patches).filter(([id]) => id !== selected),
            ),
          })
        }
      >
        恢复此元素原貌
      </button>
    </Group>
  )
}
