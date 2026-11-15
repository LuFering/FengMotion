/**
 * 选中时间段的纯函数层。
 *
 * <p>为什么单独一份：工作台上「拖出一个时间段，让 AI 只改这几秒」这件事，
 * 涉及三处口径必须一致 —— 控件上显示的时间码、写进创作请求里的秒数、
 * 以及用户回来核对时看到的同一句话。三处各写一遍格式化，
 * 迟早出现「界面写 00:03，请求里写 3.000，审阅记录里写 0:03」这种对不上的情况。</p>
 *
 * <p>这一层不碰 DOM，也不认「3–6 秒」这种特定说法 —— 任何起止秒数都按同一套规则
 * 换算成给人看的表述，控件与请求共用。</p>
 */

/** 时间段的权威表示：秒，起止都是相对片段开头的绝对秒数。 */
export interface TimeSpan {
  start: number
  end: number
}

/**
 * 时间码。
 *
 * <p>小时只在真的有小时时才出现：一条 8 秒的片子上写 00:00:03
 * 多出两组零，反而更难扫。超过一小时才切到 h:mm:ss。</p>
 *
 * @param seconds 秒（负数按 0 处理）
 * @param withMillis 是否带千分位。拖动时带、静态展示不带 —— 静止时三位小数是无用精度
 * @returns 形如 0:03 / 3.5 / 1:02:03 的时间码
 */
export function formatTimecode(seconds: number, withMillis = false): string {
  const safe = Number.isFinite(seconds) ? Math.max(0, seconds) : 0
  const rounded = withMillis ? Math.round(safe * 1000) / 1000 : Math.round(safe)
  const hours = Math.floor(rounded / 3600)
  const minutes = Math.floor((rounded % 3600) / 60)
  const rest = rounded % 60
  const secondsText = withMillis ? rest.toFixed(3) : String(Math.floor(rest)).padStart(2, '0')
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${secondsText.padStart(withMillis ? 6 : 2, '0')}`
  return `${minutes}:${secondsText.padStart(withMillis ? 6 : 2, '0')}`
}

/**
 * 把时间段的长度说成人话。
 *
 * @param span 时间段
 * @returns 例如「3.0 秒」
 */
export function spanLengthLabel(span: TimeSpan): string {
  const length = Math.max(0, span.end - span.start)
  return `${length.toFixed(1)} 秒`
}

/**
 * 用户在输入里写的时间段（可选）。
 *
 * <p>为什么控件要认得输入而不是只认拖拽：用户想改「第 3 秒到第 6 秒」，
 * 拖到 3.02 秒再拖回来太别扭；直接写 3-6 是最快的表达。
 * 但输入是自由的，所以这里只做「能认就认、认不出就明说认不出」，
 * 绝不在认不出时悄悄用一个默认段去改用户的片。</p>
 *
 * <p>支持：<br>
 * - {@code 3-6} / {@code 3~6} / {@code 3–6} / {@code 3..6} / {@code 3 到 6} / {@code 3 to 6}<br>
 * - {@code 0:03-0:06}（分:秒）<br>
 * - {@code 00:00:03-00:00:06}（时:分:秒）<br>
 * - {@code 3-6s} / {@code 3秒到6秒}（带单位后缀）</p>
 */
export interface SpanParseResult {
  /** 认得出来时的区间；认不出时为 null */
  span: TimeSpan | null
  /** 认不出时给用户看的原因；认得出来时为 null */
  problem: string | null
}

const NUMBER = String.raw`\d+(?:\.\d+)?`

/**
 * 把一个时间码片段换算成秒。
 *
 * <p>按冒号拆段，从右往左依次是秒、分、时 ——
 * 这样 0:03、1:02:03 走同一段代码，不必为每种写法各写一个正则。</p>
 *
 * @param token 形如 3 / 3.5 / 0:03 / 1:02:03
 * @returns 秒；格式不对返回 null
 */
function timecodeToSeconds(token: string): number | null {
  const parts = token.trim().split(':')
  if (parts.length > 3 || parts.some((part) => part === '')) return null
  let seconds = 0
  for (const part of parts) {
    if (!new RegExp(`^${NUMBER}$`).test(part)) return null
    seconds = seconds * 60 + Number(part)
  }
  return Number.isFinite(seconds) ? seconds : null
}

/**
 * 从用户输入里解析时间段。
 *
 * @param text 用户写的一段文字（通常是时间输入框的内容）
 * @returns 解析结果：认得出来给区间，认不出来给原因
 */
export function parseSpan(text: string): SpanParseResult {
  const raw = text.trim()
  if (!raw) return { span: null, problem: '先写一个时间段，例如 0:03–0:06。' }
  /* 单位后缀先剥掉：3s / 3秒 / 3 秒，与数字之间的空格可有可无。 */
  const stripped = raw.replace(/[sS秒]\s*$/, '').replace(/(\d)\s*(秒|s|S)\s*/g, '$1 ').trim()
  /* 分隔符统一成一枚：全角破折号、波浪号、连字符、省略号、中文「到」都当同一个意思。 */
  const normalized = stripped
    .replace(/[~～]|\.\.|…|—|–|－|至|\bto\b/gi, '-')
    .replace(/\s*到\s*/g, '-')
    .replace(/\s*-\s*/g, '-')
  const halves = normalized.split('-')
  if (halves.length !== 2) {
    return { span: null, problem: `没认出「${raw}」里的起止时间，请写成 0:03–0:06 或 3-6。` }
  }
  const start = timecodeToSeconds(halves[0])
  const end = timecodeToSeconds(halves[1])
  if (start === null || end === null) {
    return { span: null, problem: `「${raw}」里的时间读不出来，请用秒或 分:秒 的写法。` }
  }
  if (end <= start) {
    return { span: null, problem: '结束时间要晚于开始时间。' }
  }
  return { span: { start, end }, problem: null }
}

/**
 * 把时间段压进片段时长。
 *
 * <p>为什么必须钳：用户拖到片段末尾、或换成一条更短的版本后再用旧时间段，
 * 结束时间就会越过片长。直接发出去 agent 会去改一段不存在的时间，
 * 而用户以为要求已经被接受了。</p>
 *
 * @param span 时间段
 * @param duration 片段时长（秒）；未知时传 0 表示不钳上限
 * @returns 钳过的时间段；完全落在片段外时返回 null
 */
export function clampSpan(span: TimeSpan, duration: number): TimeSpan | null {
  const limit = Number.isFinite(duration) && duration > 0 ? duration : Number.POSITIVE_INFINITY
  const start = Math.min(Math.max(0, span.start), limit)
  const end = Math.min(Math.max(0, span.end), limit)
  /* 钳完如果长度归零，说明这段时间在片段里根本不存在 —— 不能悄悄缩成一个点。 */
  if (!(end > start)) return null
  return { start, end }
}

/**
 * 写进创作请求的时间段定位文本。
 *
 * <p>这是本功能真正落地的部分：用户圈了哪一段、想怎么改、以哪一版为基准，
 * 三件事都必须作为<strong>明确参数</strong>进请求，而不是混在用户的话里让 agent 猜。
 * 同时明写「其余时间段尽量不变」只是目标 —— 不能承诺逐帧不变，
 * 否则用户会拿这句话当验收标准。</p>
 *
 * @param span 时间段（已钳过）
 * @param prompt 用户对这几秒的修改要求
 * @param base 这次修改基于哪一版（版本号 + 该版产出的文件，便于 agent 对照）
 * @returns 追加到创作意图末尾的定位段
 */
export function timeSpanBrief(span: TimeSpan, prompt: string, base?: { version?: number | null; file?: string | null; label?: string | null }): string {
  const start = span.start.toFixed(3)
  const end = span.end.toFixed(3)
  const baseLine = base?.version != null
    ? `本次修改基于版本 v${base.version}${base.file ? `（${base.file}）` : ''}。`
    : base?.label ? `本次修改基于${base.label}。` : ''
  return [
    `修改时间段：第 ${start} 秒 至 第 ${end} 秒（时长 ${(span.end - span.start).toFixed(3)} 秒）。`,
    `用户对这几秒的要求：${prompt.trim()}`,
    baseLine,
    '时间范围就是这次要改的目标：请只改这一段的表现，其余时间段尽量保持原有画面与节奏。',
    '「尽量不变」是目标而不是承诺：如果你判断为了让这一秒接得上、必须动到相邻内容，先说清动了哪里、为什么，再动手。',
    '如果你无法定位到这一段（片段里没有对应内容、时间对不上、或找不到这一段的实现），请直接说明并询问，不要自行扩大修改范围。',
  ].filter(Boolean).join('\n')
}

/**
 * 时间段的一句话摘要，给界面标题与记录用。
 *
 * @param span 时间段
 * @param duration 片段时长，用于标出占比
 * @returns 例如「0:03–0:06 · 3.0 秒 · 占全片 8%」
 */
export function spanSummary(span: TimeSpan, duration: number): string {
  const parts = [`${formatTimecode(span.start)}–${formatTimecode(span.end)}`, spanLengthLabel(span)]
  if (Number.isFinite(duration) && duration > 0) {
    const share = Math.round(((span.end - span.start) / duration) * 100)
    if (share > 0 && share <= 100) parts.push(`占全片 ${share}%`)
  }
  return parts.join(' · ')
}
