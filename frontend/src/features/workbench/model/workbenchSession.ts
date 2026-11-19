import { FILM_FPS } from '@/demo/timeline'
import type { TaskRequest } from '@/api/studioApi'

/**
 * 制作工作台 · 二级 —— 三栏工具面板
 *
 * ⚠️ 这一层用 **paba 的工作台语言**（.wb-* / .fw-* / .mini），
 *    不是首页那套纸层（.hm-* / --ht-*）。
 *    paba 自己就分两套：
 *      首页    .hm-*      纸 + 墨（--ht-*）—— 24px 纸片、胶囊、阴影
 *      工作台  .wb-/.fw-  工具面板（--surf/--hole/--line）—— 平、密、6px 圆角
 *    工作台要能长时间盯着干活，所以**不用纸、不用大圆角、不用阴影**。
 *
 * 三栏：场景列表（.fw-ing）/ 监看器（.fw-canvas）/ 对话设置（.fw-bar）
 */

/**
 * 首屏默认停在场景内的「代表帧」而不是 0s。
 * 真实成片的 0s 是黑场片头（整帧均值约 24/255），如果直接停在 0s，
 * 监看器看起来就是一块空黑画布 —— 这是首屏被读成「AI 空白工作区」的主因之一。
 * 时间码仍是真实影片时间，不伪造画面。
 */
export const INITIAL_FRAME = FILM_FPS

/** 打开某场时定位到该场有画面的位置：最多进入 1 秒，短镜头按 45% 取。 */
export const scenePreviewOffset = (durationFrames: number) =>
  Math.min(Math.round(FILM_FPS), Math.round(durationFrames * 0.45))

export type PendingSubmit = { key: string; messageId: string; prompt: string; request: TaskRequest; status: 'waiting' | 'cancelled' }

export function readFeedbackQueue(projectId: string): { items: PendingSubmit[]; hold: boolean } {
  try {
    const value = JSON.parse(sessionStorage.getItem(`fm-feedback-queue:${projectId}`) ?? 'null') as { items?: PendingSubmit[]; hold?: boolean } | null
    return { items: Array.isArray(value?.items) ? value.items.filter((item) => item.request?.projectId === projectId && ['waiting', 'cancelled'].includes(item.status)) : [], hold: value?.hold === true }
  } catch { return { items: [], hold: false } }
}

export function readCorrectionAttempt(projectId: string): { key: string; id: string } | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(`fm-correction-attempt:${projectId}`) ?? 'null') as { key?: unknown; id?: unknown } | null
    return typeof value?.key === 'string' && value.key.length <= 100_000 && typeof value.id === 'string' && /^[0-9a-f-]{36}$/i.test(value.id)
      ? { key: value.key, id: value.id } : null
  } catch { return null }
}
