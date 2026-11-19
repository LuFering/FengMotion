import { Group } from '@/features/scene-editor/components/inspector/InspectorFields'
import { KEYFRAME_PROPERTIES, makeKeyframe, type KeyframeProperty } from '@/features/scene-editor/model/keyframes'
import { UiIcon, SemIcons } from '@/shared/icons/UiIcon'
import type { EditorLayer } from '@/features/scene-editor/model/types'

export interface LayerKeyframeGroupProps {
  layer: EditorLayer
  onLayer: (patch: Partial<EditorLayer>) => void
  playhead: number
}

/** 检查器的「属性关键帧」分组：列出图层已有关键帧并可删除，按属性在播放头处记录当前值。 */
export function LayerKeyframeGroup({ layer, onLayer, playhead }: LayerKeyframeGroupProps) {
  return (
    <Group title="属性关键帧">
      <p className="se-caption">
        在播放头 {playhead.toFixed(2)}s 记录当前值；两个关键帧之间线性过渡。
      </p>
      {(layer.keyframes ?? []).length > 0 && (
        <div className="se-keyframe-list">
          {[...(layer.keyframes ?? [])]
            .sort((a, b) => a.time - b.time)
            .map((frame) => (
              <div className="se-keyframe-row" key={frame.id}>
                <span>{KEYFRAME_PROPERTIES.find(([id]) => id === frame.property)?.[1] ?? frame.property}</span>
                <small>
                  {frame.time.toFixed(2)}s · {Number(frame.value.toFixed(2))}
                </small>
                <button
                  type="button"
                  aria-label={`删除关键帧 ${frame.time.toFixed(2)} 秒`}
                  onClick={() =>
                    onLayer({
                      keyframes: (layer.keyframes ?? []).filter((k) => k.id !== frame.id),
                    })
                  }
                >
                  <UiIcon icon={SemIcons.trash} size="xs" />
                </button>
              </div>
            ))}
        </div>
      )}
      <div className="se-keyframe-add">
        {KEYFRAME_PROPERTIES.map(([property, label]) => (
          <button
            type="button"
            key={property}
            title={`在 ${playhead.toFixed(2)}s 记录「${label}」当前值`}
            onClick={() => {
              const current = property === 'scale' ? layer.zoom : (layer[property as keyof EditorLayer] as number)
              const next = [...(layer.keyframes ?? []).filter((k) => !(k.property === property && Math.abs(k.time - (playhead - layer.start)) < 0.02)), makeKeyframe(property as KeyframeProperty, playhead - layer.start, current)]
              onLayer({ keyframes: next })
            }}
          >
            <UiIcon icon={SemIcons.plus} size="xs" />
            {label}
          </button>
        ))}
      </div>
    </Group>
  )
}
