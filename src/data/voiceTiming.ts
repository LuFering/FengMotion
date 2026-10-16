import type { StoryboardEntry } from '@/data/productionData'

/**
 * 口播时长诊断 —— 脚本与口播 / 音频与时间 两个视图共用这一份算术。
 *
 * ⚠️ 一切都建立在一条**明写的假设**上：常规中文讲解的语速（字/秒）。
 *    它不是从数据里"算"出来的，所以界面上要把它摊开给人看、给人改。
 */
export const RATES = [4, 4.5, 5] as const

export const parseSpan = (t: string): [number, number] => {
  const m = t.match(/([\d.]+)\s*[–—-]\s*([\d.]+)/)
  return m ? [Number(m[1]), Number(m[2])] : [0, 0]
}

/** 段时长：优先用 "3.9s" 这种字段，坏了就退回时间码相减 */
export const durOf = (e: StoryboardEntry) => {
  const n = Number(e.时长.replace(/[^\d.]/g, ''))
  if (Number.isFinite(n) && n > 0) return n
  const [a, b] = parseSpan(e.时间码)
  return Math.max(0, b - a)
}

export const charsOf = (s: string) => s.replace(/\s/g, '').length

export interface Readout {
  /** 字数 */ n: number
  /** 镜头/分镜给了多久 */ d: number
  /** 按语速需要多久 */ need: number
  /** 差（正 = 超时） */ diff: number
  state: 'over' | 'ok' | 'room'
}

export function readout(e: StoryboardEntry, rate: number): Readout {
  const d = durOf(e)
  const n = charsOf(e.旁白)
  const need = n / rate
  const diff = need - d
  return { n, d, need, diff, state: diff > 0.8 ? 'over' : diff < -1.5 ? 'room' : 'ok' }
}

export const STATE_LABEL = { over: '超时', ok: '合适', room: '富余' } as const
