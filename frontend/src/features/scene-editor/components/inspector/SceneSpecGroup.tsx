import { Group, NumberField } from '@/features/scene-editor/components/inspector/InspectorFields'
import type { SceneDocument } from '@/features/scene-editor/types'

export interface SceneSpecGroupProps {
  document: SceneDocument
  native: boolean
  onDocument: (patch: Partial<SceneDocument>) => void
}

/** 从 SceneInspector.tsx 原样拆出的界面区块；props 与原处的变量同名。 */
export function SceneSpecGroup({ document, native, onDocument }: SceneSpecGroupProps) {
  return (
    <Group title="场景规格">
      <label className="se-field">
        <span>场景名称</span>
        <input
          aria-label="场景名称"
          value={document.name}
          onChange={(e) => onDocument({ name: e.target.value })}
        />
      </label>
      <NumberField
        label="场景时长（秒）"
        value={document.durationSeconds}
        min={0.5}
        max={600}
        step={0.1}
        onChange={(durationSeconds) =>
          onDocument({
            durationSeconds,
            layers: document.layers.map((l) => ({
              ...l,
              start: Math.min(l.start, durationSeconds - 0.01),
              end: Math.min(l.end, durationSeconds),
            })),
          })
        }
      />
      {native ? (
        <>
          <div className="se-field-row">
            <NumberField
              label="画布宽度"
              value={document.width}
              min={64}
              max={4096}
              step={2}
              onChange={(width) => onDocument({ width: Math.round(width / 2) * 2 })}
            />
            <NumberField
              label="画布高度"
              value={document.height}
              min={64}
              max={4096}
              step={2}
              onChange={(height) => onDocument({ height: Math.round(height / 2) * 2 })}
            />
          </div>
          <label className="se-field">
            <span>帧率</span>
            <select
              aria-label="帧率"
              value={document.fps}
              onChange={(e) => onDocument({ fps: Number(e.target.value) })}
            >
              {[24, 25, 30, 60].map((v) => (
                <option key={v} value={v}>
                  {v} fps
                </option>
              ))}
            </select>
          </label>
          <label className="se-field">
            <span>背景颜色</span>
            <input
              aria-label="背景颜色"
              type="color"
              value={document.background}
              onChange={(e) => onDocument({ background: e.target.value })}
            />
          </label>
        </>
      ) : (
        <p className="se-caption">
          {document.width} × {document.height} · {document.fps} fps
          <br />
          尺寸沿用源工程。时长调整会按比例重映射原动画时间轴。
        </p>
      )}
    </Group>
  )
}
