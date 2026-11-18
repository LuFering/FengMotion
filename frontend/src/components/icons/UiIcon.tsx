/**
 * 图标规范层 —— 全站图标的唯一入口。
 *
 * 为什么要有这一层：
 *   改造前全站直接 import lucide-react，散落 48 种 strokeWidth、20+ 种 size，
 *   同一个语义出现 3 个图标（X / XIcon / X as XMark、AlertTriangle / AlertCircle / CircleAlert）。
 *   视觉上表现为粗细不一、大小跳跃、主次不分。
 *
 * ── 图标库选型（2026-11-18 二次调整）────────────────────────────
 * 首轮试过 Phosphor：圆角线帽在 20px 下偏软，「工作流」的曲线东倒西歪、
 * 「社区」三个人形挤成一团、「更多」三个点大小不一 —— 实测截图确认不够精致。
 *
 * 现用 Untitled UI Icons（@untitledui/icons，GitHub: untitleduico/icons）：
 *   · 由产品设计师在 Figma 里逐像素绘制，1,100+ 免费图标，个人与商业项目均可免费使用；
 *   · 中性、克制、无风格化装饰，专为现代 UI 设计；
 *   · 单一线性风格、统一栅格与视觉重量，不做多字重导致的不一致；
 *   · 无运行时依赖，按图标 tree-shake。
 *
 * 约定：
 *   1. 图标只从本文件取，不直接 import @untitledui/icons；
 *   2. 尺寸只用 ICON_SIZE 五档，不再写 size={13} 这类任意值；
 *   3. 颜色走 currentColor，父级 hover/active 自动跟随。
 */
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Camera01,
  Check,
  ChevronDown,
  ChevronRight,
  Copy01,
  Dataflow02,
  DotsHorizontal,
  Download01,
  Eye,
  Film01,
  Folder,
  Home02,
  Image01,
  InfoCircle,
  Loading01,
  MessageCircle01,
  SearchLg,
  Settings01,
  Sliders01,
  Terminal,
  Trash01,
  Play,
  PauseCircle,
  Plus,
  RefreshCcw01,
  Scissors01,
  Upload01,
  Users03,
  X,
} from '@untitledui/icons'

/**
 * Untitled UI 图标组件的类型。
 * 每个图标导出为 FC<Props>，Props extends SVGProps<SVGSVGElement>。
 * 这里直接从 Home02 反推，避免手写签名与实际不一致（手写时 focusable 类型就对不上）。
 */
export type UntIcon = typeof Home02

/** 尺寸五档 —— 不再出现第 6 种。 */
export const ICON_SIZE = {
  /** 12px 行内微标（状态点旁、徽标内） */
  xs: 12,
  /** 14px 按钮内、行内操作 */
  sm: 14,
  /** 16px 工具栏、面板头 */
  md: 16,
  /** 20px 侧栏一级项 */
  lg: 20,
  /** 24px 空状态、引导位 */
  xl: 24,
} as const

export type IconSize = keyof typeof ICON_SIZE
export type IconTone = 'fg' | 'dim' | 'acc' | 'ok' | 'warn' | 'bad'

const SIZE_CLASS: Record<IconSize, string> = {
  xs: 'ico ico-xs',
  sm: 'ico ico-sm',
  md: 'ico ico-md',
  lg: 'ico ico-lg',
  xl: 'ico ico-xl',
}

export const TONE_CLASS: Record<IconTone, string> = {
  fg: 'ico-fg',
  dim: 'ico-dim',
  acc: 'ico-acc',
  ok: 'ico-ok',
  warn: 'ico-warn',
  bad: 'ico-bad',
}

/**
 * 统一图标组件。
 *
 * 用法：<UiIcon icon={Home02} size="lg" />
 *      <UiIcon icon={X} size="sm" tone="dim" label="关闭" />
 *
 * label：给了就作为可访问名，不给则 aria-hidden。
 * 纯装饰图标不传 label —— 避免读屏读到一串无意义的图标名。
 */
export function UiIcon({
  icon: Glyph,
  size = 'md',
  tone,
  label,
  fill,
  className = '',
}: {
  icon: UntIcon
  size?: IconSize
  tone?: IconTone
  label?: string
  /** 仅在需要实心/空心切换时传（如收藏星标）；普通图标不传，保持描边 */
  fill?: string
  className?: string
}) {
  return (
    <Glyph
      size={ICON_SIZE[size]}
      className={[SIZE_CLASS[size], tone ? TONE_CLASS[tone] : '', className].filter(Boolean).join(' ')}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      focusable="false"
      {...(fill ? { fill } : {})}
    />
  )
}

/**
 * 语义图标表 —— 全站同一含义只允许一个图标。
 * 用 <UiIcon icon={SemIcons.close} /> 即可，不用记 Untitled 的编号命名。
 */
export const SemIcons = {
  /* 导航 */
  home: Home02,
  creation: MessageCircle01,
  workflow: Dataflow02,
  community: Users03,
  more: DotsHorizontal,
  settings: Settings01,

  /* 通用动作 */
  close: X,
  check: Check,
  plus: Plus,
  copy: Copy01,
  trash: Trash01,
  search: SearchLg,
  refresh: RefreshCcw01,
  download: Download01,
  upload: Upload01,
  terminal: Terminal,
  sliders: Sliders01,

  /* 方向 */
  back: ArrowLeft,
  forward: ArrowRight,
  expand: ChevronRight,
  collapse: ChevronDown,

  /* 播放控制 */
  play: Play,
  pause: PauseCircle,

  /* 状态 */
  warning: AlertTriangle,
  error: AlertCircle,
  info: InfoCircle,
  loading: Loading01,

  /* 内容类型 */
  film: Film01,
  image: Image01,
  camera: Camera01,
  scissors: Scissors01,
  folder: Folder,
  eye: Eye,
} as const

export type SemIconName = keyof typeof SemIcons
