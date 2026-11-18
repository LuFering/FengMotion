/**
 * Skill 包导入、映射审阅与工作流预设（B1–B4 / F1–F4）客户端。
 *
 * 与后端 `SkillPackageController`、`WorkflowPresetController`、`PresetMapping`、
 * `PresetApplyService` 精确对齐。
 */
import type { HttpClient } from './http'
import { ApiError } from './errors'

/* ── /api/skill-packages（与后端 SkillPackage / SkillInventory 对齐） ── */

export interface SkillInventorySkill {
  path: string
  directory: string
  name: string | null
  description: string | null
  frontmatter: Record<string, unknown> | null
  frontmatterError: string | null
}

export interface SkillImportRef {
  specifier: string
  kind: 'relative' | 'package' | 'builtin' | 'alias' | string
  resolved: string | null
}

export interface SkillFileEntry {
  path: string
  size: number
  sha256: string
  category: 'skill' | 'doc' | 'component' | 'code' | 'script' | 'config' | 'asset' | 'other' | string
  imports: SkillImportRef[] | null
}

export interface SkillScriptEntry {
  path: string
  kind: 'file' | 'npm-script' | string
  name: string | null
  reason: string
}

export interface SkillInstructedCommand {
  skillPath: string
  command: string
}

export interface SkillDependencies {
  declared: Record<string, string>
  used: string[]
  undeclared: string[]
  remotionPackages: Record<string, string>
  approximate: boolean
}

export interface SkillLicense {
  spdx: string
  files: string[]
  packageJsonLicense: string | null
}

export interface SkillSummary {
  skills: number
  files: number
  totalBytes: number
  categories: Record<string, number>
  scripts: number
  unresolvedImports: number
}

export interface SkillInventory {
  version: number
  skills: SkillInventorySkill[]
  files: SkillFileEntry[]
  scripts: SkillScriptEntry[]
  instructedCommands: SkillInstructedCommand[]
  dependencies: SkillDependencies
  license: SkillLicense
  warnings: string[]
  summary: SkillSummary
}

export interface SkillPackage {
  id: string
  owner: string
  repo: string
  requestedRef: string | null
  commitSha: string
  subPath: string
  rootDir: string
  fileCount: number
  totalBytes: number
  report: SkillInventory | null
  importedAt: string
}

export interface ImportSkillPackageResponse {
  reused: boolean
  skillPackage: SkillPackage
}

/* ── B1–B4 映射与预设数据结构（对齐后端 PresetMapping / WorkflowPreset） ── */

export type InstructedCommandDecision = 'replace-with-builtin' | 'manual-approval' | 'ignore'

export const INSTRUCTED_COMMAND_DECISION_OPTIONS: ReadonlyArray<{
  value: InstructedCommandDecision
  label: string
}> = [
  { value: 'replace-with-builtin', label: '用本项目自己的检查替代' },
  { value: 'manual-approval', label: '需人工批准' },
  { value: 'ignore', label: '忽略' },
]

export interface MappingRequiredInput {
  kind: 'asset' | 'reference' | 'text' | string
  label: string
  required: boolean
}

export interface MappingGuideSection {
  title: string
  body: string
  sources: string[]
}

export interface MappingComponent {
  path: string
  purpose: string
}

export interface MappingCommandDecision {
  command: string
  decision: InstructedCommandDecision
  note?: string | null
}

export type MappingTargetNode =
  | 'prompt'
  | 'refs'
  | 'capability'
  | 'create'
  | 'review'
  | 'delivery'
  | 'drafts'

export interface MappingStepItem {
  step: string
  node: MappingTargetNode | string
  note?: string | null
}

export interface MappingUnmappedItem {
  step: string
  reason: string
}

export interface SkillPresetMapping {
  name: string
  description: string
  slug: string
  promptScaffold: string
  defaults: {
    duration: string | null
    ratio: '16:9' | '9:16' | '1:1' | '4:5' | string | null
  }
  requiredInputs: MappingRequiredInput[]
  lookdevTemplate: string | null
  filmPlanTemplate: string | null
  reviewChecklist: string[]
  guide: MappingGuideSection[]
  components: MappingComponent[]
  instructedCommands: MappingCommandDecision[]
  stepMapping: MappingStepItem[]
  unmapped: MappingUnmappedItem[]
  truncatedSources: string[]
}

export type WorkflowPresetStatus = 'draft' | 'active' | 'archived'

export interface WorkflowPreset {
  id: string
  name: string
  description: string
  status: WorkflowPresetStatus
  skillPackageId: string
  sourceRepo: string
  skillPath: string
  commitSha: string
  mapping: SkillPresetMapping
  mappingVersion: number
  createdAt: string
  updatedAt?: string
  activatedAt?: string | null
}

/** 项目当前的视频类型记录（`.fengmotion/preset.json`，对齐后端 PresetApplyService.Record）。 */
export interface ProjectPresetRecord {
  presetId: string
  name: string
  sourceRepo: string
  commitSha: string
  skillPath: string
  mappingVersion: number
  guideSha256: string
  draftSha256: Record<string, string | null> | null
  appliedAt: string
}

export interface ApplyPresetDraftAction {
  name: string
  action: 'written' | 'replaced' | 'unchanged' | 'kept' | string
  reason: string
}

export interface ApplyPresetResult {
  presetId: string
  previousPresetId: string | null
  guide: 'written' | 'replaced' | 'unchanged' | string
  guideBackup: string | null
  componentsCopied: number
  drafts: ApplyPresetDraftAction[]
  warnings: string[]
}

const IMPORT_TIMEOUT_MS = 120_000
const MAPPING_TIMEOUT_MS = 130_000

/** 落地失败是不是因为视频类型已经不是启用状态（归档）。后端码不在契约码表里，原码在 details.rawCode。 */
export function isPresetNotActiveError(err: unknown): boolean {
  return err instanceof ApiError && err.details?.rawCode === 'preset_not_active'
}

/** 从 422 / 400 ApiError 中提取逐项校验问题（对齐 ApiExceptionHandler.mappingInvalid 的 problems）。 */
export function extractPresetValidationErrors(err: unknown): string[] {
  if (err instanceof ApiError) {
    const out: string[] = []
    if (err.details) {
      const list = err.details.problems ?? err.details.errors ?? err.details.failures ?? err.details.violations
      if (Array.isArray(list)) {
        for (const item of list) {
          if (typeof item === 'string' && item.trim()) out.push(item.trim())
          else if (item && typeof item === 'object') {
            const rec = item as { field?: unknown; message?: unknown; reason?: unknown }
            const msg = String(rec.message ?? rec.reason ?? '').trim()
            const field = String(rec.field ?? '').trim()
            if (msg) out.push(field ? `${field}: ${msg}` : msg)
          }
        }
      }
    }
    if (out.length === 0 && err.message) out.push(err.message)
    return out
  }
  if (err instanceof Error && err.message) return [err.message]
  return ['请求失败']
}

/** 规范化来自后端的 PresetMapping，兼容缺省数组/null 字段。 */
export function normalizePresetMapping(raw: Partial<SkillPresetMapping> | null | undefined): SkillPresetMapping {
  const m = raw ?? {}
  return {
    name: String(m.name ?? ''),
    description: String(m.description ?? ''),
    slug: String(m.slug ?? ''),
    promptScaffold: String(m.promptScaffold ?? ''),
    defaults: {
      duration: m.defaults?.duration ? String(m.defaults.duration) : null,
      ratio: m.defaults?.ratio ? String(m.defaults.ratio) : null,
    },
    requiredInputs: Array.isArray(m.requiredInputs)
      ? m.requiredInputs.map((item) =>
          typeof item === 'string'
            ? { kind: 'asset', label: item, required: false }
            : {
                kind: String(item?.kind ?? 'asset'),
                label: String(item?.label ?? ''),
                required: Boolean(item?.required),
              },
        )
      : [],
    lookdevTemplate: m.lookdevTemplate ?? null,
    filmPlanTemplate: m.filmPlanTemplate ?? null,
    reviewChecklist: Array.isArray(m.reviewChecklist) ? m.reviewChecklist.map(String) : [],
    guide: Array.isArray(m.guide)
      ? m.guide.map((s) => ({
          title: String(s?.title ?? ''),
          body: String(s?.body ?? ''),
          sources: Array.isArray(s?.sources) ? s.sources.map(String) : [],
        }))
      : [],
    components: Array.isArray(m.components)
      ? m.components.map((c) => ({
          path: String(c?.path ?? ''),
          purpose: String(c?.purpose ?? ''),
        }))
      : [],
    instructedCommands: Array.isArray(m.instructedCommands)
      ? m.instructedCommands.map((cmd) => ({
          command: String(cmd?.command ?? ''),
          decision:
            cmd?.decision === 'replace-with-builtin' ||
            cmd?.decision === 'manual-approval' ||
            cmd?.decision === 'ignore'
              ? cmd.decision
              : 'manual-approval',
          ...(cmd?.note ? { note: String(cmd.note) } : {}),
        }))
      : [],
    stepMapping: Array.isArray(m.stepMapping)
      ? m.stepMapping.map((s) => ({
          step: String(s?.step ?? ''),
          node: String(s?.node ?? 'create'),
          ...(s?.note ? { note: String(s.note) } : {}),
        }))
      : [],
    unmapped: Array.isArray(m.unmapped)
      ? m.unmapped.map((u) => ({
          step: String(u?.step ?? ''),
          reason: String(u?.reason ?? ''),
        }))
      : [],
    truncatedSources: Array.isArray(m.truncatedSources) ? m.truncatedSources.map(String) : [],
  }
}

function normalizePreset(raw: WorkflowPreset): WorkflowPreset {
  return {
    ...raw,
    mapping: normalizePresetMapping(raw.mapping),
  }
}

export function createSkillPresetsResource(http: HttpClient) {
  return {
    /** 导入 GitHub skill 包（静态清点，不执行包内脚本） */
    importSkillPackage(body: { repository: string; ref?: string; path?: string }): Promise<ImportSkillPackageResponse> {
      return http.post<ImportSkillPackageResponse>('/skill-packages/import', body, {
        timeoutMs: IMPORT_TIMEOUT_MS,
      })
    },

    /** 列出已导入的 skill 包（不含 report 正文） */
    listSkillPackages(): Promise<SkillPackage[]> {
      return http.get<SkillPackage[]>('/skill-packages')
    },

    /** 读取单个 skill 包详情与静态清点报告 */
    getSkillPackage(packageId: string): Promise<SkillPackage> {
      return http.get<SkillPackage>(`/skill-packages/${encodeURIComponent(packageId)}`)
    },

    /** 删除已导入的 skill 包 */
    async deleteSkillPackage(packageId: string): Promise<void> {
      await http.del(`/skill-packages/${encodeURIComponent(packageId)}`)
    },

    /** B3：基于 packageId + skillPath 生成预设映射草稿（同步，超时 120s） */
    async generateMapping(packageId: string, skillPath: string): Promise<WorkflowPreset> {
      const res = await http.post<WorkflowPreset>(
        `/skill-packages/${encodeURIComponent(packageId)}/mappings`,
        { skillPath },
        { timeoutMs: MAPPING_TIMEOUT_MS },
      )
      return normalizePreset(res)
    },

    /** B3：列出工作流预设（默认返回 active，传 all 可返回全部） */
    async listPresets(status?: WorkflowPresetStatus | 'all'): Promise<WorkflowPreset[]> {
      const payload = await http.get<WorkflowPreset[]>(
        '/workflow-presets',
        status ? { query: { status } } : undefined,
      )
      return Array.isArray(payload) ? payload.map(normalizePreset) : []
    },

    /** B3：获取预设详情（含 mapping 与来源） */
    async getPreset(presetId: string): Promise<WorkflowPreset> {
      const res = await http.get<WorkflowPreset>(`/workflow-presets/${encodeURIComponent(presetId)}`)
      return normalizePreset(res)
    },

    /** B3：修改草稿态预设的映射（激活态由后端拒绝） */
    async updatePresetMapping(presetId: string, mapping: SkillPresetMapping): Promise<WorkflowPreset> {
      const res = await http.put<WorkflowPreset>(
        `/workflow-presets/${encodeURIComponent(presetId)}/mapping`,
        mapping,
      )
      return normalizePreset(res)
    },

    /** B3：启用草稿为正式视频类型预设 */
    async activatePreset(presetId: string): Promise<WorkflowPreset> {
      const res = await http.post<WorkflowPreset>(`/workflow-presets/${encodeURIComponent(presetId)}/activate`, {})
      return normalizePreset(res)
    },

    /** B3：归档预设 */
    async archivePreset(presetId: string): Promise<void> {
      await http.del(`/workflow-presets/${encodeURIComponent(presetId)}`)
    },

    /** B4：读取项目当前落地的视频类型；没有落地过为 null */
    async getProjectPreset(projectId: string): Promise<ProjectPresetRecord | null> {
      const res = await http.get<{ record: ProjectPresetRecord | null }>(
        `/projects/${encodeURIComponent(projectId)}/workflow/preset`,
      )
      return res?.record ?? null
    },

    /** B4：把预设落地到项目目录（幂等可重复调用） */
    applyPresetToProject(projectId: string, presetId: string): Promise<ApplyPresetResult> {
      return http.post<ApplyPresetResult>(
        `/projects/${encodeURIComponent(projectId)}/workflow/preset`,
        { presetId },
      )
    },
  }
}
