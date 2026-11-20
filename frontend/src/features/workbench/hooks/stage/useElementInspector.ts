import type * as React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { studioHttpApi } from '@/api'
import { ApiError } from '@/api/errors'
import type { SceneEditElement, SceneEditMetadata } from '@/api/taskClient'
import type { SessionDraft } from '@/features/chat/hooks/useDraftStore'
import { notifyProjectRendered } from '@/features/project/services/projectRenderEvents'
import type { useSceneVersions } from '@/features/workbench/hooks/useSceneVersions'
import type { StageVisual } from '@/features/workbench/model/stageVisual'
import {
  containedRect, elementEditFailure, elementsAtFrame, frameAt, hitElement, previewOnlyReason,
  secondsAtFrame, toNormPoint, versionForArtifact, type NormPoint, type NormRect,
} from '@/features/workbench/model/elementEdit'

/** 小窗里选中的是什么：声明过的元素 / 画面上的一个点 / 拖出来的一块区域 */
export type InspectorTarget =
  | { kind: 'element'; element: SceneEditElement; frame: number }
  | { kind: 'point'; point: NormPoint; frame: number }
  | { kind: 'region'; rect: NormRect; frame: number }

export interface UseElementInspectorArgs {
  projectId: string
  viewedPreview: StageVisual | null
  sceneVersions: ReturnType<typeof useSceneVersions>
  previewMediaRef: React.RefObject<HTMLVideoElement | HTMLImageElement | null>
  stageRef: React.RefObject<HTMLDivElement | null>
  fps: number
  /** 工作台有任务在跑（渲染、修改、工作流）：这时不能再提交 */
  busy: boolean
  setNotice: (text: string) => void
  /** 编辑成功后切回最新画面 */
  showLatest: () => void
  referenceElement: (bbox: NormRect, label: string) => string | undefined
  submit: (prompt: string) => Promise<boolean>
  draft: SessionDraft
}

/** 拖动超过这么多像素才算框选，否则算点击 */
const DRAG_THRESHOLD = 5

/**
 * 工作台画面区的元素编辑：读这一版的元素声明、点选 / 框选、属性小窗的状态，
 * 以及两条修改路径 —— 自己改文字（版本化写回）和交给 AI（挂上画面目标后走工作台提交）。
 *
 * <p>只按契约做事：命中只认声明里的帧区间与矩形；写回原样带上读到的版本和源码指纹；
 * 不是最新版本、没有声明、读不到声明时都不让直接改，只能交给 AI。</p>
 */
export function useElementInspector({ projectId, viewedPreview, sceneVersions, previewMediaRef, stageRef, fps, busy, setNotice, showLatest, referenceElement, submit, draft }: UseElementInspectorArgs) {
  /* ── 这段画面对应哪个场景版本 ──
     场景来源的画面 revision 就是版本号；其他来源按登记的视频路径找，找不到就不是场景版本 */
  const version = useMemo(() => {
    if (!viewedPreview || viewedPreview.media !== 'video') return null
    if (viewedPreview.origin === 'scene') return viewedPreview.revision
    return versionForArtifact(sceneVersions.versions, viewedPreview.artifactPath ?? viewedPreview.file)?.version ?? null
  }, [viewedPreview, sceneVersions.versions])
  const latestVersion = sceneVersions.versions.reduce((max, v) => Math.max(max, v.version), 0)
  const isLatest = version !== null && version === latestVersion

  /* ── 读取声明 ──
     结果按「项目 + 版本 + 第几次重读」记账：换了版本时旧结果自然作废，显示为读取中，
     不在 effect 里同步清空状态再多渲染一轮。 */
  const [reloadTick, setReloadTick] = useState(0)
  const metaKey = projectId && version !== null ? `${projectId}:${version}:${reloadTick}` : null
  const [loaded, setLoaded] = useState<{ key: string; meta: SceneEditMetadata | null; unavailable: string } | null>(null)
  useEffect(() => {
    if (!metaKey || version === null) return
    let alive = true
    studioHttpApi().task.sceneEditMetadata(projectId, version).then((result) => {
      if (alive) setLoaded({ key: metaKey, meta: result, unavailable: result.status === 'declared' ? '' : previewOnlyReason(result) })
    }).catch((error) => {
      if (!alive) return
      /* 读不到（含旧版后端还没有这个接口）按「只能预览」处理：照样能交给 AI，只是不能直接改 */
      setLoaded({
        key: metaKey, meta: null,
        unavailable: error instanceof ApiError && error.isNotFound ? '暂时读不到这个版本的元素信息' : '元素信息读取失败，只能交给 AI 修改',
      })
    })
    return () => { alive = false }
  }, [metaKey, projectId, version])
  const current = loaded && loaded.key === metaKey ? loaded : null
  const meta = current?.meta ?? null
  const metaState: 'idle' | 'loading' | 'ready' | 'unavailable' = !metaKey ? 'idle' : !current ? 'loading' : current.meta ? 'ready' : 'unavailable'
  const unavailable = current?.unavailable ?? ''

  const declared = meta?.status === 'declared' ? meta : null
  const elements = useMemo(() => declared?.elements ?? [], [declared])
  const pickable = useMemo(() => elements.filter((el) => el.placement), [elements])

  /* ── 播放状态：只在暂停时能点选；开始播放就收起小窗 ── */
  const [paused, setPaused] = useState(true)
  const [frame, setFrame] = useState(0)
  const [target, setTarget] = useState<InspectorTarget | null>(null)
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null)
  useEffect(() => {
    const media = previewMediaRef.current
    if (!(media instanceof HTMLVideoElement)) return
    const sync = () => { setPaused(media.paused); setFrame(frameAt(media.currentTime, fps)) }
    const onPlay = () => { setPaused(false); setTarget(null); setAnchor(null) }
    sync()
    media.addEventListener('play', onPlay)
    media.addEventListener('pause', sync)
    media.addEventListener('seeked', sync)
    media.addEventListener('loadeddata', sync)
    return () => {
      media.removeEventListener('play', onPlay)
      media.removeEventListener('pause', sync)
      media.removeEventListener('seeked', sync)
      media.removeEventListener('loadeddata', sync)
    }
  }, [previewMediaRef, viewedPreview?.id, fps])

  /* 换了画面或版本：之前的选择不再属于这段画面（渲染期间比对，不用 effect 多渲染一轮） */
  const selectionKey = `${viewedPreview?.id ?? ''}|${version ?? ''}`
  const [selectionFor, setSelectionFor] = useState(selectionKey)
  if (selectionFor !== selectionKey) {
    setSelectionFor(selectionKey)
    setTarget(null)
    setAnchor(null)
  }

  /* ── 画面在舞台里实际占的矩形（扣掉黑边），标注层按它摆 ── */
  const [frameBox, setFrameBox] = useState<{ left: number; top: number; width: number; height: number } | null>(null)
  const measure = useCallback(() => {
    const media = previewMediaRef.current
    const stage = stageRef.current
    if (!(media instanceof HTMLVideoElement) || !stage) { setFrameBox(null); return }
    const box = media.getBoundingClientRect()
    const host = stage.getBoundingClientRect()
    const inner = containedRect(box.width, box.height, media.videoWidth, media.videoHeight)
    setFrameBox({ left: box.left - host.left + inner.left, top: box.top - host.top + inner.top, width: inner.width, height: inner.height })
  }, [previewMediaRef, stageRef])
  useEffect(() => {
    const media = previewMediaRef.current
    const stage = stageRef.current
    if (!(media instanceof HTMLVideoElement) || !stage) return
    const observer = new ResizeObserver(measure)
    observer.observe(media); observer.observe(stage)
    media.addEventListener('loadedmetadata', measure)
    measure()
    return () => { observer.disconnect(); media.removeEventListener('loadedmetadata', measure) }
  }, [previewMediaRef, stageRef, measure, viewedPreview?.id])

  /** 屏幕坐标 → 画面归一化坐标（落在黑边上返回 null） */
  const normAt = useCallback((clientX: number, clientY: number): NormPoint | null => {
    const media = previewMediaRef.current
    if (!(media instanceof HTMLVideoElement)) return null
    const box = media.getBoundingClientRect()
    return toNormPoint(clientX - box.left, clientY - box.top, containedRect(box.width, box.height, media.videoWidth, media.videoHeight))
  }, [previewMediaRef])

  /* ── 指针：点 = 选元素或这一处；拖 = 框选；悬停高亮元素 ── */
  const [hovered, setHovered] = useState<string | null>(null)
  const [dragRect, setDragRect] = useState<NormRect | null>(null)
  const press = useRef<{ x: number; y: number; norm: NormPoint; pointerId: number; dragging: boolean } | null>(null)
  const enabled = viewedPreview?.media === 'video'

  /** 播放器自己的控件（播放键、进度条、音量……）与小窗不归这里管 */
  const ownsEvent = (event: React.PointerEvent | React.MouseEvent) => {
    const el = event.target as Element | null
    return enabled && !el?.closest('.media-controls, .wb-player, .wb-sel-layer, .wb-time-range, a, button, input, textarea, [role="slider"], .el-inspector')
  }

  const currentFrame = () => {
    const media = previewMediaRef.current
    return media instanceof HTMLVideoElement ? frameAt(media.currentTime, fps) : frame
  }

  const onPointerDownCapture = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!ownsEvent(event) || event.button !== 0) return
    const norm = normAt(event.clientX, event.clientY)
    if (!norm) return
    /* 截在捕获阶段：不让播放器把这次点击当成「切换播放」 */
    event.stopPropagation()
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    press.current = { x: event.clientX, y: event.clientY, norm, pointerId: event.pointerId, dragging: false }
  }

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const p = press.current
    if (p && p.pointerId === event.pointerId) {
      if (!p.dragging && Math.hypot(event.clientX - p.x, event.clientY - p.y) > DRAG_THRESHOLD) {
        p.dragging = true
        const media = previewMediaRef.current
        if (media instanceof HTMLVideoElement && !media.paused) media.pause()
        setTarget(null); setAnchor(null)
      }
      if (p.dragging) {
        const media = previewMediaRef.current
        if (!(media instanceof HTMLVideoElement)) return
        const box = media.getBoundingClientRect()
        const inner = containedRect(box.width, box.height, media.videoWidth, media.videoHeight)
        /* 拖出画面时贴着边，不让框跑到黑边里 */
        const x = Math.min(1, Math.max(0, (event.clientX - box.left - inner.left) / inner.width))
        const y = Math.min(1, Math.max(0, (event.clientY - box.top - inner.top) / inner.height))
        setDragRect({ x: Math.min(p.norm.x, x), y: Math.min(p.norm.y, y), w: Math.abs(x - p.norm.x), h: Math.abs(y - p.norm.y) })
      }
      return
    }
    if (!paused || !enabled || pickable.length === 0) { if (hovered) setHovered(null); return }
    const norm = normAt(event.clientX, event.clientY)
    const hit = norm ? hitElement(pickable, currentFrame(), norm) : null
    if ((hit?.id ?? null) !== hovered) setHovered(hit?.id ?? null)
  }

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const p = press.current
    if (!p || p.pointerId !== event.pointerId) return
    press.current = null
    event.stopPropagation()
    const media = previewMediaRef.current
    if (media instanceof HTMLVideoElement && !media.paused) media.pause()
    const at = currentFrame()
    setFrame(at)
    if (p.dragging) {
      const rect = dragRect
      setDragRect(null)
      /* 拖得太小当成没拖：一条细线不是有意义的区域 */
      if (!rect || rect.w < 0.01 || rect.h < 0.01) return
      setTarget({ kind: 'region', rect, frame: at })
      setAnchor({ x: event.clientX, y: event.clientY })
      return
    }
    const hit = hitElement(pickable, at, p.norm)
    setTarget(hit ? { kind: 'element', element: hit, frame: at } : { kind: 'point', point: p.norm, frame: at })
    setAnchor({ x: event.clientX, y: event.clientY })
  }

  /* 点击已经在 pointerdown/up 里处理了；把 click 也截下，播放器就不会再切换一次播放 */
  const onClickCapture = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!ownsEvent(event)) return
    event.stopPropagation()
    event.preventDefault()
  }

  const onPointerLeave = () => { if (!press.current) setHovered(null) }

  const close = useCallback(() => { setTarget(null); setAnchor(null) }, [])

  /* Esc 收起小窗 */
  useEffect(() => {
    if (!target) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [target, close])

  /* 空格切换播放：焦点在输入框里（含对话区 LeiBox 的 Shadow DOM 输入框）时不抢 */
  useEffect(() => {
    if (!enabled) return
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return
      const editing = e.composedPath().some((node) => node instanceof HTMLElement
        && (node.isContentEditable || /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(node.tagName) || node.getAttribute('role') === 'slider'))
      if (editing) return
      const media = previewMediaRef.current
      if (!(media instanceof HTMLVideoElement)) return
      e.preventDefault()
      if (media.paused) void media.play().catch(() => undefined)
      else media.pause()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [enabled, previewMediaRef])

  /** 从「元素」列表里选：跳到元素第一帧并选中，小窗贴在元素右侧 */
  const pickFromList = (element: SceneEditElement) => {
    const media = previewMediaRef.current
    if (!(media instanceof HTMLVideoElement) || !element.placement) return
    media.pause()
    const startFrame = element.placement.startFrame
    media.currentTime = secondsAtFrame(startFrame, fps)
    setFrame(startFrame)
    const box = media.getBoundingClientRect()
    const inner = containedRect(box.width, box.height, media.videoWidth, media.videoHeight)
    const b = element.placement.bounds
    setTarget({ kind: 'element', element, frame: startFrame })
    setAnchor({ x: box.left + inner.left + (b.x + b.w) * inner.width, y: box.top + inner.top + (b.y + b.h / 2) * inner.height })
  }

  /** 跳到元素第一帧（小窗里点出现时间） */
  const seekTo = (startFrame: number) => {
    const media = previewMediaRef.current
    if (!(media instanceof HTMLVideoElement)) return
    media.pause()
    media.currentTime = secondsAtFrame(startFrame, fps)
    setFrame(startFrame)
  }

  /* ── 自己改：版本化写回文字 ── */
  const [saving, setSaving] = useState(false)
  /* 失败信息跟着当时的选择走：换了选择，旧的失败自然不再显示 */
  const [failureState, setFailureState] = useState<{ text: string; reload: boolean; for: InspectorTarget | null } | null>(null)
  const failure = failureState && failureState.for === target ? failureState : null
  const setFailure = (value: { text: string; reload: boolean } | null) => setFailureState(value ? { ...value, for: target } : null)

  /** 为什么不能直接改（空字符串 = 可以改） */
  const editBlocked = !declared
    ? (unavailable || previewOnlyReason(null))
    : !isLatest
      ? '这是历史版本，只能在最新版本上直接修改'
      : busy
        ? '有任务正在进行，完成后再修改'
        : ''

  const applyText = async (text: string, note?: string) => {
    if (!declared || target?.kind !== 'element' || editBlocked || saving || !declared.sourceHash) return false
    if (text === target.element.properties.text) {
      setFailure(elementEditFailure('element_edit_noop'))
      return false
    }
    setSaving(true)
    setFailure(null)
    try {
      const result = await studioHttpApi().task.editSceneElement(projectId, {
        baseVersion: declared.version,
        sourceHash: declared.sourceHash,
        elementId: target.element.id,
        properties: { text },
        prompt: note?.trim() || `修改「${target.element.label}」的文字`,
      })
      setNotice(`「${target.element.label}」已改好，生成了新版本 v${result.version}`)
      close()
      await sceneVersions.refresh(true)
      showLatest()
      notifyProjectRendered(projectId, result.version)
      return true
    } catch (error) {
      const code = error instanceof ApiError
        ? (typeof error.details?.rawCode === 'string' ? error.details.rawCode : error.code)
        : null
      setFailure(elementEditFailure(code, error instanceof Error ? error.message : undefined))
      return false
    } finally {
      setSaving(false)
    }
  }

  const reload = () => {
    setFailure(null)
    void sceneVersions.refresh(true)
    setReloadTick((n) => n + 1)
  }

  /* ── 交给 AI：先把元素区域挂成修改目标，等草稿里的目标确实换成它，再提交 ── */
  const [aiSending, setAiSending] = useState(false)
  const pendingAi = useRef<{ label: string; prompt: string; at: number } | null>(null)
  /* submit 每次渲染都是新函数；放进 effect 依赖会让「等目标挂上」的计时器反复重来 */
  const submitRef = useRef(submit)
  useEffect(() => { submitRef.current = submit })

  const targetBox = (t: InspectorTarget): NormRect => {
    if (t.kind === 'element') return t.element.placement?.bounds ?? { x: 0, y: 0, w: 1, h: 1 }
    if (t.kind === 'region') return t.rect
    /* 点：以落点为中心取一小块，AI 拿到的是「这一处」而不是整张画面 */
    const size = 0.08
    return {
      x: Math.min(1 - size, Math.max(0, t.point.x - size / 2)),
      y: Math.min(1 - size, Math.max(0, t.point.y - size / 2)),
      w: size, h: size,
    }
  }

  const sendToAi = (instruction: string) => {
    const text = instruction.trim()
    if (!target || !text || aiSending || busy) return
    const name = target.kind === 'element' ? target.element.label : target.kind === 'region' ? '框选区域' : '画面这一处'
    const label = referenceElement(targetBox(target), name)
    if (!label) return
    const prompt = target.kind === 'element'
      ? `修改画面元素「${target.element.label}」（元素 ID ${target.element.id}，当前文字「${target.element.properties.text}」）：${text}`
      : text
    pendingAi.current = { label, prompt, at: Date.now() }
    setAiSending(true)
  }

  const draftLabel = draft.targetSnapshot?.label
  useEffect(() => {
    const pending = pendingAi.current
    if (!pending) return
    if (draftLabel === pending.label) {
      pendingAi.current = null
      void submitRef.current(pending.prompt).then((ok) => {
        setAiSending(false)
        if (ok) close()
      })
      return
    }
    /* 目标没挂上（例如画面不能作为修改目标，原因已经在提示里）：别一直转圈 */
    const timer = window.setTimeout(() => {
      if (pendingAi.current === pending) { pendingAi.current = null; setAiSending(false) }
    }, 1500)
    return () => window.clearTimeout(timer)
  }, [draftLabel, aiSending, close])

  return {
    version, isLatest, meta, metaState, unavailable, declared, elements, pickable,
    paused, frame, hovered, target, anchor, dragRect, frameBox, editBlocked,
    saving, failure, aiSending, enabled,
    visibleNow: elementsAtFrame(pickable, frame),
    handlers: { onPointerDownCapture, onPointerMove, onPointerUp, onPointerLeave, onClickCapture },
    close, applyText, reload, sendToAi, pickFromList, seekTo,
  }
}

export type ElementInspector = ReturnType<typeof useElementInspector>
