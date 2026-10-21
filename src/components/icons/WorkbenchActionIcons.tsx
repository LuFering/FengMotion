import type { SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement> & { size?: number }

const base = (size: number) => ({
  width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
  stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const, 'aria-hidden': true,
})

/** 引用此帧：取景框 + 中心测量点。 */
export function FrameRefIcon({ size = 18, ...props }: IconProps) {
  return (
    <svg {...base(size)} {...props}>
      <path d="M8 3H5.5A2.5 2.5 0 0 0 3 5.5V8" />
      <path d="M16 3h2.5A2.5 2.5 0 0 1 21 5.5V8" />
      <path d="M3 16v2.5A2.5 2.5 0 0 0 5.5 21H8" />
      <path d="M21 16v2.5A2.5 2.5 0 0 1 18.5 21H16" />
      <circle cx="12" cy="12" r="2.4" />
      <path d="M12 7.4v1.1M12 15.5v1.1M7.4 12h1.1M15.5 12h1.1" opacity=".65" />
    </svg>
  )
}

/** 引用本场：范围括号 + 播放头。 */
export function RangeRefIcon({ size = 18, ...props }: IconProps) {
  return (
    <svg {...base(size)} {...props}>
      <path d="M7 6H4v12h3M17 6h3v12h-3" />
      <path d="M9 12h6" opacity=".45" />
      <circle cx="12" cy="12" r="1.45" />
    </svg>
  )
}

/** 框选区域：外取景角 + 内部虚线选区。 */
export function RegionRefIcon({ size = 18, ...props }: IconProps) {
  return (
    <svg {...base(size)} {...props}>
      <path d="M8 3H5.5A2.5 2.5 0 0 0 3 5.5V8" />
      <path d="M16 3h2.5A2.5 2.5 0 0 1 21 5.5V8" />
      <path d="M3 16v2.5A2.5 2.5 0 0 0 5.5 21H8" />
      <path d="M21 16v2.5A2.5 2.5 0 0 1 18.5 21H16" />
      <rect x="8" y="8" width="8" height="8" rx="1.5" strokeDasharray="2.2 2.2" />
    </svg>
  )
}

/** Remotion 编辑：三条参数轨 + 三个调节点。 */
export function EditParamsIcon({ size = 18, ...props }: IconProps) {
  return (
    <svg {...base(size)} {...props}>
      <path d="M4 7h4M12 7h8M4 12h8M16 12h4M4 17h3M11 17h9" opacity=".8" />
      <circle cx="10" cy="7" r="2" />
      <circle cx="14" cy="12" r="2" />
      <circle cx="9" cy="17" r="2" />
    </svg>
  )
}
