import { Group, NumberField } from '@/features/scene-editor/components/inspector/InspectorFields'
import type { EditorLayer } from '@/features/scene-editor/model/types'

export interface LayerLayoutGroupProps {
  layer: EditorLayer
  onLayer: (patch: Partial<EditorLayer>) => void
}

/** 检查器的「布局与外观」分组：编辑图层位置、尺寸、旋转、不透明度、变换原点和圆角，形状图层另有填充色。 */
export function LayerLayoutGroup({ layer, onLayer }: LayerLayoutGroupProps) {
  return (
    <Group title="布局与外观">
      <div className="se-field-row">
        <NumberField label="X 位置" value={layer.x} onChange={(x) => onLayer({ x })} />
        <NumberField label="Y 位置" value={layer.y} onChange={(y) => onLayer({ y })} />
      </div>
      <div className="se-field-row">
        <NumberField
          label="宽度"
          min={1}
          value={layer.width}
          onChange={(width) => onLayer({ width })}
        />
        <NumberField
          label="高度"
          min={1}
          value={layer.height}
          onChange={(height) => onLayer({ height })}
        />
      </div>
      <div className="se-field-row">
        <NumberField
          label="旋转角度"
          min={-360}
          max={360}
          value={layer.rotation}
          onChange={(rotation) => onLayer({ rotation })}
        />
        <NumberField
          label="不透明度"
          min={0}
          max={1}
          step={0.05}
          value={layer.opacity}
          onChange={(opacity) => onLayer({ opacity })}
        />
      </div>
      {/* 变换原点：旋转和缩放围绕这一点发生。官方把它列为时间轴上的核心样式项，
          以前只能在中心旋转，做「从左上角推入」这类动作就做不到。 */}
      <div className="se-field-row">
        <NumberField
          label="变换原点 X%"
          min={0}
          max={100}
          value={layer.transformOriginX ?? 50}
          onChange={(transformOriginX) => onLayer({ transformOriginX })}
        />
        <NumberField
          label="变换原点 Y%"
          min={0}
          max={100}
          value={layer.transformOriginY ?? 50}
          onChange={(transformOriginY) => onLayer({ transformOriginY })}
        />
      </div>
      <NumberField
        label="圆角"
        min={0}
        max={1000}
        value={layer.radius}
        onChange={(radius) => onLayer({ radius })}
      />
      {layer.kind === 'shape' && (
        <label className="se-field">
          <span>填充颜色</span>
          <input
            aria-label="填充颜色"
            type="color"
            value={layer.fill}
            onChange={(e) => onLayer({ fill: e.target.value })}
          />
        </label>
      )}
    </Group>
  )
}
