import { useEffect, useState } from 'react'
import { type MyAsset } from '@/features/assets/model/myAssets'
import { assetFormatBadge } from '@/features/assets/model/assetDisplay'
import { formatDur, getFileURL } from '@/features/assets/services/assetApiService'
import { SilentVideoPreview } from '@/shared/components/SilentVideoPreview'
import { Icon } from '@/features/assets/components/AssetIcon'

function resolvePlayableUrl(id: string, filePath: string): Promise<string | null> {
  if (filePath && (filePath.startsWith('./') || filePath.startsWith('/ledger/'))) {
    return Promise.resolve(filePath)
  }
  return getFileURL(id)
}

/** 视频卡片静音悬停预览 */
export function AssetVideoThumb({ assetId, poster, active }: { assetId: string; poster?: string; active: boolean }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!active) return
    let alive = true
    void getFileURL(assetId).then((src) => { if (alive) setUrl(src) }).catch(() => { /* 静帧保留 */ })
    return () => { alive = false }
  }, [assetId, active])
  return <SilentVideoPreview key={assetId} src={url} poster={poster} active={active} label="素材静音预览" />
}

/** 图片失败留在原尺寸内，避免破图挤压卡片与列表。 */
export function AssetImageThumb({ src }: { src: string }) {
  const [failed, setFailed] = useState(false)
  return failed
    ? <span className="mya-preview-error"><Icon name="image" /><span>预览不可用</span></span>
    : <img src={src} alt="" loading="lazy" draggable={false} onError={() => setFailed(true)} />
}

/** 字体卡片的真实字样卡面：加载字体后直接展示「Aa 风动」，不再显示空洞的灰图标 */
export function AssetFontCardSurface({ asset }: { asset: MyAsset }) {
  const [family, setFamily] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    let loadedFace: FontFace | undefined
    ;(async () => {
      try {
        const src = await resolvePlayableUrl(asset.id, asset.filePath)
        if (!src) return
        const fam = `mya-card-${asset.id.replace(/[^a-zA-Z0-9_-]/g, '_')}`
        const face = new FontFace(fam, `url(${src})`)
        await face.load()
        if (!alive) return
        loadedFace = face
        document.fonts.add(face)
        setFamily(fam)
      } catch {
        /* 字体加载失败时保留默认衬底字样 */
      }
    })()
    return () => { alive = false; if (loadedFace) document.fonts.delete(loadedFace) }
  }, [asset.id, asset.filePath])

  return (
    <div className="mya-surface mya-surface-font" style={family ? { fontFamily: family } : undefined}>
      <span className="mya-surface-glyph">Aa</span>
      <span className="mya-surface-sample">{family ? '风动影随 · 0123' : '字体预览未加载'}</span>
    </div>
  )
}

/** 音频与文档卡片的类型化卡面：类型图标与真实格式/时长，不生成虚构波形 */
export function AssetTypedCardSurface({ asset }: { asset: MyAsset }) {
  const badge = assetFormatBadge(asset)
  if (asset.mediaType === 'audio') {
    return (
      <div className="mya-surface mya-surface-audio">
        <Icon name="music" className="mya-type-symbol" />
        <div className="mya-surface-tag">
          <span className="mya-surface-ext">{badge}</span>
          {asset.duration != null && <span className="mya-surface-dur num">{formatDur(asset.duration)}</span>}
        </div>
      </div>
    )
  }
  return (
    <div className="mya-surface mya-surface-doc">
      <Icon name="file-text" className="mya-type-symbol" />
      <span className="mya-surface-tag">{badge}</span>
    </div>
  )
}

/** 右栏检查器的类型化真实预览：图片/视频/音频真实播放，字体真字样，文档提供打开入口 */
export function Preview({ asset, poster }: { asset: MyAsset; poster?: string }) {
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let alive = true
    void resolvePlayableUrl(asset.id, asset.filePath).then((u) => { if (alive) setUrl(u) }).catch(() => { if (alive) setFailed(true) })
    return () => { alive = false }
  }, [asset.id, asset.filePath, attempt])

  if (failed) return <div className="mya-preview-error"><Icon name="circle-alert" /><span>暂时无法预览此文件</span><button className="mya-toolbtn" onClick={() => { setFailed(false); setUrl(null); setAttempt(n => n + 1) }}>重新加载</button></div>

  if (asset.mediaType === 'image') {
    const src = url || poster
    return src ? <img key={attempt} src={src} alt={asset.name} onError={() => setFailed(true)} /> : <span className="mya-preview-ph"><Icon name="image" /></span>
  }
  if (asset.mediaType === 'video') {
    return url ? <video key={attempt} onError={() => setFailed(true)} src={url} controls muted playsInline preload="metadata" poster={poster} />
               : <span className="mya-preview-ph"><Icon name="film" /></span>
  }
  if (asset.mediaType === 'audio') {
    return (
      <div className="mya-audio">
        <Icon name="music" className="mya-type-symbol" />
        {url ? <audio key={attempt} onError={() => setFailed(true)} src={url} controls preload="metadata" /> : <span className="mya-dim">读取中…</span>}
      </div>
    )
  }
  if (asset.mediaType === 'font') {
    return <FontPreview asset={asset} />
  }
  return (
    <div className="mya-doc">
      <span className="mya-doc-badge">{assetFormatBadge(asset)}</span>
      <p className="mya-doc-title" title={asset.name}>{asset.name}</p>
      {url && (
        <a className="mya-doc-open" href={url} target="_blank" rel="noreferrer">
          <Icon name="arrow-up-right" />打开原文件
        </a>
      )}
    </div>
  )
}

export function FontPreview({ asset }: { asset: MyAsset }) {
  const [family, setFamily] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let alive = true
    let loadedFace: FontFace | undefined
    ;(async () => {
      try {
        const src = await resolvePlayableUrl(asset.id, asset.filePath)
        if (!src) throw new Error('no url')
        const fam = `mya-insp-${asset.id.replace(/[^a-zA-Z0-9_-]/g, '_')}`
        const face = new FontFace(fam, `url(${src})`)
        await face.load()
        if (!alive) return
        loadedFace = face
        document.fonts.add(face)
        setFamily(fam)
      } catch { if (alive) setFailed(true) }
    })()
    return () => { alive = false; if (loadedFace) document.fonts.delete(loadedFace) }
  }, [asset.id, asset.filePath])
  if (failed || !family) return <span className="mya-preview-ph">{failed ? '字体预览不可用' : '正在加载字体…'}</span>
  return (
    <div className="mya-font" style={{ fontFamily: family }}>
      <div className="mya-font-big">风动影随 Aa 0123</div>
      <div className="mya-font-sm">The quick brown fox jumps over the lazy dog · 标题与字幕字样</div>
    </div>
  )
}
