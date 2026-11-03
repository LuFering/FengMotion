/**
 * 执行引擎（harness）与模型配置 —— 首页与对话界面共用同一份定义。
 *
 * 抽出来的原因：首页的引擎选择器与对话输入区的引擎/模型配置必须是同一套数据，
 * 否则两个入口选出来的引擎会不一致（同一个产品里出现两种「当前引擎」）。
 *
 * ⚠️ 演示态：只有 deepseek 标为已配置，其余如实标注「未接入」；
 *    模型列表与偏好只存内存 + localStorage，不假装调用了真实 API。
 */

export interface Harness {
  id: string
  name: string
  /** 按钮上的短名 */
  short: string
  /** 兜底字形（图标加载失败时用） */
  mark: string
  /** 品牌图标路径（CSS mask，用 background-color 上色） */
  icon: string
  color: string
  models: string[]
  /** 是否已接入（未接入的不许发送，界面要如实标出） */
  ready: boolean
}

/** 每个模型的本地偏好：思考强度与最大上下文 */
export type Reasoning = 'off' | 'standard' | 'enhanced'
export interface ModelPrefs {
  reasoning: Reasoning
  context: 32 | 64 | 128
}

export const REASONING_LABEL: Record<Reasoning, string> = {
  off: '关闭',
  standard: '标准',
  enhanced: '增强',
}

/** 执行引擎列表：只有 deepseek 标为已配置，其余如实标注「未接入」 */
export const HARNESSES: Harness[] = [
  { id: 'deepseek', name: 'DeepSeek Harness', short: 'DeepSeek', mark: 'DS', icon: './assets/brand/deepseek.svg', color: '#4D6BFE', models: ['deepseek-chat', 'deepseek-reasoner', 'deepseek-v4.1-flash'], ready: true },
  { id: 'claude', name: 'Claude Code', short: 'Claude', mark: 'CC', icon: './assets/brand/claude.svg', color: '#D97757', models: ['claude-sonnet-4', 'claude-opus-4'], ready: false },
  { id: 'codex', name: 'Codex', short: 'Codex', mark: 'CX', icon: './assets/brand/openai.svg', color: '#10A37F', models: ['gpt-5-codex'], ready: false },
]

export const DEFAULT_PREFS: ModelPrefs = { reasoning: 'standard', context: 64 }

/** 偏好持久化 key：按「引擎:模型」分别记 */
export const prefsKey = (harnessId: string, model: string) => `${harnessId}:${model}`

const STORE = 'fengmotion:model-prefs'

export function loadPrefs(): Record<string, ModelPrefs> {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(STORE) ?? '{}')
    return v && typeof v === 'object' ? (v as Record<string, ModelPrefs>) : {}
  } catch {
    return {}
  }
}

export function savePrefs(prefs: Record<string, ModelPrefs>) {
  try {
    localStorage.setItem(STORE, JSON.stringify(prefs))
  } catch { /* localStorage 不可用时静默降级为内存态 */ }
}
