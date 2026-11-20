/**
 * 实时预览壳：在 iframe 里运行项目的 Remotion 源码，用 Player 播放选中的 composition。
 *
 * 1. 先执行项目入口（fm-project-entry）：它调用的 registerRoot 被薄壳截下，Root 交给这里。
 * 2. 把 Root 渲染在不可见的容器里，收集它声明的 <Composition>，挑出 film.config.json 指定的那个。
 * 3. Player 播放该 composition；外面包一层，登记播放时的片段（Sequence），实时报给工作台当轨道。
 * 4. 探针（probe.ts）负责悬停描边、点选、框选，把元素信息报给工作台。
 * 5. 监听预览服务的 /events：源码改了就记下当前帧再刷新，编译失败就报错误。
 *
 * 和工作台之间只走 postMessage，格式见 src/features/workbench/model/livePreviewProtocol.ts。
 */
import 'fm-project-entry'
import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ComponentType } from 'react'
import { createRoot } from 'react-dom/client'
import { Player, type PlayerRef } from '@remotion/player'
import { Internals } from 'remotion'
import * as registry from './registry'
import { componentNameInside, installProbe, sequenceNamesFromTree } from './probe'
import { LayerSampler } from './layers'
import { post, CANVAS_ATTR } from './bridge'
import type { LiveCommand } from '../../src/features/workbench/model/livePreviewProtocol'

declare const __FM_COMPOSITION__: string

const FRAME_KEY = 'fm-live-frame'

/* ── 片段登记：同 backend/remotion/timeline.mjs 的做法，只是实时报给工作台 ── */
type AnyComponent = ComponentType<Record<string, unknown>>
const wrapped = new WeakMap<AnyComponent, AnyComponent>()

function withCapture(Component: AnyComponent): AnyComponent {
  const cached = wrapped.get(Component)
  if (cached) return cached
  const manager = {
    sequences: [],
    registerSequence: (seq: registry.SequenceEntry) => registry.registerSequence(seq),
    unregisterSequence: (id: string) => registry.unregisterSequence(id),
  }
  function FmCanvas(props: Record<string, unknown>) {
    const ctx = Internals as unknown as {
      SequenceRegistrationContext: React.Context<boolean>
      SequenceManager: React.Context<unknown>
    }
    return (
      <ctx.SequenceRegistrationContext.Provider value={true}>
        <ctx.SequenceManager.Provider value={manager}>
          <div {...{ [CANVAS_ATTR]: '' }} style={{ position: 'absolute', inset: 0 }}>
            <Component {...props} />
          </div>
        </ctx.SequenceManager.Provider>
      </ctx.SequenceRegistrationContext.Provider>
    )
  }
  wrapped.set(Component, FmCanvas)
  return FmCanvas
}

/* ── 片段 → 工作台轨道（合并短时间内的多次登记） ──
   没起名字的片段用里面组件的名字（Hook、BarChart）；片段只在播到它时才有节点，
   所以名字是边播边补的：补到新名字就再报一次。 */
let tracksTimer = 0
let lastTracks = ''
function sendTracks() {
  /* 节流而不是防抖：播放时每帧都会调用，防抖会一直推迟到停下才发 */
  if (tracksTimer) return
  tracksTimer = window.setTimeout(() => {
    tracksTimer = 0
    const byKey = sequenceNamesFromTree()
    const used = new Map<string, number>()
    const sequences = [...registry.getSequences().values()]
      .filter(registry.isTimelineSequence)
      .map((s) => {
        if (!s.displayName && !registry.displayNameOf(s.id)) {
          /* 同样起点和时长的几个片段按出现顺序对应 */
          const key = `${s.from}:${s.duration}`
          const i = used.get(key) ?? 0
          const found = byKey.get(key)?.[i] ?? componentNameInside(s.refForOutline?.current)
          used.set(key, i + 1)
          if (found) registry.setDisplayName(s.id, found)
        }
        return { id: s.id, parent: s.parent, name: s.displayName || registry.displayNameOf(s.id) || registry.sequenceName(s), type: s.type, from: registry.absoluteFrom(s), duration: s.duration }
      })
    const key = JSON.stringify(sequences)
    if (key === lastTracks) return
    lastTracks = key
    post({ type: 'tracks', sequences })
  }, 120)
}
registry.onSequencesChange(sendTracks)

/* ── 预览服务推送：源码改了刷新，编译失败报错 ── */
let playerApi: PlayerRef | null = null
const events = new EventSource('/events')
events.addEventListener('hello', (e) => {
  const data = JSON.parse((e as MessageEvent).data) as { error: string | null }
  post({ type: 'build-error', message: data.error })
})
events.addEventListener('build-error', (e) => {
  post({ type: 'build-error', message: (JSON.parse((e as MessageEvent).data) as { message: string }).message })
})
events.addEventListener('reload', () => {
  /* 刷新后停在同一帧：改完源码看的还是刚才那一帧 */
  const frame = playerApi?.getCurrentFrame()
  if (typeof frame === 'number') sessionStorage.setItem(FRAME_KEY, String(frame))
  post({ type: 'reloading' })
  window.location.reload()
})

function useStore<T>(get: () => T) {
  return useSyncExternalStore(registry.subscribe, get)
}

/** 渲染 Root 只为收集 <Composition>，不显示任何东西 */
function Collector({ Root }: { Root: ComponentType }) {
  return <div style={{ display: 'none' }}><Root /></div>
}

interface Resolved { durationInFrames: number; fps: number; width: number; height: number; props: Record<string, unknown> }

function Stage({ entry }: { entry: registry.CompositionEntry }) {
  const [resolved, setResolved] = useState<Resolved | null>(null)
  const [metaError, setMetaError] = useState<string | null>(null)
  const playerRef = useRef<PlayerRef>(null)

  useEffect(() => {
    let alive = true
    const base = {
      durationInFrames: entry.durationInFrames ?? 1, fps: entry.fps ?? 30,
      width: entry.width ?? 1920, height: entry.height ?? 1080, props: entry.defaultProps ?? {},
    }
    if (!entry.calculateMetadata) { setResolved(base); return }
    const controller = new AbortController()
    Promise.resolve(entry.calculateMetadata({ defaultProps: base.props, props: base.props, abortSignal: controller.signal, compositionId: entry.id }))
      .then((meta) => {
        if (!alive) return
        const m = meta as Partial<Resolved>
        setResolved({
          durationInFrames: m.durationInFrames ?? base.durationInFrames, fps: m.fps ?? base.fps,
          width: m.width ?? base.width, height: m.height ?? base.height, props: (m.props as Record<string, unknown>) ?? base.props,
        })
      })
      .catch((error: unknown) => { if (alive) setMetaError(error instanceof Error ? error.message : String(error)) })
    return () => { alive = false; controller.abort() }
  }, [entry])

  const component = useMemo(() => (entry.component ? withCapture(entry.component) : undefined), [entry.component])
  const lazyComponent = useMemo(() => (entry.lazyComponent
    ? () => entry.lazyComponent!().then((mod) => ({ default: withCapture(mod.default) }))
    : undefined), [entry.lazyComponent])

  /* 播放器事件 → 工作台；工作台命令 → 播放器 */
  useEffect(() => {
    const player = playerRef.current
    if (!player || !resolved) return
    playerApi = player
    const saved = Number(sessionStorage.getItem(FRAME_KEY))
    sessionStorage.removeItem(FRAME_KEY)
    if (Number.isFinite(saved) && saved > 0) player.seekTo(Math.min(saved, resolved.durationInFrames - 1))
    const onFrame = (e: { detail: { frame: number } }) => { post({ type: 'frame', frame: e.detail.frame }); sendTracks() }
    const onPlay = () => post({ type: 'playing', playing: true })
    const onPause = () => post({ type: 'playing', playing: false })
    const onSeeked = (e: { detail: { frame: number } }) => { post({ type: 'frame', frame: e.detail.frame }); sendTracks() }
    player.addEventListener('frameupdate', onFrame)
    player.addEventListener('seeked', onSeeked)
    player.addEventListener('play', onPlay)
    player.addEventListener('pause', onPause)
    player.addEventListener('ended', onPause)
    const onMessage = (e: MessageEvent) => {
      if (e.source !== window.parent) return
      const cmd = e.data as LiveCommand
      if (!cmd || cmd.fm !== 'live') return
      if (cmd.type === 'play') player.play()
      else if (cmd.type === 'pause') player.pause()
      else if (cmd.type === 'toggle') player.toggle()
      else if (cmd.type === 'seek') player.seekTo(Math.max(0, Math.min(resolved.durationInFrames - 1, Math.round(cmd.frame))))
    }
    window.addEventListener('message', onMessage)
    const uninstall = installProbe({ player, fps: resolved.fps, durationInFrames: resolved.durationInFrames })
    post({ type: 'ready', composition: { id: entry.id, width: resolved.width, height: resolved.height, fps: resolved.fps, durationInFrames: resolved.durationInFrames }, frame: player.getCurrentFrame() })
    return () => {
      player.removeEventListener('frameupdate', onFrame)
      player.removeEventListener('seeked', onSeeked)
      player.removeEventListener('play', onPlay)
      player.removeEventListener('pause', onPause)
      player.removeEventListener('ended', onPause)
      window.removeEventListener('message', onMessage)
      uninstall()
    }
  }, [resolved, entry.id])

  /* 场景组件的名字（Hook、BarChart…）：采元素时它们算场景，不算元素 */
  const sceneNames = useCallback(() => new Set([...registry.getSequences().values()]
    .map((seq) => registry.displayNameOf(seq.id)).filter((n): n is string => Boolean(n))), [])
  const [ready, setReady] = useState(false)
  useEffect(() => { if (!resolved) return; const t = window.setTimeout(() => setReady(true), 600); return () => window.clearTimeout(t) }, [resolved])

  if (metaError) return <Problem title="读取画面规格失败" detail={metaError} />
  if (!resolved) return null
  const shared = {
    inputProps: resolved.props,
    durationInFrames: resolved.durationInFrames,
    fps: resolved.fps,
    compositionWidth: resolved.width,
    compositionHeight: resolved.height,
    style: { width: '100%', height: '100%' },
    controls: false,
    loop: true,
    clickToPlay: false,
    doubleClickToFullscreen: false,
    spaceKeyToPlayOrPause: false,
    errorFallback: ({ error }: { error: Error }) => {
      reportRuntime(error)
      return <Problem title="画面运行出错" detail={error.message} />
    },
  }
  const player = component
    ? <Player ref={playerRef} component={component} {...shared} />
    : <Player ref={playerRef} lazyComponent={lazyComponent!} {...shared} />
  /* 等画面先出来再在后台采元素轨，不和首帧抢渲染 */
  return (
    <>
      {player}
      {ready && entry.component && (
        <LayerSampler component={entry.component} props={resolved.props} width={resolved.width} height={resolved.height}
                      fps={resolved.fps} durationInFrames={resolved.durationInFrames} sceneNames={sceneNames} />
      )}
    </>
  )
}

let lastRuntime = ''
function reportRuntime(error: Error) {
  if (error.message === lastRuntime) return
  lastRuntime = error.message
  queueMicrotask(() => post({ type: 'runtime-error', message: error.message }))
}

function Problem({ title, detail }: { title: string; detail: string }) {
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: '#f3f3f3', font: '13px/20px system-ui, sans-serif', background: '#111' }}>
      <div style={{ maxWidth: 520, padding: 24, textAlign: 'center' }}>
        <div style={{ fontWeight: 600, marginBottom: 6 }}>{title}</div>
        <div style={{ opacity: 0.7, whiteSpace: 'pre-wrap' }}>{detail}</div>
      </div>
    </div>
  )
}

function App() {
  const Root = useStore(registry.getRoot)
  const compositions = useStore(registry.getCompositions)
  const entry = compositions.get(__FM_COMPOSITION__)
    ?? (compositions.size === 1 ? [...compositions.values()][0] : undefined)
  useEffect(() => {
    if (Root && compositions.size > 0 && !entry) post({ type: 'no-composition', available: [...compositions.keys()] })
  }, [Root, compositions, entry])
  return (
    <>
      {Root && <Collector Root={Root} />}
      {entry ? <Stage key={entry.id} entry={entry} /> : Root && compositions.size > 0
        ? <Problem title="找不到要预览的画面" detail={`film.config.json 指定的是「${__FM_COMPOSITION__}」，工程里只有：${[...compositions.keys()].join('、')}`} />
        : null}
    </>
  )
}

window.addEventListener('error', (e) => reportRuntime(e.error instanceof Error ? e.error : new Error(String(e.message))))
window.addEventListener('unhandledrejection', (e) => reportRuntime(e.reason instanceof Error ? e.reason : new Error(String(e.reason))))

createRoot(document.getElementById('root')!).render(<App />)
