

/**
 * 工具名 → 图标。
 *
 * 为什么每个任务要有图标：网页搜索那块的标题有一个放大镜，任务列表没有，
 * 两块并排时一眼就能看出「一个是检索、一个是执行」；但任务列表内部
 * bash / read / write / web_fetch 之间完全没有区分，只能靠读文字。
 *
 * 图标用内联 SVG（stroke 描边、18×18），与 WebSearchTrace 的 LensIcon 同一套画法 ——
 * 引用 lucide 会让两种图标在同一行里线宽不一致。
 */
export function ToolIcon({ name, className }: { name: string; className?: string }) {
  const n = name.toLowerCase()
  /* className 由 TaskList 传入（.tl-task-icon，负责 16px 盒与颜色）；
     .tl-task-svg 负责线宽与填充。两个都要，否则图标没有尺寸约束。 */
  const common = {
    viewBox: '0 0 18 18',
    'aria-hidden': true,
    className: `tl-task-svg${className ? ` ${className}` : ''}`,
  } as const

  /* 终端 / 命令 */
  if (n.includes('bash') || n.includes('shell') || n.includes('pwsh') || n.includes('terminal')) {
    return (
      <svg {...common}>
        <rect x="2" y="3.5" width="14" height="11" rx="2" />
        <path d="M5.2 7.4 L7.4 9.4 L5.2 11.4" />
        <path d="M9.4 11.4 H12.6" />
      </svg>
    )
  }
  /* 读文件 */
  if (n === 'read' || n.includes('read_file') || n.includes('readfile')) {
    return (
      <svg {...common}>
        <path d="M4 2.5 H11 L14 5.5 V15.5 H4 Z" />
        <path d="M11 2.5 V5.5 H14" />
      </svg>
    )
  }
  /* 写 / 编辑文件 */
  if (n === 'write' || n.includes('write') || n.includes('edit') || n.includes('str_replace')) {
    return (
      <svg {...common}>
        <path d="M3 15 L3.6 11.8 L11.8 3.6 L14.4 6.2 L6.2 14.4 Z" />
        <path d="M10.6 4.8 L13.2 7.4" />
      </svg>
    )
  }
  /* 抓网页 */
  if (n.includes('fetch') || n.includes('http') || n.includes('url')) {
    return (
      <svg {...common}>
        <circle cx="9" cy="9" r="6.5" />
        <path d="M2.5 9 H15.5" />
        <path d="M9 2.5 C11.4 4.8 11.4 13.2 9 15.5" />
      </svg>
    )
  }
  /* 目录 / 列文件 */
  if (n.includes('ls') || n.includes('dir') || n.includes('glob') || n.includes('list')) {
    return (
      <svg {...common}>
        <path d="M2.5 5.5 H7 L8.5 7.2 H15.5 V14 H2.5 Z" />
      </svg>
    )
  }
  /* 搜索类（理论上已被 WebSearchTrace 拿走，兜底） */
  if (n.includes('search') || n.includes('grep') || n.includes('find')) {
    return (
      <svg {...common}>
        <circle cx="7.6" cy="7.6" r="5.4" />
        <path d="M11.6 11.6 L15.4 15.4" />
      </svg>
    )
  }
  /* 兜底：一个圆点，不编造含义 */
  return (
    <svg {...common}>
      <circle cx="9" cy="9" r="3.2" />
    </svg>
  )
}

/**
 * 「思考」任务的图标。
 *
 * <p>思考不是工具调用，但它和工具步骤同处一张任务列表；不给图标时，
 * 工具行前面都有图标、唯独思考行前面空一格，看起来像渲染漏了。</p>
 */
export function ThinkingIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 18 18"
      aria-hidden
      className={`tl-task-svg${className ? ` ${className}` : ''}`}
    >
      {/* 一个思考气泡：外框 + 两个点，与工具图标的线宽保持一致 */}
      <path d="M9 2.8 C12.9 2.8 15.6 5.2 15.6 8.2 C15.6 11.2 12.9 13.6 9 13.6
               C7.9 13.6 6.9 13.4 6 13 L3 14.4 L3.9 11.6
               C2.9 10.7 2.4 9.5 2.4 8.2 C2.4 5.2 5.1 2.8 9 2.8 Z" />
      <circle cx="6.6" cy="8.2" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="11.4" cy="8.2" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  )
}

/**
 * 文件类型图标（chip 里的那个小字）。
 *
 * BoardUI 用 React 官方图标标 .tsx 文件；本项目没有那套品牌图标，
 * 改成按扩展名区分的通用图形 —— 目的是「一眼看出这是代码还是文档」，
 * 不是「认出这是哪个框架」。
 */
export function FileTypeIcon({ name }: { name: string }) {
  const ext = (name.split('.').pop() ?? '').toLowerCase()
  const common = { viewBox: '0 0 16 16', 'aria-hidden': true, className: 'tl-chip-svg' } as const

  /* 代码类 */
  /* mjs / cjs / mts / cts 也是 JS/TS，漏掉会掉进文档图标的兜底，
     同一个项目里 .js 是代码图标、.mjs 是文档图标，看起来像渲染错了。 */
  if (['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'mts', 'cts', 'py', 'go', 'rs', 'java', 'c', 'cpp', 'sh'].includes(ext)) {
    return (
      <svg {...common}>
        <path d="M5.6 4.4 L2.6 8 L5.6 11.6" />
        <path d="M10.4 4.4 L13.4 8 L10.4 11.6" />
      </svg>
    )
  }
  /* 配置 / 数据 */
  if (['json', 'yml', 'yaml', 'toml', 'xml', 'csv'].includes(ext)) {
    return (
      <svg {...common}>
        <path d="M3 3 H13 V13 H3 Z" />
        <path d="M3 6.5 H13" />
      </svg>
    )
  }
  /* 文档 */
  if (['md', 'txt', 'doc', 'docx', 'pdf'].includes(ext)) {
    return (
      <svg {...common}>
        <path d="M4 2 H10 L12.5 4.5 V14 H4 Z" />
        <path d="M6 7 H10.5" />
        <path d="M6 9.8 H10.5" />
      </svg>
    )
  }
  /* 图片 / 视频 */
  if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'mp4', 'mov', 'webm'].includes(ext)) {
    return (
      <svg {...common}>
        <rect x="2.5" y="3.5" width="11" height="9" rx="1.5" />
        <path d="M2.5 10.5 L6 7.5 L9 10" />
      </svg>
    )
  }
  /* 兜底：普通文件 */
  return (
    <svg {...common}>
      <path d="M4 2 H10 L12.5 4.5 V14 H4 Z" />
    </svg>
  )
}
