import { Group, NumberField } from '@/features/scene-editor/components/inspector/InspectorFields'
import type { EditorLayer } from '@/features/scene-editor/types'

export interface LayerAssetGroupProps {
  layer: EditorLayer
  onChooseAsset: () => void
  onLayer: (patch: Partial<EditorLayer>) => void
}

/** 从 SceneInspector.tsx 原样拆出的界面区块；props 与原处的变量同名。 */
export function LayerAssetGroup({ layer, onChooseAsset, onLayer }: LayerAssetGroupProps) {
  return (
    <Group title="素材">
      <button type="button" className="se-action" onClick={onChooseAsset}>
        {layer.assetId || layer.src ? '替换素材' : '选择素材'}
      </button>
      <p className="se-caption">
        {layer.assetId
          ? '已绑定素材库文件，刷新后可恢复'
          : layer.src
            ? '已绑定文件路径'
            : '此图层尚未绑定文件'}
      </p>
      {layer.kind !== 'audio' && (
        <label className="se-field">
          <span>填充方式</span>
          <select
            aria-label="素材填充方式"
            value={layer.fit}
            onChange={(e) => onLayer({ fit: e.target.value as EditorLayer['fit'] })}
          >
            <option value="contain">完整显示</option>
            <option value="cover">填满裁切</option>
          </select>
        </label>
      )}
      {layer.kind !== 'image' && (
        <>
          <NumberField
            label="素材起点（秒）"
            min={0}
            max={36000}
            step={0.1}
            value={layer.trimStart}
            onChange={(trimStart) => onLayer({ trimStart })}
          />
          <NumberField
            label="音量"
            min={0}
            max={2}
            step={0.05}
            value={layer.volume}
            onChange={(volume) => onLayer({ volume })}
          />
        </>
      )}
    </Group>
  )
}
