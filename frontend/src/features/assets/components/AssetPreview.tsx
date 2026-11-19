import { useEffect, useState } from 'react'
import { type MyAsset } from '@/features/assets/model/myAssets'
import { getFileURL } from '@/features/assets/services/assetApiService'
import { SilentVideoPreview } from '@/shared/components/SilentVideoPreview'
import { Icon } from '@/features/assets/components/AssetIcon'

/** 类型化预览：图片/视频/音频真实播放，字体真字样，文档给打开入口 */
export function AssetVideoThumb({ assetId, poster, active }: { assetId: string; poster?: string; active: boolean }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!active) return
    let alive = true
    void getFileURL(assetId).then((src) => { if (alive) setUrl(src) }).catch(() => { /* 静帧保留。 */ })
    return () => { alive = false }
  }, [assetId, active])
  return <SilentVideoPreview key={assetId} src={url} poster={poster} active={active} label="素材静音预览" />
}

export function Preview({ asset, poster }: { asset: MyAsset; poster?: string }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    if (asset.mediaType === 'video' || asset.mediaType === 'audio' || asset.sourceType === 'imported') {
      void getFileURL(asset.id).then((u) => { if (alive) setUrl(u) })
    }
    return () => { alive = false }
  }, [asset])
  if (asset.mediaType === 'image') {
    const src = asset.sourceType === 'imported' ? url : asset.filePath
    return src ? <img src={src} alt={asset.name} /> : <span className="mya-preview-ph"><Icon name="image" /></span>
  }
  if (asset.mediaType === 'video') {
    return url ? <video src={url} controls muted playsInline preload="metadata" poster={poster} />
               : <span className="mya-preview-ph"><Icon name="film" /></span>
  }
  if (asset.mediaType === 'audio') {
    return (
      <div className="mya-audio">
        <Icon name="audio-lines" />
        {url ? <audio src={url} controls preload="metadata" /> : <span className="mya-dim">读取中…</span>}
      </div>
    )
  }
  if (asset.mediaType === 'font') {
    return <FontPreview asset={asset} />
  }
  return (
    <div className="mya-doc">
      <Icon name="file-text" />
      <p>{asset.name}</p>
      <a href={url ?? asset.filePath} target="_blank" rel="noreferrer">打开文件</a>
    </div>
  )
}

export function FontPreview({ asset }: { asset: MyAsset }) {
  const [family, setFamily] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const src = asset.sourceType === 'imported' ? await getFileURL(asset.id) : asset.filePath
        if (!src) throw new Error('no url')
        const fam = `mya-${asset.id}`
        const face = new FontFace(fam, `url(${src})`)
        await face.load()
        document.fonts.add(face)
        if (alive) setFamily(fam)
      } catch { if (alive) setFailed(true) }
    })()
    return () => { alive = false }
  }, [asset])
  if (failed || !family) return <span className="mya-preview-ph"><Icon name="pilcrow" /></span>
  return (
    <div className="mya-font" style={{ fontFamily: family }}>
      <div className="mya-font-big">风动影随 Aa 0123</div>
      <div className="mya-font-sm">The quick brown fox jumps over the lazy dog. 字幕字幕字幕</div>
    </div>
  )
}
