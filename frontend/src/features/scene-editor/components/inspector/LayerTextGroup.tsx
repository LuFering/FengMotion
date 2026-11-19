import { Group, NumberField } from '@/features/scene-editor/components/inspector/InspectorFields'
import type { EditorLayer } from '@/features/scene-editor/types'

export interface LayerTextGroupProps {
  layer: EditorLayer
  onLayer: (patch: Partial<EditorLayer>) => void
}

/** 从 SceneInspector.tsx 原样拆出的界面区块；props 与原处的变量同名。 */
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
          <select
            aria-label="文字对齐"
            value={layer.align}
            onChange={(e) => onLayer({ align: e.target.value as EditorLayer['align'] })}
          >
            <option value="left">左对齐</option>
            <option value="center">居中</option>
            <option value="right">右对齐</option>
          </select>
        </label>
      </div>
    </Group>
  )
}
