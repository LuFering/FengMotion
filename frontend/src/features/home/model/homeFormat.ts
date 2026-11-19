

export const fmtSize = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)}MB`
    : bytes >= 1024 ? `${Math.round(bytes / 1024)}KB`
      : `${bytes}B`

/** 按钮上的目录名按显示宽度截断：上限 6 个中文字符宽（全角 1、半角 0.5），
    超出截断加省略号；半角名（如 FengMotion）因此能显示更多字符 */
export function shortenDir(name: string): string {
  const chars = Array.from(name.trim())
  const width = (c: string) => /[\u2E80-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF]/.test(c) ? 1 : 0.5
  let used = 0
  let end = chars.length
  for (let i = 0; i < chars.length; i++) {
    used += width(chars[i])
    if (used > 6) { end = i; break }
  }
  const cut = chars.slice(0, end).join('').replace(/[\s]+$/,'')
  return end < chars.length ? `${cut}…` : cut
}
