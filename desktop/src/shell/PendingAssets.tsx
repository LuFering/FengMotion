/**
 * 「待发送」入口 + 抽屉 —— 导航栏常驻，收纳准备交给 Agent 的素材。
 *
 * 为什么不是购物车：交互（攒、角标、拖进去）用购物车隐喻，但文字必须说清它
 * 还没发出去。用户点开抽屉时看到的是一份**待确认的清单**，不是"已下单"。
 *
 * 拖放要点：只有应用内拖素材（自定义 MIME）才算数。从系统拖文件进来会触发
 * 素材库的导入监听，这里如果也接受，同一个动作会既导入又加入待发送 —— 所以
 * isAssetDrag() 只认 PENDING_DRAG_TYPE，其余一律不接管、不 preventDefault。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { X, Trash2, Send, PackagePlus, AlertTriangle, FileText, Image as ImageIcon, Film, Music2, Type, ShoppingCart } from 'lucide-react'
import { MEDIA_LABEL, type MyAsset } from '@/data/myAssets'
import { formatBytes, formatDur, getThumbURL, listAssets } from '@/services/assetService'
import {
  PURPOSE_HINT, PURPOSE_LABEL, isAssetDrag, readAssetDragData,
  usePendingAssets, type AssetPurpose, type PendingAsset,
} from '@/shell/usePendingAssets'
import type { DeliverableAsset } from '@/shell/usePendingAssets'

const MEDIA_ICON = { image: ImageIcon, video: Film, audio: Music2, font: Type, doc: FileText }
const PURPOSES: AssetPurpose[] = ['unspecified', 'visual', 'reference', 'audio', 'information']

/** 抽屉里一条素材需要的展示信息：从素材服务按 ID 重新解析，
 *  不缓存 blob: URL（刷新后失效），只在本次会话里留着给缩略图用。 */
interface Resolved extends PendingAsset {
  asset: MyAsset | null
  thumb: string | null
  missing: boolean
}

/** 拖拽时的「接近判定」半径（px）。
 *  取 150：素材卡在左栏，购物车也在左侧，用户拖到附近就该有反应；
 *  太小要靠得很准才有反馈，太大又会在还没打算放的时候就亮起来。 */
const NEAR_RADIUS = 150

/** 秒 → "00:12 – 00:19"；参考片段靠它表达"带过去的是哪一段" */
function fmtRange(startSec: number, endSec: number): string {
  const f = (t: number) => {
    const m = Math.floor(t / 60)
    const sec = Math.floor(t % 60)
    return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
  }
  return `${f(startSec)} – ${f(endSec)}`
}

export function PendingAssetsButton({
  onOpen, onAdd, toast,
}: {
  onOpen: () => void
  onAdd: (ids: string[]) => number
  toast: (text: string) => void
}) {
  const { items } = usePendingAssets()
  const ref = useRef<HTMLButtonElement | null>(null)
  /* near = 拖拽物离购物车够近（放大图标 + 起圆环）
     over = 已经压到按钮上（真正可放置） */
  const [near, setNear] = useState(false)
  const [over, setOver] = useState(false)
  /* 气泡用 fixed 定位：侧栏 overflow-x 是 hidden，absolute 探出去会被裁掉，
     用户就看不到「松手放入」这句。坐标在 over 变成 true 时算一次。 */
  const [hintAt, setHintAt] = useState<{ left: number; top: number } | null>(null)
  const depth = useRef(0)

  /* HTML5 拖拽期间 dragover 只在**元素自己**身上触发，指针还在别处时
     拿不到坐标 —— 想「靠近就亮」就必须全局监听。
     用 pointermove 不行（拖拽中它不触发），要监听 dragover/drag 冒泡到 window。 */
  const onWindowDrag = useCallback((e: DragEvent) => {
    const el = ref.current
    if (!el) return
    if (!isAssetDrag(e.dataTransfer)) {
      setNear(false)
      return
    }
    const r = el.getBoundingClientRect()
    const cx = r.left + r.width / 2
    const cy = r.top + r.height / 2
    const dist = Math.hypot(e.clientX - cx, e.clientY - cy)
    setNear(dist < NEAR_RADIUS)
  }, [])

  useEffect(() => {
    const stop = () => { setNear(false); setOver(false) }
    window.addEventListener('dragover', onWindowDrag, true)
    window.addEventListener('drop', stop, true)
    window.addEventListener('dragend', stop, true)
    return () => {
      window.removeEventListener('dragover', onWindowDrag, true)
      window.removeEventListener('drop', stop, true)
      window.removeEventListener('dragend', stop, true)
    }
  }, [onWindowDrag])

  return (
    <button
      ref={ref}
      type="button"
      className="hm-pending"
      data-near={near || undefined}
      data-over={over || undefined}
      data-empty={items.length === 0 || undefined}
      aria-label={items.length > 0 ? `待发送，${items.length} 个素材` : '待发送，暂无素材'}
      title="待发送素材"
      onClick={onOpen}
      onDragEnter={(e) => {
        if (!isAssetDrag(e.dataTransfer)) return
        e.preventDefault()
        depth.current += 1
        setOver(true)
        const r = ref.current?.getBoundingClientRect()
        if (r) setHintAt({ left: r.right + 10, top: r.top + r.height / 2 })
      }}
      onDragOver={(e) => {
        if (!isAssetDrag(e.dataTransfer)) return
        /* 必须 preventDefault 才允许 drop。只对应用内素材这么做，
           系统文件拖拽走素材库自己的导入监听，这里不抢。 */
        e.preventDefault()
        e.dataTransfer!.dropEffect = 'copy'
      }}
      onDragLeave={() => {
        depth.current = Math.max(0, depth.current - 1)
        if (depth.current === 0) { setOver(false); setHintAt(null) }
      }}
      onDrop={(e) => {
        if (!isAssetDrag(e.dataTransfer)) return
        e.preventDefault()
        depth.current = 0
        setOver(false)
        setNear(false)
        setHintAt(null)
        const ids = readAssetDragData(e.dataTransfer!)
        if (ids.length === 0) return
        const n = onAdd(ids)
        toast(n > 0 ? `已添加 ${n} 个素材` : '已在待发送中')
      }}
    >
      {/* 等距扩散的圆环：只在「靠近」时出现，三道圈同时放大淡出，
          传达"还差一点就进去了"。aria-hidden —— 纯视觉提示。 */}
      <span className="hm-pending-rings" aria-hidden="true">
        <i /><i /><i />
      </span>
      <span className="hm-pending-ico">
        <ShoppingCart className="ui-icon" size={20} aria-hidden="true" />
      </span>
      <span className="hm-nav-text">待发送</span>
      {items.length > 0 && <span className="hm-pending-badge" aria-hidden="true">{items.length}</span>}
      {over && hintAt && (
        <span className="hm-pending-hint" style={{ left: hintAt.left, top: hintAt.top }}>松手放入</span>
      )}
    </button>
  )
}

export function PendingAssetsDrawer({
  open, onClose, onSend,
}: {
  open: boolean
  onClose: () => void
  /** 交给对话输入框；返回 true 表示已放入，可以据此清理本次发送项 */
  onSend: (list: DeliverableAsset[]) => boolean
}) {
  const { items, remove, removeMany, clear, patch } = usePendingAssets()
  const [assets, setAssets] = useState<MyAsset[]>([])
  const [thumbs, setThumbs] = useState<Record<string, string | null>>({})
  const [sending, setSending] = useState(false)

  /* 每次打开都重新问素材服务要一次：素材可能被删、被改名，缓存会骗人 */
  useEffect(() => {
    if (!open) return
    let alive = true
    void (async () => {
      const list = await listAssets()
      if (!alive) return
      setAssets(list)
      const map: Record<string, string | null> = {}
      for (const p of items) {
        map[p.assetId] = await getThumbURL(p.assetId)
        if (!alive) return
      }
      setThumbs(map)
    })()
    return () => { alive = false }
  }, [open, items])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const resolved = useMemo<Resolved[]>(() => {
    const byId = new Map(assets.map((a) => [a.id, a]))
    return items.map((p) => {
      /* 参考片段不在素材库里，不能按"素材缺失"处理 ——
         它的缩略图、标题、参数都随条目自带。 */
      if (p.kind === 'ref' && p.ref) {
        return { ...p, asset: null, thumb: p.ref.poster ?? null, missing: false }
      }
      if (p.kind === 'fx' && p.fx) {
        return { ...p, asset: null, thumb: p.fx.poster ?? null, missing: false }
      }
      const asset = byId.get(p.assetId) ?? null
      return { ...p, asset, thumb: thumbs[p.assetId] ?? null, missing: !asset }
    })
  }, [items, assets, thumbs])

  const sendable = resolved.filter((r) => !r.missing)

  if (!open) return null

  return (
    <div className="fmp-backdrop" onClick={onClose}>
      <aside className="fmp" role="dialog" aria-modal="true" aria-label="待发送素材"
             onClick={(e) => e.stopPropagation()}>
        <header className="fmp-head">
          <div>
            <h2>待发送</h2>
            <p>先攒起来，再一起交给 AI。加入这里还没有发送，也没有算作已使用。</p>
          </div>
          <button type="button" className="fmp-x" aria-label="关闭" onClick={onClose}><X size={16} /></button>
        </header>

        {resolved.length === 0 ? (
          <div className="fmp-empty">
            <PackagePlus size={26} />
            <b>还没有待发送的素材</b>
            <p>在「我的素材」里点卡片上的 ＋，或把卡片拖到左侧导航的「待发送」。</p>
          </div>
        ) : (
          <ul className="fmp-list">
            {resolved.map((r) => (
              <li key={r.assetId} className="fmp-item" data-missing={r.missing || undefined}
                  data-kind={r.kind === 'ref' ? 'ref' : r.kind === 'fx' ? 'fx' : undefined}>
                <span className="fmp-thumb">
                  {r.thumb ? <img src={r.thumb} alt="" />
                    : r.asset
                      ? (() => { const I = MEDIA_ICON[r.asset.mediaType]; return <I size={18} /> })()
                      : <AlertTriangle size={18} />}
                </span>

                {/* 参考片段：标题 + 时间段 + 可借鉴参数。
                    参数必须在这里露出来 —— 用户要能确认"带过去的是这些"，
                    而不是一条只写着片名的黑盒。 */}
                {r.kind === 'ref' && r.ref ? (
                  <div className="fmp-main">
                    <b title={r.ref.title}>{r.ref.title}</b>
                    <span className="fmp-meta num">
                      {fmtRange(r.ref.start, r.ref.end)}
                    </span>
                    <div className="fmp-refparams">
                      {([
                        ['运镜', r.ref.params.cameraMove],
                        ['节奏', r.ref.params.rhythm],
                        ['光线', r.ref.params.lighting],
                        ['构图', r.ref.params.composition],
                        ['转场', r.ref.params.transition],
                      ] as const).filter(([, v]) => v).map(([k, v]) => (
                        <span key={k} className="fmp-refparam"><i>{k}</i>{v}</span>
                      ))}
                    </div>
                  </div>
                ) : r.kind === 'fx' && r.fx ? (
                  <div className="fmp-main">
                    <b title={r.fx.name}>{r.fx.name}</b>
                    <span className="fmp-meta">{r.fx.intent}</span>
                    <div className="fmp-refparams">
                      <span className="fmp-refparam"><i>分类</i>{r.fx.categoryLabel}</span>
                      <span className="fmp-refparam"><i>实现</i>{r.fx.execLabel}</span>
                      <span className="fmp-refparam"><i>复杂度</i>{r.fx.complexity}/5</span>
                    </div>
                  </div>
                ) : (
                <div className="fmp-main">
                  <b title={r.asset?.name}>{r.asset?.name ?? '素材已移除'}</b>
                  <span className="fmp-meta">
                    {r.missing
                      ? '这个素材已从素材库删除，无法发送'
                      : <>
                          {MEDIA_LABEL[r.asset!.mediaType]}
                          {r.asset!.duration ? ` · ${formatDur(r.asset!.duration)}` : ''}
                          {r.asset!.width && r.asset!.height ? ` · ${r.asset!.width}×${r.asset!.height}` : ''}
                          {` · ${formatBytes(r.asset!.sizeBytes)}`}
                        </>}
                  </span>

                  {!r.missing && (
                    <>
                      <div className="fmp-ctl">
                        <select className="fmp-purpose" value={r.purpose}
                                aria-label={`${r.asset!.name} 的用途`}
                                onChange={(e) => patch(r.assetId, { purpose: e.target.value as AssetPurpose })}>
                          {PURPOSES.map((p) => <option key={p} value={p}>{PURPOSE_LABEL[p]}</option>)}
                        </select>
                        <span className="fmp-purpose-hint">{PURPOSE_HINT[r.purpose]}</span>
                      </div>
                      <input className="fmp-note" type="text" value={r.note ?? ''}
                             placeholder="可选：补充一句说明，例如「参考这里的配色，不要用人物」"
                             aria-label={`${r.asset!.name} 的说明`}
                             onChange={(e) => patch(r.assetId, { note: e.target.value || undefined })} />
                    </>
                  )}
                </div>
                )}

                <button type="button" className="fmp-rm" aria-label={`从待发送移除 ${r.ref?.title ?? r.asset?.name ?? r.assetId}`}
                        onClick={() => remove(r.assetId)}><X size={14} /></button>
              </li>
            ))}
          </ul>
        )}

        <footer className="fmp-foot">
          <button type="button" className="fmp-clear" disabled={resolved.length === 0}
                  onClick={() => clear()}>
            <Trash2 size={14} /> 清空
          </button>
          <span className="fmp-foot-note">
            {resolved.length > 0 && sendable.length < resolved.length
              ? `${resolved.length - sendable.length} 个素材已失效，不会被发送`
              : '清空只清这份清单，不会删除素材库里的文件'}
          </span>
          <button type="button" className="fmp-send" disabled={sendable.length === 0 || sending}
                  onClick={() => {
                    setSending(true)
                    /* 只有真的放进了输入框才清理清单；放不进去（没有当前对话）就原样留着 */
                    const ok = onSend(sendable.map((r) => ({
                      assetId: r.assetId,
                      name: r.asset!.name,
                      kind: r.asset!.mediaType === 'image' ? 'image'
                        : r.asset!.mediaType === 'video' ? 'video' : 'file',
                      purpose: r.purpose,
                      note: r.note,
                    })))
                    if (ok) removeMany(sendable.map((r) => r.assetId))
                    setSending(false)
                    if (ok) onClose()
                  }}>
            <Send size={14} /> 添加到对话
          </button>
        </footer>
      </aside>
    </div>
  )
}
