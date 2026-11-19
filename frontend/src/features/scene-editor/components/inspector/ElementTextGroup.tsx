import { Group, NumberField } from '@/features/scene-editor/components/inspector/InspectorFields'
import type { HtmlElementInfo, ElementPatch } from '@/features/scene-editor/types'

export interface ElementTextGroupProps {
  element: HtmlElementInfo
  onPatch: (patch: ElementPatch) => void
  patch: ElementPatch
}

/** 从 SceneInspector.tsx 原样拆出的界面区块；props 与原处的变量同名。 */
export function ElementTextGroup({ element, onPatch, patch }: ElementTextGroupProps) {
  return (
    <Group title="文字">
      <label className="se-field">
        <span>源文字</span>
        <textarea
          aria-label="源文字"
          value={patch.text ?? element.text ?? ''}
          rows={3}
          onChange={(e) => onPatch({ text: e.target.value })}
        />
      </label>
      <div className="se-field-row">
        <NumberField
          label="源字号"
          min={8}
          max={1000}
          value={patch.fontSize ?? element.fontSize}
          onChange={(fontSize) => onPatch({ fontSize })}
        />
        <label className="se-field">
          <span>{element.gradientText ? '纯色覆盖' : '源文字颜色'}</span>
          <input
            type="color"
            aria-label="源文字颜色"
            value={patch.color ?? element.color}
            onChange={(e) => onPatch({ color: e.target.value })}
          />
        </label>
      </div>
    </Group>
  )
}
