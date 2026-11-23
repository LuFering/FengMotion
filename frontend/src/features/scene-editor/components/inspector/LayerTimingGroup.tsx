import { MenuSelect } from '@/shared/components/MenuSelect'
import { Group, NumberField } from '@/features/scene-editor/components/inspector/InspectorFields'
import type { EditorLayer, SceneDocument } from '@/features/scene-editor/model/types'

export interface LayerTimingGroupProps {
  document: SceneDocument
  layer: EditorLayer
  onLayer: (patch: Partial<EditorLayer>) => void
}

/** 检查器的「时间与动画」分组：编辑图层入点、出点，非音频图层还可设入退场动画，图片图层可设缓推倍率。 */
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
            <MenuSelect label="" className="se-menu" ariaLabel="入场方式" value={layer.motion}
              options={[{ value: 'none', label: '无入退场动画' }, { value: 'rise', label: '上浮进入' }, { value: 'scale', label: '缩放进入' }]}
              onChange={(v) => onLayer({ motion: v as EditorLayer['motion'] })} />
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
