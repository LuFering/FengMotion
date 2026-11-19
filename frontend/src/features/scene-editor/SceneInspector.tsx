import type { EditorLayer, ElementPatch, HtmlElementInfo, SceneDocument } from '@/features/scene-editor/types'
import { Group } from '@/features/scene-editor/components/inspector/InspectorFields'
import { SceneSpecGroup } from '@/features/scene-editor/components/inspector/SceneSpecGroup'
import { ElementLayoutGroup } from '@/features/scene-editor/components/inspector/ElementLayoutGroup'
import { ElementTextGroup } from '@/features/scene-editor/components/inspector/ElementTextGroup'
import { LayerKeyframeGroup } from '@/features/scene-editor/components/inspector/LayerKeyframeGroup'
import { LayerTimingGroup } from '@/features/scene-editor/components/inspector/LayerTimingGroup'
import { LayerLayoutGroup } from '@/features/scene-editor/components/inspector/LayerLayoutGroup'
import { LayerAssetGroup } from '@/features/scene-editor/components/inspector/LayerAssetGroup'
import { LayerTextGroup } from '@/features/scene-editor/components/inspector/LayerTextGroup'
import { LayerActions } from '@/features/scene-editor/components/inspector/LayerActions'
export function SceneInspector({
  document,
  layer,
  element,
  selected,
  onDocument,
  onLayer,
  onPatch,
  onChooseAsset,
  onDelete,
  onDuplicate,
  onReorder,
  playhead,
}: {
  document: SceneDocument
  layer?: EditorLayer
  element?: HtmlElementInfo
  selected: string | null
  onDocument: (patch: Partial<SceneDocument>) => void
  onLayer: (patch: Partial<EditorLayer>) => void
  onPatch: (patch: ElementPatch) => void
  onChooseAsset: () => void
  onDelete: () => void
  onDuplicate: () => void
  onReorder: (direction: number) => void
  /** 当前播放头（秒）：在这一点上打关键帧，用户看到的就是这一帧。 */
  playhead: number
}) {
  const patch = selected ? (document.patches[selected] ?? {}) : {}
  const native = document.engine === 'remotion'
  return (
    <div className="se-inspector-content">
      <header className="se-inspector-title">
        <span>{layer ? '图层属性' : element ? '源元素属性' : '场景设置'}</span>
        <strong>{layer?.name ?? element?.name ?? document.name}</strong>
      </header>
      {native && layer ? (
        <>
          <LayerActions layer={layer} onDelete={onDelete} onDuplicate={onDuplicate} onLayer={onLayer} onReorder={onReorder} />
          <fieldset disabled={layer.locked}>
            <label className="se-field">
              <span>图层名称</span>
              <input
                aria-label="图层名称"
                value={layer.name}
                onChange={(e) => onLayer({ name: e.target.value })}
              />
            </label>
            {layer.kind === 'text' && (
              <LayerTextGroup layer={layer} onLayer={onLayer} />
            )}
            {['image', 'video', 'audio'].includes(layer.kind) && (
              <LayerAssetGroup layer={layer} onChooseAsset={onChooseAsset} onLayer={onLayer} />
            )}
            {layer.kind !== 'audio' && (
              <LayerLayoutGroup layer={layer} onLayer={onLayer} />
            )}
            <LayerTimingGroup document={document} layer={layer} onLayer={onLayer} />
            {layer && (
              <LayerKeyframeGroup layer={layer} onLayer={onLayer} playhead={playhead} />
            )}
          </fieldset>
        </>
      ) : !native && element ? (
        <>
          <p className="se-caption">
            直接编辑源工程的 {element.id}。原有 GSAP 动画保留，位移与旋转作为增量叠加。
          </p>
          {element.kind === 'text' && (
            <ElementTextGroup element={element} onPatch={onPatch} patch={patch} />
          )}
          {element.gradientText && !patch.color && (
            <p className="se-caption">原文字使用渐变填充。选择颜色后将覆盖为纯色，可恢复原貌。</p>
          )}
          {element.kind === 'image' && (
            <Group title="图片素材">
              <button type="button" className="se-action" onClick={onChooseAsset}>
                替换源图片
              </button>
              <p className="se-caption">使用素材库真实文件，保留原场景图片动画。</p>
            </Group>
          )}
          <ElementLayoutGroup document={document} onDocument={onDocument} onPatch={onPatch} patch={patch} selected={selected} />
        </>
      ) : (
        <>
          <SceneSpecGroup document={document} native={native} onDocument={onDocument} />
          {!native && (
            <Group title="真实来源">
              <p className="se-caption">{document.source?.source}</p>
              <code className="se-source-hash">SHA-256 {document.source?.sourceHash.slice(0, 16)}…</code>
              <p className="se-caption">本机导入的源工程副本。修改保存为覆盖记录，原始文件保持不变。</p>
            </Group>
          )}
        </>
      )}
    </div>
  )
}
