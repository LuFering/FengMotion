import { MenuSelect } from '@/shared/components/MenuSelect'
import { Group, NumberField } from '@/features/scene-editor/components/inspector/InspectorFields'
import type { EditorLayer } from '@/features/scene-editor/model/types'

export interface LayerTextGroupProps {
  layer: EditorLayer
  onLayer: (patch: Partial<EditorLayer>) => void
}

/** 检查器的「文字」分组：编辑文字图层的内容、字号、字重、颜色和对齐方式。 */
export function LayerTextGroup({ layer, onLayer }: LayerTextGroupProps) {
  return (
    <Group title="文字">
      <label className="se-field">
        <span>文字内容</span>
        <textarea
          aria-label="文字内容"
          rows={3}
          maxLength={8000}
          value={layer.text}
          onChange={(e) => onLayer({ text: e.target.value })}
        />
      </label>
      <div className="se-field-row">
        <NumberField
          label="字号"
          value={layer.fontSize}
          min={8}
          max={500}
          onChange={(fontSize) => onLayer({ fontSize })}
        />
        <NumberField
          label="字重"
          value={layer.fontWeight}
          min={100}
          max={900}
          step={100}
          onChange={(fontWeight) => onLayer({ fontWeight })}
        />
      </div>
      <div className="se-field-row">
        <label className="se-field">
          <span>文字颜色</span>
          <input
            aria-label="文字颜色"
            type="color"
            value={layer.color}
            onChange={(e) => onLayer({ color: e.target.value })}
          />
        </label>
        <label className="se-field">
          <span>文字对齐</span>
          <MenuSelect label="" className="se-menu" ariaLabel="文字对齐" value={layer.align}
            options={[{ value: 'left', label: '左对齐' }, { value: 'center', label: '居中' }, { value: 'right', label: '右对齐' }]}
            onChange={(v) => onLayer({ align: v as EditorLayer['align'] })} />
        </label>
      </div>
    </Group>
  )
}
