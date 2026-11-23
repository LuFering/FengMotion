import type { MappingJobStage, SkillPackage, WorkflowPreset } from '@/api/skillPresets'

/** 导入面板顶部的五步；界面术语见契约 workflow-editor-ui.md §1 */
export const IMPORT_STEPS = ['地址', '清点', '生成', '审阅', '启用'] as const
export type ImportStep = 0 | 1 | 2 | 3 | 4

export const STAGE_LABEL: Record<MappingJobStage, string> = {
  collecting: '整理交给模型的资料',
  calling_model: '模型正在生成',
  validating: '校验格式与职责',
  saving: '保存草稿',
}

export const STATUS_LABEL: Record<WorkflowPreset['status'], string> = {
  draft: '草稿',
  active: '已启用',
  archived: '已归档',
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  return s < 60 ? `${s} 秒` : `${Math.floor(s / 60)} 分 ${String(s % 60).padStart(2, '0')} 秒`
}

export const packageLabel = (p: Pick<SkillPackage, 'owner' | 'repo'>) => `${p.owner}/${p.repo}`
export const shortSha = (sha: string) => sha.slice(0, 7)

/**
 * 只在本地校验地址格式（契约 skill-package.md §4 支持的写法）：owner/repo，
 * 或 https://github.com/owner/repo（可带 .git、/tree/<ref>/<path>）。返回 null 表示格式不对。
 */
export function parseRepository(input: string): { owner: string; repo: string; ref?: string; path?: string } | null {
  const raw = input.trim()
  if (!raw) return null
  const name = '[A-Za-z0-9_.-]+'
  const short = new RegExp(`^(${name})/(${name})$`).exec(raw)
  if (short) return { owner: short[1], repo: short[2].replace(/\.git$/, '') }
  const url = new RegExp(`^https://github\\.com/(${name})/(${name})(?:/tree/([^/]+)(?:/(.+?))?)?/?$`).exec(raw)
  if (!url) return null
  return { owner: url[1], repo: url[2].replace(/\.git$/, ''), ...(url[3] ? { ref: url[3] } : {}), ...(url[4] ? { path: url[4] } : {}) }
}

/** 审阅面板的分组：后端 problems[].field 的第一段字段名 → 分组 */
export const REVIEW_SECTIONS = [
  { id: 'basics', label: '基本信息', fields: ['name', 'description', 'slug', 'defaults'] },
  { id: 'prompt', label: '需求骨架', fields: ['promptScaffold'] },
  { id: 'inputs', label: '输入', fields: ['requiredInputs'] },
  { id: 'review', label: '审片项', fields: ['reviewChecklist'] },
  { id: 'drafts', label: '工作稿模板', fields: ['lookdevTemplate', 'filmPlanTemplate'] },
  { id: 'steps', label: '步骤', fields: ['stepMapping', 'unmapped'] },
  { id: 'guide', label: '方法指引', fields: ['guide'] },
  { id: 'components', label: '组件', fields: ['components'] },
  { id: 'commands', label: '命令', fields: ['instructedCommands'] },
] as const
export type ReviewSectionId = (typeof REVIEW_SECTIONS)[number]['id']

export interface FieldProblem { field: string; message: string; section: ReviewSectionId | null; index: number | null }

/** 把 422 的 problems 挂到分组和条目上；认不出的字段 section 为 null，放在面板顶部 */
export function groupProblems(problems: Array<{ field?: string; message?: string }>): FieldProblem[] {
  return problems.map((p) => {
    const field = String(p.field ?? '')
    const head = /^([A-Za-z]+)(?:\[(\d+)\])?/.exec(field)
    const section = head ? REVIEW_SECTIONS.find((s) => (s.fields as readonly string[]).includes(head[1]))?.id ?? null : null
    return { field, message: String(p.message ?? ''), section, index: head?.[2] != null ? Number(head[2]) : null }
  })
}

/** 字段路径写成用户看得懂的位置，例如 guide[0].sources[0] → 「第 1 段 · 来源」 */
export function problemPlace(p: FieldProblem): string {
  const parts: string[] = []
  if (p.index !== null) parts.push(`第 ${p.index + 1} 项`)
  const tail = /\.([A-Za-z]+)/.exec(p.field.replace(/^[A-Za-z]+(\[\d+\])?/, ''))?.[1]
  const TAIL: Record<string, string> = { sources: '来源', action: '动作', node: '节点', title: '标题', body: '正文', path: '路径', decision: '处理方式', label: '名称', requiredWhen: '适用条件', ratio: '画幅', duration: '时长' }
  if (tail) parts.push(TAIL[tail] ?? tail)
  return parts.join(' · ')
}

/** 问题出在哪：「方法指引 · 第 1 项 · 来源」；认不出的字段原样显示 */
export function problemLabel(p: FieldProblem): string {
  const section = REVIEW_SECTIONS.find((x) => x.id === p.section)?.label
  const place = problemPlace(p)
  if (!section) return p.field
  return place ? `${section} · ${place}` : section
}

export const TARGET_NODE_LABEL: Record<string, string> = {
  prompt: '创作需求',
  refs: '素材与参考',
  capability: '创作能力',
  create: '制作与渲染',
  review: '审片与修改',
  delivery: '交付',
  drafts: '工作稿',
}

export const INPUT_KIND_LABEL: Record<string, string> = { asset: '素材', reference: '参考片', text: '文字' }
