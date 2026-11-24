import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { studioHttpApi } from '@/api'
import { ApiError } from '@/api/errors'
import type { SequenceEntry, SequenceTrack, TrackCategory } from '@/features/workbench/model/sequenceManifest'
import { diffLayers } from '@/features/workbench/model/layerChanges'
import { useWorktreeState } from './useWorktreeState'
import {
  isLiveEvent, type LiveCommand, type LiveCompositionMeta, type LiveElementInfo, type LiveLayerItem, type LiveRect, type LiveSequence,
} from '@/features/workbench/model/livePreviewProtocol'

/** 心跳间隔：后端 10 分钟没收到就回收预览进程（契约 live-preview.md） */
const HEARTBEAT_MS = 120_000

/** box：选中框在工作台页面里的位置（像素），工具条贴着它摆 */
export type LiveSelection =
  | { kind: 'element'; element: LiveElementInfo; anchor: { x: number; y: number }; box: PageBox; stale?: boolean }
  | { kind: 'region'; rect: LiveRect; frame: number; anchor: { x: number; y: number }; box: PageBox; stale?: boolean }

export interface PageBox { left: number; top: number; width: number; height: number }

/** 写回源码的状态：pending = 等预览服务回话；error = 上一次没写成 */
export interface CommitState { pending: boolean; error: { code?: string; message: string } | null }

/** 元素轨上的片段 id 前缀：轨道点选时据此认出「这是一个画面元素」，要去画面里选中它 */
export const LAYER_CLIP_PREFIX = 'el:'

/**
 * 实时数据 → 时间线轨道，规则与出片时的轨道采集一致（backend/remotion/timeline.mjs）：
 * - 片段（Sequence）按嵌套深度分「场景层 1 / 场景层 2 …」，媒体按类型分「视频 / 图片 / 音频」；
 * - 画面元素按真正出现的帧段、按类别（文字 / 图形 / 背景 / 图片与视频）排轨，同时出现的分到同类的不同轨。
 * 同一组内按起点排，放进第一条放得下的轨（同一轨内不重叠）。
 */
export function liveTracks(sequences: LiveSequence[], fps: number, layers: LiveLayerItem[] = []): SequenceTrack[] {
  const byId = new Map(sequences.map((s) => [s.id, s]))
  const depthOf = (s: LiveSequence) => {
    let d = 1
    for (let p = s.parent ? byId.get(s.parent) : undefined, guard = 0; p && guard < 50; p = p.parent ? byId.get(p.parent) : undefined, guard++) d++
    return d
  }
  /* group：同组的片段排进同一套轨；label：轨名（同组多条时加序号） */
  type Pending = { group: string; label: string; numbered: boolean; category: TrackCategory; order: number; clip: SequenceEntry }
  const pending: Pending[] = []
  const MEDIA = { video: ['视频', 'media', 900], image: ['图片', 'media', 901], audio: ['音频', 'audio', 950] } as const
  for (const seq of sequences) {
    if (!(seq.duration > 0) || !Number.isFinite(seq.duration)) continue
    const media = seq.type === 'audio' || seq.type === 'video' || seq.type === 'image' ? MEDIA[seq.type] : null
    const depth = depthOf(seq)
    pending.push({
      group: media ? media[0] : `场景层 ${depth}`, label: media ? media[0] : `场景层 ${depth}`, numbered: false,
      category: media ? media[1] : 'scene', order: media ? media[2] : depth,
      clip: { id: seq.id, name: seq.name, kind: media ? (seq.type as SequenceEntry['kind']) : 'shape', start: seq.from / fps, duration: seq.duration / fps },
    })
  }
  for (const item of layers) {
    const [label, category, order]: [string, TrackCategory, number] = item.kind === 'text' ? ['文字', 'text', 500]
      : item.kind === 'image' || item.kind === 'video' ? ['画面素材', 'media', 800]
      : item.full ? ['背景', 'background', 700] : ['图形', 'shape', 600]
    for (const [from, to] of item.ranges) {
      if (to <= from) continue
      pending.push({
        group: label, label, numbered: true, category, order,
        clip: {
          id: `${LAYER_CLIP_PREFIX}${item.key}@${from}`, name: item.name, kind: item.kind, start: from / fps, duration: (to - from) / fps,
          src: item.src, ...(item.text ? { text: item.text } : {}),
        },
      })
    }
  }
  pending.sort((a, b) => a.order - b.order || a.clip.start - b.clip.start || b.clip.duration - a.clip.duration)
  const lanes: { p: Pending; clips: SequenceEntry[] }[] = []
  for (const p of pending) {
    const lane = lanes.find((l) => l.p.group === p.group && l.clips[l.clips.length - 1].start + l.clips[l.clips.length - 1].duration <= p.clip.start + 1e-6)
    if (lane) lane.clips.push(p.clip)
    else lanes.push({ p, clips: [p.clip] })
  }
  lanes.sort((a, b) => a.p.order - b.p.order)
  const counts = new Map<string, number>()
  return lanes.map((lane, i) => {
    const n = (counts.get(lane.p.group) ?? 0) + 1
    counts.set(lane.p.group, n)
    const many = lane.p.numbered && lanes.filter((l) => l.p.group === lane.p.group).length > 1
    return { id: `live-${i}`, name: many ? `${lane.p.label} ${n}` : lane.p.label, category: lane.p.category, clips: lane.clips }
  })
}

/** 选中的元素对应元素轨上的哪个片段：链上任一层的源码位置对得上，且当前帧落在片段里 */
export function layerClipFor(tracks: SequenceTrack[], chainSrcs: (string | null)[], seconds: number): { trackId: string; clipId: string } | null {
  for (const src of chainSrcs) {
    if (!src) continue
    for (const t of tracks) for (const c of t.clips) {
      if (!c.id.startsWith(`${LAYER_CLIP_PREFIX}${src}@`)) continue
      if (seconds >= c.start - 1e-6 && seconds < c.start + c.duration + 1e-6) return { trackId: t.id, clipId: c.id }
    }
  }
  return null
}

/**
 * 工作台的源码实时预览：向后端要预览进程（没有接口的开发环境用 VITE_FENGMOTION_LIVE_PREVIEW_URL），
 * 用 iframe 加载，经 postMessage 控制播放、接收帧号 / 轨道 / 点选结果 / 编译错误。
 *
 * <p>只负责连接与状态；画面、小窗怎么画在组件里。</p>
 */
export function useLivePreview({ projectId, enabled }: { projectId: string; enabled: boolean }) {
  const worktree = useWorktreeState(projectId, enabled)
  const devUrl = (import.meta.env.VITE_FENGMOTION_LIVE_PREVIEW_URL as string | undefined)?.trim() || null

  /* ── 连接：按项目记账，换项目时旧结果自然作废 ── */
  const connKey = enabled && projectId ? projectId : null
  const [conn, setConn] = useState<{ key: string; url: string | null; message: string } | null>(null)
  useEffect(() => {
    if (!connKey) return
    let alive = true
    const start = () => studioHttpApi().task.startLivePreview(connKey).then((result) => {
      if (!alive) return
      if (result.url) setConn((prev) => (prev?.key === connKey && prev.url === result.url ? prev : { key: connKey, url: result.url, message: '' }))
      else setConn({ key: connKey, url: null, message: '实时预览没有启动' })
    }).catch((error: unknown) => {
      if (!alive) return
      if (devUrl) { setConn((prev) => (prev?.key === connKey && prev.url === devUrl ? prev : { key: connKey, url: devUrl, message: '' })); return }
      const message = error instanceof ApiError && error.code === 'not_found'
        ? '后端还不支持实时预览'
        : error instanceof Error && error.message ? error.message : '实时预览启动失败'
      setConn({ key: connKey, url: null, message })
    })
    void start()
    const timer = window.setInterval(() => { void start() }, HEARTBEAT_MS)
    return () => { alive = false; window.clearInterval(timer) }
  }, [connKey, devUrl])

  const current = conn && conn.key === connKey ? conn : null
  const status: 'off' | 'starting' | 'ready' | 'unavailable' = !connKey ? 'off' : !current ? 'starting' : current.url ? 'ready' : 'unavailable'
  const url = current?.url ?? null

  /* ── 预览窗口里的状态：换了地址就从头来 ── */
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const [meta, setMeta] = useState<LiveCompositionMeta | null>(null)
  const [frame, setFrame] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [sequences, setSequences] = useState<LiveSequence[]>([])
  /* 元素采集结果和「改过的元素」放一起：改动要拿新旧两次采集比，必须在同一次更新里算 */
  const [layerState, setLayerState] = useState<{ items: LiveLayerItem[]; changed: Set<string>; seeded: boolean }>(() => ({ items: [], changed: new Set(), seeded: false }))
  const layers = layerState.items
  /* 刚写回源码的元素：写成了就标出来（等不到下一次采集） */
  const committing = useRef<string | null>(null)
  /* 元素轨采集中：源码刷新后重新采，期间沿用上一次的结果 */
  const [layersPending, setLayersPending] = useState(true)
  const [buildError, setBuildError] = useState<string | null>(null)
  const [runtimeError, setRuntimeError] = useState<string | null>(null)
  const [reloading, setReloading] = useState(false)
  const [selection, setSelection] = useState<LiveSelection | null>(null)
  const [missing, setMissing] = useState<string[] | null>(null)
  const [edits, setEdits] = useState(0)
  const [commit, setCommit] = useState<CommitState>({ pending: false, error: null })
  const [stateFor, setStateFor] = useState(url)
  if (stateFor !== url) {
    setStateFor(url)
    setMeta(null); setFrame(0); setPlaying(false); setSequences([]); setLayerState({ items: [], changed: new Set(), seeded: false }); setLayersPending(true); setBuildError(null)
    setRuntimeError(null); setReloading(false); setSelection(null); setMissing(null); setEdits(0); setCommit({ pending: false, error: null })
  }

  const origin = useMemo(() => { try { return url ? new URL(url).origin : null } catch { return null } }, [url])

  /** iframe 视口坐标 → 工作台页面坐标 */
  const toPage = useCallback((client: { x: number; y: number }) => {
    const box = iframeRef.current?.getBoundingClientRect()
    return box ? { x: box.left + client.x, y: box.top + client.y } : client
  }, [])
  const boxToPage = useCallback((b: { x: number; y: number; w: number; h: number }): PageBox => {
    const p = toPage({ x: b.x, y: b.y })
    return { left: p.x, top: p.y, width: b.w, height: b.h }
  }, [toPage])

  useEffect(() => {
    if (!url) return
    const onMessage = (e: MessageEvent) => {
      if (e.source !== iframeRef.current?.contentWindow || !isLiveEvent(e.data)) return
      const ev = e.data
      switch (ev.type) {
        case 'ready':
          setMeta(ev.composition); setFrame(ev.frame); setReloading(false); setRuntimeError(null); setMissing(null)
          /* 刷新后预览窗口会自己选回原元素；选不回来（元素不在这一帧了）就收起工具条 */
          window.setTimeout(() => setSelection((prev) => (prev?.stale ? null : prev)), 1500)
          break
        case 'frame': setFrame(ev.frame); break
        case 'playing': setPlaying(ev.playing); if (ev.playing) setSelection(null); break
        case 'tracks': setSequences(ev.sequences); break
        case 'layers':
          /* 第一次采集是基线；之后每次刷新都和上一次比，改过的元素记下来 */
          setLayerState((prev) => prev.seeded
            ? { items: ev.items, changed: diffLayers(prev.items, ev.items, prev.changed), seeded: true }
            : { items: ev.items, changed: new Set(), seeded: true })
          setLayersPending(false)
          break
        case 'select': setSelection({ kind: 'element', element: ev.element, anchor: toPage(ev.client), box: boxToPage(ev.element.box) }); break
        case 'region': {
          /* 框选区域：工具条按区域本身摆（归一化矩形换回 iframe 里画布的像素位置） */
          const a = toPage(ev.client)
          setSelection({ kind: 'region', rect: ev.rect, frame: ev.frame, anchor: a, box: { left: a.x, top: a.y, width: 0, height: 0 } })
          break
        }
        case 'selection-box': setSelection((prev) => (prev ? { ...prev, box: boxToPage(ev.box) } : prev)); break
        case 'commit-result':
          if (ev.ok) void worktree.refresh().catch(() => undefined)
          setCommit({ pending: false, error: ev.ok ? null : { code: ev.code, message: ev.message || '没有写成' } })
          if (ev.ok && committing.current) {
            const src = committing.current
            setLayerState((prev) => ({ ...prev, changed: new Set([...prev.changed, src]) }))
          }
          committing.current = null
          if (ev.edits >= 0) setEdits(ev.edits)
          break
        case 'edits': setEdits(ev.edits); break
        case 'deselect': case 'escape': setSelection(null); break
        /* 刷新期间工具条留着（置灰），等选回来；改一下字号不该让工具条闪没再出现 */
        case 'reloading': void worktree.refresh().catch(() => undefined); setReloading(true); setLayersPending(true); setSelection((prev) => (prev ? { ...prev, stale: true } : prev)); break
        case 'build-error': setBuildError(ev.message); break
        case 'runtime-error': setRuntimeError(ev.message); break
        case 'no-composition': setMissing(ev.available); break
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [url, toPage, boxToPage, worktree.refresh])

  const send = useCallback((cmd: LiveCommand extends infer C ? (C extends { fm: 'live' } ? Omit<C, 'fm'> : never) : never) => {
    if (!origin) return
    iframeRef.current?.contentWindow?.postMessage({ fm: 'live', ...cmd }, origin)
  }, [origin])

  /* 返回回调而不是 ref 本身：调用方渲染时读的是普通值，不会在渲染里碰 ref */
  const bindFrame = useCallback((el: HTMLIFrameElement | null) => { iframeRef.current = el }, [])

  const fps = meta?.fps ?? 30
  const tracks = useMemo(() => liveTracks(sequences, fps, layers), [sequences, fps, layers])

  return {
    projectId, status, url, message: current?.message ?? '', active: status === 'ready',
    bindFrame, meta, frame,
    /** 实时画面（iframe）在页面上的位置：工具条不出这个框 */
    frameRect: () => iframeRef.current?.getBoundingClientRect() ?? null, playing, tracks, sequences, layers, layersPending, buildError, runtimeError, reloading, selection, missing,
    fps, time: frame / fps, duration: meta ? meta.durationInFrames / fps : 0,
    play: () => send({ type: 'play' }),
    pause: () => send({ type: 'pause' }),
    toggle: () => send({ type: 'toggle' }),
    seekFrame: (f: number) => send({ type: 'seek', frame: f }),
    seekSeconds: (s: number) => send({ type: 'seek', frame: Math.round(s * fps) }),
    selectLevel: (level: number) => send({ type: 'select-level', level }),
    /** 从元素轨选元素：跳到这一帧并在画面里选中它 */
    selectSource: (src: string, atFrame: number) => send({ type: 'select-src', src, frame: atFrame }),
    clearSelection: () => { setSelection(null); send({ type: 'clear-selection' }) },
    edits, commit, worktree: worktree.state, refreshWorktree: worktree.refresh,
    /** 这次打开以来改过的元素（源码位置）：我手改的和 AI 改的都算，清掉之前一直标着 */
    changed: layerState.changed,
    clearChanges: () => setLayerState((prev) => ({ ...prev, changed: new Set() })),
    /** 拖动中：只改画面，不写源码 */
    previewStyle: (level: number, key: string, value: string | number) => send({ type: 'preview-style', level, key, value }),
    previewReset: () => send({ type: 'preview-reset' }),
    /** 写回源码一个值；成功后预览服务重建、预览窗口刷新并选回原元素 */
    commitEdit: (edit: { src: string; path: string[]; value: string | number | boolean; expect: string | number | boolean | null; expectCode?: string | null; fileHash?: string }) => {
      setCommit({ pending: true, error: null })
      committing.current = edit.src
      send({ type: 'commit', ...edit })
    },
    undo: () => { setCommit({ pending: true, error: null }); send({ type: 'undo' }) },
    dismissCommitError: () => setCommit((c) => ({ ...c, error: null })),
  }
}

export type LivePreview = ReturnType<typeof useLivePreview>
