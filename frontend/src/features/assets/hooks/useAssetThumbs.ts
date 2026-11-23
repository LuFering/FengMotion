import type * as React from 'react'
import { useEffect } from 'react'
import { assetThumbUrl } from '@/features/assets/services/assetApiService'
import type { MyAsset } from '@/features/assets/model/myAssets'

export interface UseAssetThumbsArgs {
  assets: MyAsset[]
  setThumbs: React.Dispatch<React.SetStateAction<Record<string, string>>>
}

/**
 * 我的素材的缩略图解析：
 * 列表接口已返回 `thumbnailUrl`（映射为 `thumbnailPath`），直接按路径规则生成完整可访问地址，
 * 不再对无缩略图的音频/字体/文档逐条发起 N+1 详情请求。
 */
export function useAssetThumbs({ assets, setThumbs }: UseAssetThumbsArgs) {
  useEffect(() => {
    const next: Record<string, string> = {}
    for (const a of assets) {
      if (!a.thumbnailPath) continue
      const isStaticPublic = a.thumbnailPath.startsWith('./') || a.thumbnailPath.startsWith('/ledger/')
      next[a.id] = isStaticPublic ? a.thumbnailPath : assetThumbUrl(a.id)
    }
    setThumbs(next)
  }, [assets, setThumbs])
  return {}
}
