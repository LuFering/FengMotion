/**
 * 界面上的时间写法 —— 全站一套（由参考片库提出，2026-11-23）。
 *
 * 不用「分:秒:帧」：`00:30:00` 读起来像 30 分钟。需要帧精度的地方，
 * 在数值旁另写「第 N 帧」（formatFrame）。
 */

/** 播放读数：`分:秒`，非整秒保留一位小数（`0:04`、`0:04.5`、`12:05`）。 */
export function formatClock(seconds: number): string {
  const tenths = Math.round(Math.max(0, seconds) * 10)
  const m = Math.floor(tenths / 600)
  const s = Math.floor((tenths % 600) / 10)
  const t = tenths % 10
  return `${m}:${String(s).padStart(2, '0')}${t === 0 ? '' : `.${t}`}`
}

/** 时长的人话写法：「4 秒」「4.5 秒」「1 分 5 秒」。 */
export function formatDuration(seconds: number): string {
  const tenths = Math.round(Math.max(0, seconds) * 10)
  if (tenths < 600) return `${tenths % 10 === 0 ? tenths / 10 : (tenths / 10).toFixed(1)} 秒`
  const m = Math.floor(tenths / 600)
  const s = Math.round((tenths % 600) / 10)
  return s === 0 ? `${m} 分` : `${m} 分 ${s} 秒`
}

/** 帧精度的补充说明：「第 102 帧」。帧号从 0 起，与 Remotion 一致。 */
export function formatFrame(seconds: number, fps: number): string {
  return `第 ${Math.max(0, Math.round(seconds * fps))} 帧`
}
