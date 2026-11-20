/**
 * 画面元素编辑的纯计算：帧号、命中、屏幕换算、版本对应和错误文案。
 *
 * <p>依据契约 frontend/docs/contracts/scene-edit-metadata.md：
 * 命中只看声明里的 placement（帧区间 + 归一化矩形），不解析像素，也不拿时间轨道冒充元素。
 * 声明不能证明代码真的画了这个元素 —— 这里只负责「点在声明的矩形里」这一件事。</p>
 */
import type { SceneEditElement, SceneEditMetadata } from '@/api/taskClient'

export interface NormRect { x: number; y: number; w: number; h: number }
export interface NormPoint { x: number; y: number }

/** 秒 → 帧号。加一点余量，避免 3.0 秒 × 30 帧算成 89.999… 落到上一帧。 */
export function frameAt(seconds: number, fps: number): number {
  if (!Number.isFinite(seconds) || !Number.isFinite(fps) || fps <= 0) return 0
  return Math.max(0, Math.floor(seconds * fps + 1e-6))
}

/** 帧号 → 秒（元素起点跳转用）；落到帧的中间，避免播放器解码到前一帧。 */
export function secondsAtFrame(frame: number, fps: number): number {
  if (!Number.isFinite(fps) || fps <= 0) return 0
  return (frame + 0.5) / fps
}

/** 这一帧上可点选的元素：有 placement，且帧号落在 [startFrame, endFrame) 内。 */
export function elementsAtFrame(elements: SceneEditElement[], frame: number): SceneEditElement[] {
  return elements.filter((el) => el.placement
    && frame >= el.placement.startFrame && frame < el.placement.endFrame)
}

/**
 * 点中了哪个元素。几个矩形重叠时取面积最小的那个 ——
 * 小元素通常叠在大元素上面，取大的会让小标题永远点不到。
 */
export function hitElement(elements: SceneEditElement[], frame: number, point: NormPoint): SceneEditElement | null {
  let best: SceneEditElement | null = null
  let bestArea = Infinity
  for (const el of elementsAtFrame(elements, frame)) {
    const b = el.placement!.bounds
    if (point.x < b.x || point.x > b.x + b.w || point.y < b.y || point.y > b.y + b.h) continue
    const area = b.w * b.h
    if (area < bestArea) { best = el; bestArea = area }
  }
  return best
}

/**
 * 视频在播放框里实际占的矩形（object-fit: contain 留下的黑边要扣掉）。
 * 返回相对播放框左上角的像素值；视频尺寸未知时退回整个播放框。
 */
export function containedRect(boxWidth: number, boxHeight: number, videoWidth: number, videoHeight: number) {
  if (!(boxWidth > 0 && boxHeight > 0 && videoWidth > 0 && videoHeight > 0)) {
    return { left: 0, top: 0, width: Math.max(0, boxWidth), height: Math.max(0, boxHeight) }
  }
  const scale = Math.min(boxWidth / videoWidth, boxHeight / videoHeight)
  const width = videoWidth * scale
  const height = videoHeight * scale
  return { left: (boxWidth - width) / 2, top: (boxHeight - height) / 2, width, height }
}

/** 播放框里的像素点 → 画面归一化坐标；落在黑边上返回 null。 */
export function toNormPoint(px: number, py: number, frame: { left: number; top: number; width: number; height: number }): NormPoint | null {
  if (frame.width <= 0 || frame.height <= 0) return null
  const x = (px - frame.left) / frame.width
  const y = (py - frame.top) / frame.height
  if (x < 0 || x > 1 || y < 0 || y > 1) return null
  return { x, y }
}

/**
 * 这段视频对应哪个场景版本：按版本登记的视频路径找。
 * 两边都可能带 ./ 前缀或是绝对路径的尾段，统一成相对路径再比。
 */
export function versionForArtifact<T extends { version: number; artifactPath: string | null }>(versions: T[], artifactPath: string | null | undefined): T | null {
  const target = normalizePath(artifactPath)
  if (!target) return null
  const exact = versions.find((v) => normalizePath(v.artifactPath) === target)
  if (exact) return exact
  /* 前端拿到的可能是带项目目录的完整路径：只接受「以 /版本路径 结尾」，不做模糊匹配 */
  return versions.find((v) => {
    const own = normalizePath(v.artifactPath)
    return own !== '' && target.endsWith(`/${own}`)
  }) ?? null
}

function normalizePath(path: string | null | undefined): string {
  return (path ?? '').trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+/g, '/')
}

/** 「只能预览」的原因，换成一句用户读得懂的话。 */
export function previewOnlyReason(meta: Pick<SceneEditMetadata, 'reason'> | null, fallback = '这个版本没有可直接编辑的元素'): string {
  switch (meta?.reason?.code) {
    case 'unsupported_source': return '这个版本不是从工程源码渲染的，没有可直接编辑的元素'
    case 'snapshot_missing': return '这个版本没有保存源码快照，不能直接编辑'
    case 'snapshot_invalid': return '这个版本的源码快照校验没通过，不能直接编辑'
    case 'manifest_missing': return '这个版本没有可编辑的元素声明'
    case 'manifest_invalid': return '这个版本的元素声明格式不对，不能直接编辑'
    default: return fallback
  }
}

/** 写回失败时给的一句话，以及要不要提供「重新读取」。 */
export function elementEditFailure(code: string | null | undefined, message?: string): { text: string; reload: boolean } {
  switch (code) {
    case 'element_edit_noop': return { text: '文字没有变化，不需要重新渲染', reload: false }
    case 'validation_error':
    case 'unsupported_element_property': return { text: '这个修改不被支持（目前只能改文字）', reload: false }
    case 'not_found':
    case 'element_not_found': return { text: '找不到这个元素了，可能版本已经变化', reload: true }
    case 'scene_not_initialized':
    case 'scene_version_conflict':
    case 'source_version_conflict': return { text: '画面已经有了更新的版本，请重新读取后再改', reload: true }
    case 'working_source_conflict': return { text: '工程里还有没渲染的改动，先渲染出新版本再改这里', reload: true }
    case 'project_busy': return { text: '这个项目正在执行别的操作，稍后重新读取再试', reload: true }
    case 'element_edit_unavailable':
    case 'source_snapshot_unavailable':
    case 'snapshot_corrupt':
    case 'manifest_invalid': return { text: '这个版本的快照或声明不支持这次编辑', reload: true }
    case 'manifest_rollback_failed': return { text: '提交失败，且没能恢复声明文件，请检查工程后重新读取', reload: true }
    case 'timeout': return { text: '等待渲染超时；服务端可能仍在渲染，请稍后重新读取版本', reload: true }
    default: return { text: message?.trim() || '修改没有完成，请重新读取后再试', reload: true }
  }
}
