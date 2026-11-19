import type * as React from 'react'
import { useEffect } from 'react'
import { assetThumbUrl, getThumbURL, captureBuiltinPoster } from '@/features/assets/services/assetApiService'
import type { MyAsset } from '@/features/assets/model/myAssets'

export interface UseAssetThumbsArgs {
  assets: MyAsset[]
  setThumbs: React.Dispatch<React.SetStateAction<Record<string, string>>>
}

/** 我的素材的缩略图：素材列表变化时逐个解析缩略图地址，并为视频补一帧海报。 */
export function useAssetThumbs({ assets, setThumbs }: UseAssetThumbsArgs) {
  // ── 缩略图解析（内置图片直接用路径；视频懒截真实帧）──
  useEffect(() => {
    let alive = true
    ;(async () => {
      for (const a of assets) {
        if (!alive) return
        // 列表响应里已经带了 thumbnailUrl，直接拼地址即可 ——
        // 逐条再 get 一次会变成 N+1 请求（素材多时明显变慢），而这里拿到的信息是同一份。
        const u = a.thumbnailPath ? assetThumbUrl(a.id) : await getThumbURL(a.id)
        if (u) setThumbs((m) => (m[a.id] === u ? m : { ...m, [a.id]: u }))
      }
      // 内置视频：懒截一帧当海报（真实帧；小文件先出图）
      const vids = assets.filter((x) => x.mediaType === 'video').sort((x, y) => x.sizeBytes - y.sizeBytes)
      for (const a of vids) {
        if (!alive) return
        {
          const u = await captureBuiltinPoster()
          if (u && alive) setThumbs((m) => ({ ...m, [a.id]: u }))
        }
      }
    })()
    return () => { alive = false }
  }, [assets])
  return {  }
}
