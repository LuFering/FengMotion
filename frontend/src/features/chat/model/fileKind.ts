/** 按扩展名判断文件类型：文件标签、改动文件卡、产物卡共用同一套口径。 */
export type FileKind = 'code' | 'data' | 'doc' | 'image' | 'video' | 'audio' | 'folder' | 'file'

const EXT_KIND: Record<string, FileKind> = {}
const add = (kind: FileKind, exts: string[]) => exts.forEach((e) => { EXT_KIND[e] = kind })
add('code', ['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'mts', 'cts', 'py', 'go', 'rs', 'java', 'kt', 'c', 'h', 'cpp', 'sh', 'bash', 'zsh', 'css', 'scss', 'html', 'vue', 'svelte', 'sql', 'rb', 'php', 'swift'])
add('data', ['json', 'jsonc', 'json5', 'yml', 'yaml', 'toml', 'xml', 'csv', 'tsv', 'ini', 'env', 'lock'])
add('doc', ['md', 'mdx', 'txt', 'rst', 'doc', 'docx', 'pdf', 'rtf'])
add('image', ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'avif', 'bmp', 'ico'])
add('video', ['mp4', 'mov', 'webm', 'mkv', 'avi', 'm4v'])
add('audio', ['mp3', 'wav', 'aac', 'flac', 'ogg', 'm4a'])

/** 认得的扩展名：命令里只把这些当成文件，避免把 `film.config` 这类词误认成文件 */
export function isKnownFileName(name: string): boolean {
  const ext = /\.([A-Za-z0-9]+)$/.exec(name)?.[1]?.toLowerCase()
  return ext !== undefined && ext in EXT_KIND
}

export function fileKindOf(name: string): FileKind {
  if (name.endsWith('/')) return 'folder'
  const ext = /\.([A-Za-z0-9]+)$/.exec(name)?.[1]?.toLowerCase()
  return (ext && EXT_KIND[ext]) || 'file'
}
