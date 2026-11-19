import { Group, NumberField } from '@/features/scene-editor/components/inspector/InspectorFields'
import type { EditorLayer, SceneDocument } from '@/features/scene-editor/types'

export interface LayerTimingGroupProps {
  document: SceneDocument
  layer: EditorLayer
  onLayer: (patch: Partial<EditorLayer>) => void
}

/** 从 SceneInspector.tsx 原样拆出的界面区块；props 与原处的变量同名。 */
export function LayerTimingGroup({ document, layer, onLayer }: LayerTimingGroupProps) {
  return (
    <Group title="时间与动画">
      <div className="se-field-row">
        <NumberField
          label="入点（秒）"
          min={0}
          max={layer.end - 0.01}
          step={0.1}
          value={layer.start}
          onChange={(start) => onLayer({ start })}
        />
        <NumberField
          label="出点（秒）"
          min={layer.start + 0.01}
          max={document.durationSeconds}
          step={0.1}
          value={layer.end}
          onChange={(end) => onLayer({ end })}
        />
      </div>
      {layer.kind !== 'audio' && (
        <>
          <label className="se-field">
            <span>入场方式</span>
            <select
              aria-label="入场方式"
              value={layer.motion}
              onChange={(e) => onLayer({ motion: e.target.value as EditorLayer['motion'] })}
            >
              <option value="none">无入退场动画</option>
              <option value="rise">上浮进入</option>
              <option value="scale">缩放进入</option>
            </select>
          </label>
          {layer.motion !== 'none' && (
            <>
              <div className="se-field-row">
                <NumberField
                  label="入场时长（秒）"
                  min={0.05}
                  max={10}
                  step={0.05}
                  value={layer.entrance}
                  onChange={(entrance) => onLayer({ entrance })}
                />
                <NumberField
                  label="退场时长（秒）"
                  min={0}
                  max={10}
                  step={0.05}
                  value={layer.exit}
                  onChange={(exit) => onLayer({ exit })}
                />
              </div>
              <NumberField
                label="位移幅度"
                min={0}
                max={500}
                value={layer.travel}
                onChange={(travel) => onLayer({ travel })}
              />
            </>
          )}
          {layer.kind === 'image' && (
            <NumberField
              label="画面缓推倍率"
              min={1}
              max={2}
              step={0.01}
              value={layer.zoom}
              onChange={(zoom) => onLayer({ zoom })}
            />
          )}
        </>
      )}
    </Group>
  )
}
