import { MenuSelect } from '@/shared/components/MenuSelect'
import { Group, NumberField } from '@/features/scene-editor/components/inspector/InspectorFields'
import type { EditorLayer } from '@/features/scene-editor/model/types'

export interface LayerAssetGroupProps {
  layer: EditorLayer
  onChooseAsset: () => void
  onLayer: (patch: Partial<EditorLayer>) => void
}

/** 检查器中图层的「素材」分组：选择或替换绑定的素材，按图层类型设置填充方式、起点与音量。 */
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
          <MenuSelect label="" className="se-menu" ariaLabel="素材填充方式" value={layer.fit}
            options={[{ value: 'contain', label: '完整显示' }, { value: 'cover', label: '填满裁切' }]}
            onChange={(v) => onLayer({ fit: v as EditorLayer['fit'] })} />
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
