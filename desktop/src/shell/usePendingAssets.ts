/**
 * 待发送素材 —— 素材库 → Agent 对话之间的暂存区。
 *
 * 解决的问题：挑素材在素材库，真正用素材的地方在对话/工作台，中间缺一个
 * 「先攒起来、等下一起交给 AI」的入口。用购物车的交互隐喻（导航栏常驻图标 +
 * 数量角标 + 拖进去），但界面文字叫「待发送」——它确实还没发送。
 *
 * 几条边界，写死在数据层，不靠界面自觉：
 *   · **加入待发送 ≠ 已发送，≠ 素材已被项目使用。** 这里只是暂存。
 *   · 按 assetId 去重：同一个文件拖两次不会变成两条。
 *   · 持久化只存 ID 与用户的选择（用途/备注/区间），**不存 blob: URL** ——
 *     blob URL 出了这个页面就失效，存下来只会变成一串打不开的假引用。
 *     缩略图和文件本体每次打开面板时按 ID 重新问素材服务要。
 *   · 素材被删了不静默丢弃，标成「素材已移除」让人自己移除 ——
 *     静默消失会让人以为"我明明加过"。
 */
import { useCallback, useEffect, useState } from 'react'

export type AssetPurpose = 'unspecified' | 'visual' | 'reference' | 'audio' | 'information'

export const PURPOSE_LABEL: Record<AssetPurpose, string> = {
  unspecified: '未指定',
  visual: '用于画面',
  reference: '作为参考',
  audio: '作为音频',
  information: '提供信息',
}

/** 用途的一句话说明：下拉里给人看，避免「用于画面 / 作为参考」分不清 */
export const PURPOSE_HINT: Record<AssetPurpose, string> = {
  unspecified: '交给 AI 结合消息判断，必要时它会追问',
  visual: '可能出现在成片里的素材：产品图、Logo、实拍',
  reference: '只借鉴风格、构图或节奏，不默认剪进成片',
  audio: '音乐、旁白、音效，用于声音制作',
  information: '文案、品牌手册，作为内容与约束依据',
}

/**
 * 待发送里的一条东西。两种来源：
 *   · asset —— 素材库里的文件（按 assetId 去素材服务查）
 *   · ref   —— 参考片库里的片段（不在素材库里，参数随条目自带）
 *
 * 为什么要区分：参考片段的存在意义不是"一个文件"，而是
 * 「这段画面能借鉴什么」。分析参数必须跟着走，否则拖到工作台
 * 只剩一段无说明的视频，AI 只能自己猜 —— 那正是要避免的。
 */
export interface PendingRefCard {
  /** 参考片段 ID，形如 REF-01@00:12.4 */
  segmentId: string
  title: string
  /** 起止秒数；后端切分决定，前端只存 */
  start: number
  end: number
  /** 封面图（相对路径） */
  poster?: string
  /** 五项可借鉴点 + 结论，随条目一起带到工作台 */
  params: {
    cameraMove?: string
    composition?: string
    lighting?: string
    rhythm?: string
    transition?: string
    reusable?: string
  }
  /** 交给 AI 时附带的话 */
  brief?: string
}

/**
 * 特效/技法卡。和参考片段同理：它不是文件，而是「一种做法」，
 * 带过去的是做法本身（分类、用途、实现方式、复杂度），不是一段视频。
 */
export interface PendingFxCard {
  fxId: string
  name: string
  intent: string
  categoryLabel: string
  execLabel: string
  /** 1–5 */
  complexity: number
  impl: string
  poster?: string
}

export interface PendingAsset {
  /** 素材 ID；参考条目为 segmentId；特效为 fxId */
  assetId: string
  /** 缺省视为 asset，兼容旧存档 */
  kind?: 'asset' | 'ref' | 'fx'
  /** 仅参考条目有 */
  ref?: PendingRefCard
  /** 仅特效条目有 */
  fx?: PendingFxCard
  purpose: AssetPurpose
  note?: string
  /** 只记录"用了哪一段"，不代表已经裁切出文件 */
  range?: { startMs: number; endMs: number }
  addedAt: number
}

const KEY = 'fm-pending-assets-v1'
const MAX = 24

function read(): PendingAsset[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const list = JSON.parse(raw)
    if (!Array.isArray(list)) return []
    return list.filter((x): x is PendingAsset =>
      !!x && typeof x.assetId === 'string' && typeof x.addedAt === 'number')
  } catch {
    return []
  }
}

function write(list: PendingAsset[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list))
  } catch {
    /* 存储不可用时只在内存生效 */
  }
}

export function usePendingAssets() {
  const [items, setItems] = useState<PendingAsset[]>(read)
  /* 跨组件同步：导航栏角标、素材库卡片状态、Drawer 是三处独立的 React 树，
     靠一个自定义事件把它们连起来，免得为了一个数组上全局状态库。 */
  useEffect(() => {
    const sync = () => setItems(read())
    window.addEventListener('fm-pending-changed', sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener('fm-pending-changed', sync)
      window.removeEventListener('storage', sync)
    }
  }, [])

  const commit = useCallback((next: PendingAsset[]) => {
    write(next)
    setItems(next)
    window.dispatchEvent(new CustomEvent('fm-pending-changed'))
  }, [])

  /** 加入。返回本次真正新增的条数（已存在的不算），供界面给准确反馈。 */
  const add = useCallback((assetIds: string[], purpose: AssetPurpose = 'unspecified') => {
    const now = Date.now()
    let added = 0
    const next = [...read()]
    for (const id of assetIds) {
      if (next.some((x) => x.assetId === id)) continue
      if (next.length >= MAX) break
      next.push({ assetId: id, purpose, addedAt: now + added })
      added += 1
    }
    if (added > 0) commit(next)
    return added
  }, [commit])

  /* 参考片段入列：参数随条目自带，不去素材库查（它本来就不在素材库里）。
     用途固定为 reference —— 参考片段的语义就是"借鉴"，不给用户再选一次。 */
  const addRef = useCallback((cards: PendingRefCard[]) => {
    const now = Date.now()
    let added = 0
    const next = [...read()]
    for (const c of cards) {
      if (next.some((x) => x.assetId === c.segmentId)) continue
      if (next.length >= MAX) break
      next.push({ assetId: c.segmentId, kind: 'ref', ref: c, purpose: 'reference', addedAt: now + added })
      added += 1
    }
    if (added > 0) commit(next)
    return added
  }, [commit])

  /* 特效入列：同样参数自带，不去素材库查 */
  const addFx = useCallback((cards: PendingFxCard[]) => {
    const now = Date.now()
    let added = 0
    const next = [...read()]
    for (const c of cards) {
      if (next.some((x) => x.assetId === c.fxId)) continue
      if (next.length >= MAX) break
      next.push({ assetId: c.fxId, kind: 'fx', fx: c, purpose: 'visual', addedAt: now + added })
      added += 1
    }
    if (added > 0) commit(next)
    return added
  }, [commit])

  const remove = useCallback((assetId: string) => {
    commit(read().filter((x) => x.assetId !== assetId))
  }, [commit])

  const removeMany = useCallback((assetIds: string[]) => {
    const drop = new Set(assetIds)
    commit(read().filter((x) => !drop.has(x.assetId)))
  }, [commit])

  const clear = useCallback(() => commit([]), [commit])

  const patch = useCallback((assetId: string, next: Partial<Omit<PendingAsset, 'assetId' | 'addedAt'>>) => {
    commit(read().map((x) => (x.assetId === assetId ? { ...x, ...next } : x)))
  }, [commit])

  const has = useCallback((assetId: string) => items.some((x) => x.assetId === assetId), [items])

  return { items, add, addRef, addFx, remove, removeMany, clear, patch, has }
}

/** 素材库/详情面板里做拖拽时写进 dataTransfer 的自定义类型。
 *  用它把「应用内拖素材」和「从系统拖文件进来」分开 —— 后者会触发导入，
 *  不能因为拖到导航栏就被误当成导入。 */
export const PENDING_DRAG_TYPE = 'application/x-fm-asset-ids'

/** 给拖拽中的元素塞素材 ID；同时塞一个 text/plain 兜底（部分环境只认它） */
export function setAssetDragData(dt: DataTransfer, assetIds: string[]) {
  dt.setData(PENDING_DRAG_TYPE, JSON.stringify(assetIds))
  dt.setData('text/plain', assetIds.length > 1 ? `${assetIds.length} 个素材` : assetIds[0] ?? '')
  dt.effectAllowed = 'copy'
}

/** 从 drop 事件里读回素材 ID；不是应用内素材拖拽就返回空数组 */
export function readAssetDragData(dt: DataTransfer): string[] {
  const raw = dt.getData(PENDING_DRAG_TYPE)
  if (!raw) return []
  try {
    const list = JSON.parse(raw)
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

/** 拖拽过程中能否读出数据：HTML5 在 dragover 阶段拿不到 getData，
 *  只能靠 types 判断——这正是为什么要有自定义 MIME。 */
export function isAssetDrag(dt: DataTransfer | null): boolean {
  if (!dt) return false
  return Array.from(dt.types).includes(PENDING_DRAG_TYPE)
}

/* ── 投递通道：待发送 → 当前对话输入框 ─────────────────────────
   没有用全局状态库：需要投递的只有「当前打开的那个对话」，它挂载时注册一个
   处理器，卸载时注销。没注册 = 当前没有对话，此时投递返回 false，
   清单原样保留 —— 绝不猜一个目标塞进去。 */
export interface DeliverableAsset {
  assetId: string
  name: string
  kind: 'file' | 'image' | 'video'
  purpose: AssetPurpose
  note?: string
}

type DeliverHandler = (list: DeliverableAsset[]) => boolean
let handler: DeliverHandler | null = null

export function registerComposer(h: DeliverHandler | null) {
  handler = h
}

/** 交给当前对话输入框。返回 false 表示没有可用的对话。 */
export function deliverToComposer(list: DeliverableAsset[]): boolean {
  if (!handler || list.length === 0) return false
  return handler(list)
}
