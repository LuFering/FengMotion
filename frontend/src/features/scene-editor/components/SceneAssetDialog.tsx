import type * as React from 'react'
import { UiIcon, SemIcons } from '@/shared/icons/UiIcon'
import { importFiles, listAssets } from '@/features/assets/services/assetApiService'
import { MusicNote01, ImagePlus } from '@untitledui/icons'
import type { MyAsset } from '@/features/assets/model/myAssets'
import type { LayerKind } from '@/features/scene-editor/types'

export interface SceneAssetDialogProps {
  assetSearch: string
  expectedKind: LayerKind | undefined
  filteredAssets: MyAsset[]
  input: React.RefObject<HTMLInputElement | null>
  pickAsset: (asset: MyAsset) => Promise<void>
  setAssetPicker: React.Dispatch<React.SetStateAction<boolean>>
  setAssetSearch: React.Dispatch<React.SetStateAction<string>>
  setAssets: React.Dispatch<React.SetStateAction<MyAsset[]>>
  setMessage: React.Dispatch<React.SetStateAction<string>>
}

/** 从 SceneEditorWorkspace.tsx 原样拆出的界面区块；props 与原处的变量同名。 */
export function SceneAssetDialog({ assetSearch, expectedKind, filteredAssets, input, pickAsset, setAssetPicker, setAssetSearch, setAssets, setMessage }: SceneAssetDialogProps) {
  return (
    <section className="se-asset-dialog" role="dialog" aria-modal="true" aria-label="选择真实素材">
      <header>
        <div>
          <h2>
            选择{expectedKind === 'image' ? '图片' : expectedKind === 'video' ? '视频' : '声音'}素材
          </h2>
          <p>绑定素材库文件，支持本机持久化。</p>
        </div>
        <button
          type="button"
          className="se-icon"
          aria-label="关闭素材选择"
          onClick={() => setAssetPicker(false)}
        >
          <UiIcon icon={SemIcons.close} size="md" />
        </button>
      </header>
      <div className="se-asset-search">
        <input
          aria-label="搜索编辑素材"
          placeholder="搜索文件名"
          value={assetSearch}
          onChange={(e) => setAssetSearch(e.target.value)}
        />
        <button type="button" className="se-action" onClick={() => input.current?.click()}>
          <UiIcon icon={SemIcons.upload} size="sm" />
          导入文件
        </button>
        <input
          ref={input}
          hidden
          type="file"
          accept={`${expectedKind}/*`}
          onChange={(e) => {
            const files = Array.from(e.target.files ?? [])
            if (files.length)
              void importFiles(files, () => {})
                .then(async (outcome) => {
                  setAssets(await listAssets())
                  if (outcome.created[0]) await pickAsset(outcome.created[0])
                  else if (outcome.failed[0]) setMessage(outcome.failed[0].error)
                })
                .catch((err) => setMessage(String(err)))
            e.target.value = ''
          }}
        />
      </div>
      <div className="se-assets">
        {filteredAssets.length ? (
          filteredAssets.slice(0, 80).map((asset) => (
            <button key={asset.id} type="button" onClick={() => void pickAsset(asset)}>
              {asset.mediaType === 'image' && asset.sourceType === 'builtin' ? (
                <img src={asset.filePath} alt="" />
              ) : asset.mediaType === 'video' ? (
                <UiIcon icon={SemIcons.film} size="xl" />
              ) : asset.mediaType === 'audio' ? (
                <UiIcon icon={MusicNote01} size="xl" />
              ) : (
                <UiIcon icon={ImagePlus} size="xl" />
              )}
              <span>{asset.name}</span>
              <small>
                {asset.width && asset.height
                  ? `${asset.width} × ${asset.height}`
                  : asset.duration
                    ? `${asset.duration.toFixed(1)}s`
                    : asset.sourceType === 'imported'
                      ? '本机文件'
                      : '素材文件'}
              </small>
            </button>
          ))
        ) : (
          <p>还没有匹配的文件，可以导入自己的素材。</p>
        )}
      </div>
    </section>
  )
}
