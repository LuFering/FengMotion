/**
 * 正文内嵌提问表单：模型在回复里输出 `<question-form>` 标签，前端渲染成可交互控件。
 *
 * ## 为什么不用 dsh 的 ask_user_question 工具
 *
 * 实测该工具在本项目**不可用**：调用后返回
 * `no user-questions answerer accepted the request`。
 * 因为提问走 `user-questions/request` waterfall，应答方是 dsh 自己的前端 UI 插件
 * （`dsh-client-ui-user-questions`），而我们是 SDK 客户端，没有这条注册通道；
 * SDK / ACP 层也完全不转发提问。
 *
 * ## 所以照 open-design 的做法
 *
 * 它同样接 dsh，早期也做过 `AskUserQuestion` 的交互卡片，后来**整套机制删掉了**
 * （源码注释：the mechanism was retired，dedicated parser module was deleted），
 * 换成正文内嵌 `<question-form>`：
 *
 * 1. 模型在正文里输出 JSON 表单
 * 2. 前端解析、渲染成控件
 * 3. 用户答完，**以普通用户消息发回**（`[form answers — id]` 开头）
 *
 * 关键在于第 3 步：答案走普通消息，不经过任何工具应答通道 ——
 * 这正是绕开上述限制的地方。
 *
 * ## 与 open-design 的差异
 *
 * open-design 支持 16 种控件（color / range / date / file...）。这里只做
 * radio / checkbox / select / text / textarea 五种 —— 本项目「做视频」的场景
 * 只需要选方向、填描述，多出来的控件类型是没人用的复杂度。
 * 解析器**容忍**未知 type（降级成 text），不报错。
 */

/** 单个问题。 */
export interface FormQuestion {
  id: string
  label: string
  type: 'radio' | 'checkbox' | 'select' | 'text' | 'textarea'
  options?: string[]
  placeholder?: string
  required?: boolean
}

/** 一整张表单。 */
export interface QuestionForm {
  id: string
  title: string
  questions: FormQuestion[]
  submitLabel?: string
}

/** 解析结果：正文被切成「散文」与「表单」交替的段。 */
export type FormSegment =
  | { kind: 'text'; text: string }
  | { kind: 'form'; form: QuestionForm; raw: string }

/* 规范标签是 question-form；ask-question 是模型偶尔漂移过去的别名，
   一并接受，免得原始标记漏进正文。 */
const TAG_RE = /<(question-form|ask-question)\b([^>]*)>([\s\S]*?)<\/\1>/gi
const ATTR_ID_RE = /\bid\s*=\s*"([^"]*)"/
const ATTR_TITLE_RE = /\btitle\s*=\s*"([^"]*)"/

const VALID_TYPES = new Set(['radio', 'checkbox', 'select', 'text', 'textarea'])

/** 把选项统一成字符串数组：既接受 `["a"]` 也接受 `[{label:"a"}]`。 */
function normalizeOptions(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined
  const out: string[] = []
  for (const o of v) {
    if (typeof o === 'string' && o.trim()) { out.push(o); continue }
    if (o && typeof o === 'object') {
      const label = (o as Record<string, unknown>).label
      if (typeof label === 'string' && label.trim()) out.push(label)
    }
  }
  return out.length > 0 ? out : undefined
}

/** 解析表单体（JSON）。解析失败返回 null，由调用方把原文当普通文本。 */
function parseFormBody(body: string, attrs: string): QuestionForm | null {
  let data: unknown
  try {
    data = JSON.parse(body.trim())
  } catch {
    return null
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null
  const obj = data as Record<string, unknown>
  if (!Array.isArray(obj.questions)) return null

  const questions: FormQuestion[] = []
  for (const raw of obj.questions) {
    if (!raw || typeof raw !== 'object') continue
    const q = raw as Record<string, unknown>
    const label = typeof q.label === 'string' ? q.label.trim() : ''
    if (!label) continue
    const id = typeof q.id === 'string' && q.id.trim() ? q.id.trim() : `q${questions.length}`
    const typeRaw = typeof q.type === 'string' ? q.type : 'text'
    /* 未知 type 降级为 text —— 报错会让整张表消失，降级至少还能用。 */
    const type = (VALID_TYPES.has(typeRaw) ? typeRaw : 'text') as FormQuestion['type']
    questions.push({
      id,
      label,
      type,
      ...(normalizeOptions(q.options) ? { options: normalizeOptions(q.options) } : {}),
      ...(typeof q.placeholder === 'string' ? { placeholder: q.placeholder } : {}),
      ...(q.required === true ? { required: true } : {}),
    })
  }
  if (questions.length === 0) return null

  const idAttr = ATTR_ID_RE.exec(attrs)?.[1]
  const titleAttr = ATTR_TITLE_RE.exec(attrs)?.[1]
  return {
    id: idAttr || (typeof obj.id === 'string' ? obj.id : 'form'),
    title: titleAttr || (typeof obj.title === 'string' ? obj.title : '请确认'),
    questions,
    ...(typeof obj.submitLabel === 'string' ? { submitLabel: obj.submitLabel } : {}),
  }
}

/**
 * 把一段正文切成「散文 + 表单」的段序列。
 *
 * 没有表单时返回单个 text 段 —— 调用方可以据此走原来的纯文本渲染路径，
 * 不为「可能有表单」付额外开销。
 */
export function splitQuestionForms(text: string): FormSegment[] {
  const segments: FormSegment[] = []
  let last = 0
  TAG_RE.lastIndex = 0
  for (let m = TAG_RE.exec(text); m !== null; m = TAG_RE.exec(text)) {
    const [raw, , attrs, body] = m
    const form = parseFormBody(body, attrs)
    /* 解析失败：把原始标记留在正文里当普通文本，不吞掉内容 ——
       用户至少能看到模型想说什么，而不是一片空白。 */
    if (form === null) continue
    if (m.index > last) segments.push({ kind: 'text', text: text.slice(last, m.index) })
    segments.push({ kind: 'form', form, raw })
    last = m.index + raw.length
  }
  if (last < text.length) segments.push({ kind: 'text', text: text.slice(last) })
  return segments
}

/** 答案消息的机器头。open-design 用同一条约定，模型复述时能认回来。 */
export const FORM_ANSWERS_PREFIX = '[form answers'

/**
 * 把答案格式化成一条普通用户消息。
 *
 * 走普通消息而不是工具应答，是这套方案能绕开 dsh 通道限制的关键。
 *
 * @param form    表单
 * @param answers 每个问题 id → 选中的值（多选为数组）
 */
export function formatFormAnswers(form: QuestionForm, answers: Record<string, string | string[]>): string {
  const lines: string[] = [`${FORM_ANSWERS_PREFIX} — ${form.id}]`]
  for (const q of form.questions) {
    const v = answers[q.id]
    const display = Array.isArray(v)
      ? (v.length > 0 ? v.join(', ') : '(跳过)')
      : (typeof v === 'string' && v.trim() ? v.trim() : '(跳过)')
    lines.push(`- ${q.label}: ${display}`)
  }
  return lines.join('\n')
}

/** 这条用户消息是不是一份表单答案（用于历史回看时还原）。 */
export function isFormAnswersMessage(text: string): boolean {
  return text.trim().toLowerCase().startsWith(FORM_ANSWERS_PREFIX)
}
