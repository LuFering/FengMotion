import type {
  AgentReference,
  ApiErrorDetail,
  ChatMessage,
  ChatMessageCreateRequest,
  ChatSession,
  ChatStreamMessage,
  Id,
  IsoDateTime,
  Page,
  TaskAttachment,
} from '@/types/contracts'

/**
 * 对话服务 —— 契约接口 + 演示适配器。
 *
 * 为什么要有这一层：`docs/dev/前后端协议.md` 第 1 条规定「唯一数据入口」——
 * 视图只经 `src/services/` 取数与执行动作，禁止视图内自己造数据。对话此前是在
 * `Conversation` 视图里用 `demoReply` 本地编回复，正是被禁的那种写法：
 * 接不上后端，也无法保证「不假装已发送」。这里按 `docs/contracts/agent.md`
 * 把契约落成接口 + 演示适配器，换真实后端时只替换适配器，视图不动。
 *
 * 演示边界（必须如实标注，不许含糊成「AI 已经理解」）：
 *   · 回复是按字面规则拼出来的，**不是模型理解、也不是模型生成**；
 *   · 会话与消息只存内存，刷新即回到种子状态（持久化还没做，不假装做了）；
 *   · 不写文件、不建任务、不生成产物。
 *
 * 与契约的已知差距（如实记录，别在别处含糊过去）：
 *   · 契约的会话 CRUD（`/chat-sessions`）已实现接口，但左栏「项目 + 对话」树
 *     目前仍归 `shell/useSessions` 管；消息以视图传入的 sessionId 为键存在本适配器里；
 *   · `references` / `attachments` 只按契约形状透传与回显，不做检索或上传；
 *   · 没有 SSE 重连（`Last-Event-ID`）——适配器在进程内，没有断线一说。
 */

/* ── 错误：与 contracts/README.md §2.4 同一形状 ─────────────── */

export class ChatApiError extends Error {
  readonly detail: ApiErrorDetail
  constructor(detail: ApiErrorDetail) {
    super(detail.message)
    this.name = 'ChatApiError'
    this.detail = detail
  }
}

/* ── 服务接口（一个域一组方法，形状对齐契约端点）─────────────── */

export interface ChatApi {
  listSessions(projectId: Id, cursor?: string): Promise<Page<ChatSession>>
  createSession(input: { projectId: Id; title?: string }): Promise<ChatSession>
  getSession(sessionId: Id): Promise<ChatSession | null>
  deleteSession(sessionId: Id): Promise<void>
  listMessages(sessionId: Id, cursor?: string, limit?: number): Promise<Page<ChatMessage>>
  /** 发消息。只是聊天时 taskId 不出现；本适配器永远不建任务。 */
  sendMessage(sessionId: Id, request: ChatMessageCreateRequest): Promise<{ message: ChatMessage; taskId?: Id }>
  /** 订阅回复流。返回退订函数：退订 = 断线，**不得当作完成**。 */
  stream(sessionId: Id, onMessage: (message: ChatStreamMessage) => void): () => void
}

/* ── 需求读文：只认原文里真的出现过的字 ──────────────────────
   这里刻意不做「理解」。演示适配器若假装懂了风格、受众、画面，
   用户就没法判断哪些是真读到的、哪些是编的。所以每一项都带
   `quote`（原样截取用户的话），界面上可以逐条核对。
   副作用是：读不到就老老实实问 —— 「只在必要时提问」由此落地。 */

export interface DetectedFact {
  /** 给用户看的一句话，例：`时长 15 秒` */
  label: string
  /** 出自原文的哪一段（原样引用） */
  quote: string
}

export interface RequirementReading {
  found: DetectedFact[]
  /** 原文里确实没提到的项 —— 只问这些，已经说过的绝不重复问 */
  missing: string[]
}

/** 时长：数字 + 秒/分钟，以及「半分钟」「一分半」这类中文写法 */
const RE_DURATION = /(\d+(?:\.\d+)?)\s*(秒|s\b|分钟|min\b)|半分钟|一分半|半分钟|两分钟|三分钟/i
/** 画幅：比例写法与横竖说法 */
const RE_ASPECT = /(16\s*:\s*9|9\s*:\s*16|1\s*:\s*1|4\s*:\s*3|竖屏|横屏|方形|方图)/
/** 受众：给谁看 / 讲给谁 / 面向谁 */
const RE_AUDIENCE = /(?:讲给|给|面向|针对|发给)([^，。；、,.;\n]{1,20}?)(?:看|听|用|讲)/
/** 风格感觉：只认这些常见词，认不出就当没提到（宁可问，不要替用户决定） */
const RE_STYLE = /(温暖|温柔|科技感|未来感|清新|复古|高级|活泼|沉稳|治愈|炫酷|电影感|纪实|明快|冷峻|热烈|安静|燃|柔软)/
/** 「必须出现」类硬要求：按标点切句，保留含这些标记的那句 */
const RE_REQUIRED = /(必须出现|要出现|必须要有|要有|出现|写上|加上|不能出现|不要出现)/

const MISSING_DURATION = '这条片子多长（例：15 秒）'
const MISSING_ASPECT = '什么画幅（横屏 16:9 / 竖屏 9:16）'
const MISSING_AUDIENCE = '这条片子讲给谁看'
const MISSING_STYLE = '整体想要什么感觉'

/** 把用户原文按句切开（保留原文片段，用于逐条引用） */
function clauses(text: string): string[] {
  return text
    .split(/[，。；！？\n,;!?]/)
    .map((s) => s.trim())
    .filter(Boolean)
}

export function readRequirement(text: string): RequirementReading {
  const found: DetectedFact[] = []
  const push = (label: string, quote: string) => found.push({ label, quote })

  const duration = text.match(RE_DURATION)
  if (duration) push(`时长 ${duration[0].trim()}`, duration[0].trim())

  const aspect = text.match(RE_ASPECT)
  if (aspect) push(`画幅 ${aspect[0].replace(/\s+/g, '')}`, aspect[0].trim())

  const audience = text.match(RE_AUDIENCE)
  if (audience) push(`受众「${audience[1]}」`, audience[0].trim())

  /* 风格可能有多个词，全部列出；去重后最多三条，避免回复变成词表 */
  const styles = [...new Set(text.match(new RegExp(RE_STYLE, 'g')) ?? [])].slice(0, 3)
  styles.forEach((s) => push(`感觉「${s}」`, s))

  /* 硬要求：取含标记的原句，最多两句 */
  clauses(text)
    .filter((c) => RE_REQUIRED.test(c))
    .slice(0, 2)
    .forEach((c) => push(`必须做到：${c.length > 18 ? `${c.slice(0, 18)}…` : c}`, c))

  const missing: string[] = []
  if (!duration) missing.push(MISSING_DURATION)
  if (!aspect) missing.push(MISSING_ASPECT)
  if (!audience) missing.push(MISSING_AUDIENCE)
  if (styles.length === 0) missing.push(MISSING_STYLE)

  return { found, missing }
}

/* ── 演示回复正文 ────────────────────────────────────────────
   规则：只说两类内容 —— (1) 原文里确实出现的字；(2) 原文里确实没出现的项。
   绝不下结论说「我理解了你的风格」或「已经优化」。 */

function bullets(items: string[]): string {
  return items.map((s) => `· ${s}`).join('\n')
}

/** 首轮：列出读到的，只问缺的 */
export function draftFirstReply(text: string): string {
  const { found, missing } = readRequirement(text)

  const lines: string[] = []
  if (found.length > 0) {
    lines.push('我从你的原话里读到的（逐条附原文，可核对）：')
    lines.push(bullets(found.map((f) => `${f.label} —— 出自「${f.quote}」`)))
  } else {
    lines.push('你的原话里没有出现时长、画幅、受众或感觉这类的字，我不替你猜。')
  }

  if (missing.length > 0) {
    lines.push(`还缺 ${missing.length} 件，回一句就行（不想答也可以直接说「按常规来」）：`)
    lines.push(bullets(missing))
  } else {
    lines.push('该有的字你都已经写了，我不再重复问。')
  }

  lines.push('你的原话我原样留着，后面补充的要求会追加在后面，不会拿摘要替掉它。')
  return lines.join('\n')
}

/** 后续轮：把这次说的追加记下；若补齐了之前缺的项，明说补齐了 */
export function draftFollowUpReply(text: string, answered: string[]): string {
  const { found } = readRequirement(text)
  const quote = text.trim().replace(/\s+/g, ' ').slice(0, 40)

  const lines: string[] = [`「${quote}${text.trim().length > 40 ? '…' : ''}」追加记下了。`]

  if (answered.length > 0) {
    lines.push('这一条把之前缺的补上了：')
    lines.push(bullets(answered))
  }
  if (found.length > 0) {
    lines.push('这次读到的字：')
    lines.push(bullets(found.map((f) => f.label)))
  }

  lines.push('演示模式没有修改任何东西，也没有生成画面或方案。')
  return lines.join('\n')
}

/* ── 需求确认卡：对话区「确认 / 纠正」这一屏的数据 ──────────────
   为什么放在服务层而不是视图里：视图只负责渲染，数据一律经 services/ 取
   （前后端协议第 1 条）。真后端接入后，这张卡改由服务端投影提供，视图不动。 */

export interface RequirementCard {
  /** 第一条用户原话，**原样**：它是后续纠正的基准，不能被摘要替掉 */
  firstPrompt: string
  /** 后续纠正：每条原样列出，不改写、不合并 */
  corrections: string[]
  /** 已经从原话里读到的（每项带原文引用，可核对） */
  decided: DetectedFact[]
  /** 原话里确实没提到的 */
  missing: string[]
}

/**
 * 画面构想只能由模型产出。演示适配器不产出拍摄方案，也**不拿模板冒充** ——
 * 卡片上如实标出这一块要等模型，而不是编一段看起来像分镜的文字。
 */
export const NEEDS_MODEL_NOTE =
  '画面构想（主角是什么、会发生什么变化、观众先看哪里、开头／中间／结尾怎么连）需要模型产出，当前未接入。'

/** 确认需求用的固定文案：卡片靠它在对话里认出「已经确认过」 */
export const CONFIRM_REQUIREMENT_TEXT = '确认：以上需求没问题'

export function requirementCard(userTexts: string[]): RequirementCard {
  const firstPrompt = userTexts[0] ?? ''
  const corrections = userTexts.slice(1)
  /* 读文覆盖「原文 + 后续纠正」：最新纠正会改变结论，
     但原文本身仍原样呈现在卡片上，不因为它被纠正过就消失。 */
  const reading = readRequirement(userTexts.join('\n'))
  return { firstPrompt, corrections, decided: reading.found, missing: reading.missing }
}

export function isRequirementConfirmed(userTexts: string[]): boolean {
  return userTexts.some((t) => t.trim() === CONFIRM_REQUIREMENT_TEXT)
}

/* ── 演示适配器 ─────────────────────────────────────────────── */

/** 流式节奏：约 24ms 吐一小段，回复长度约 200 字 → 1 秒左右吐完 */
const DELTA_MS = 24
const DELTA_SIZE = 4

export class DemoChatApi implements ChatApi {
  private sessions = new Map<Id, ChatSession>()
  private messages = new Map<Id, ChatMessage[]>()
  /** 正在吐字的用户消息 id：防止同一个提问被两个流各回一条（挂载两遍就常见） */
  private inflight = new Set<Id>()
  private seq = 0

  private nextId(prefix: string): Id {
    this.seq += 1
    return `${prefix}-${Date.now().toString(36)}-${this.seq}`
  }

  private now(): IsoDateTime {
    return new Date().toISOString()
  }

  private list(sessionId: Id): ChatMessage[] {
    let list = this.messages.get(sessionId)
    if (!list) {
      list = []
      this.messages.set(sessionId, list)
    }
    return list
  }

  private touch(sessionId: Id, title?: string): void {
    const session = this.sessions.get(sessionId)
    if (!session) return
    session.updatedAt = this.now()
    session.messageCount = this.list(sessionId).length
    if (title && !session.title) session.title = title.slice(0, 40)
  }

  /**
   * 把「已经在界面上聊过的历史」交给适配器。
   *
   * 只有演示适配器需要这个：真后端的会话历史本来就在服务端。
   * 不灌的话，装载一条老会话后再说话，适配器以为这是第一轮 ——
   * 就会把用户早就答过的信息再问一遍，正好违反「只在必要时提问」。
   */
  hydrate(sessionId: Id, messages: Array<{ role: 'user' | 'assistant'; text: string }>): void {
    const list = this.list(sessionId)
    list.length = 0
    messages.forEach((m) => {
      list.push({
        id: this.nextId('m'),
        sessionId,
        role: m.role,
        /* 历史原样搬入，不做摘要 */
        text: m.text,
        createdAt: this.now(),
        demo: true,
      })
    })
  }

  /* ── 会话 ── */

  async createSession(input: { projectId: Id; title?: string }): Promise<ChatSession> {
    const session: ChatSession = {
      id: this.nextId('c'),
      projectId: input.projectId,
      title: input.title?.slice(0, 40) ?? '',
      createdAt: this.now(),
      updatedAt: this.now(),
      messageCount: 0,
      demo: true,
    }
    this.sessions.set(session.id, session)
    return { ...session }
  }

  async listSessions(projectId: Id, cursor?: string): Promise<Page<ChatSession>> {
    /* 演示适配器的分页参数按契约接受但只发一页（没有真后端，不做假分页） */
    void cursor
    const items = [...this.sessions.values()]
      .filter((s) => s.projectId === projectId)
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
      .map((s) => ({ ...s }))
    return { items, nextCursor: null }
  }

  async getSession(sessionId: Id): Promise<ChatSession | null> {
    const s = this.sessions.get(sessionId)
    return s ? { ...s } : null
  }

  async deleteSession(sessionId: Id): Promise<void> {
    this.sessions.delete(sessionId)
    this.messages.delete(sessionId)
  }

  /* ── 消息 ── */

  async listMessages(sessionId: Id, cursor?: string, limit = 50): Promise<Page<ChatMessage>> {
    void cursor
    const items = this.list(sessionId).slice(0, limit).map((m) => ({ ...m }))
    return { items, nextCursor: null }
  }

  async sendMessage(
    sessionId: Id,
    request: ChatMessageCreateRequest,
  ): Promise<{ message: ChatMessage; taskId?: Id }> {
    const text = request.text.trim()
    const attachments: TaskAttachment[] = request.attachments ?? []
    const references: AgentReference[] = request.references ?? []
    /* 契约 agent.md §3：空文本 + 无附件 → validation_error；不静默收下 */
    if (text.length === 0 && attachments.length === 0) {
      throw new ChatApiError({
        code: 'validation_error',
        message: '消息内容为空：请写一句要求，或带上附件。',
        requestId: this.nextId('req'),
      })
    }

    const message: ChatMessage = {
      id: this.nextId('m'),
      sessionId,
      role: 'user',
      /* 原话原样存，不做摘要、不做截断 —— 需求原文是后续纠正的基准 */
      text: request.text,
      createdAt: this.now(),
      demo: true,
    }
    if (references.length > 0) message.references = references
    if (attachments.length > 0) message.attachments = attachments
    this.list(sessionId).push(message)
    this.touch(sessionId, text)
    return { message: { ...message } }
  }

  /* ── 回复流 ── */

  stream(sessionId: Id, onMessage: (message: ChatStreamMessage) => void): () => void {
    const list = this.list(sessionId)
    /* 找出「还没被回过的最后一条用户消息」 */
    let targetIndex = -1
    for (let i = list.length - 1; i >= 0; i -= 1) {
      if (list[i].role === 'user') { targetIndex = i; break }
    }
    if (targetIndex === -1) {
      queueMicrotask(() => onMessage({ type: 'end' }))
      return () => {}
    }
    const target = list[targetIndex]
    const alreadyAnswered = list.slice(targetIndex + 1).some((m) => m.role === 'assistant')
    if (alreadyAnswered || this.inflight.has(target.id)) {
      /* 已经有回复（或正在吐）：不再补一条，也不重放 —— 重放会让同一句话出现两遍 */
      queueMicrotask(() => onMessage({ type: 'end' }))
      return () => {}
    }
    this.inflight.add(target.id)

    const messageId = this.nextId('m')
    const userMessages = list.filter((m) => m.role === 'user')
    /* 「补上了哪些」用前后两次读文对比得出：之前缺、加上这句之后不缺 = 这句补上的。
       不猜用户意图，也不把「回了一句」一律说成「已经理解」。 */
    const priorText = userMessages.slice(0, -1).map((m) => m.text).join('\n')
    const missingBefore = readRequirement(priorText).missing
    const missingNow = readRequirement(`${priorText}\n${target.text}`).missing
    const answered = missingBefore.filter((item) => !missingNow.includes(item))
    const full = userMessages.length <= 1
      ? draftFirstReply(target.text)
      : draftFollowUpReply(target.text, answered)

    let cursor = 0
    let timer: number | undefined
    let closed = false

    const finish = () => {
      if (closed) return
      const message: ChatMessage = {
        id: messageId,
        sessionId,
        role: 'assistant',
        text: full,
        createdAt: this.now(),
        demo: true,
      }
      this.list(sessionId).push(message)
      this.touch(sessionId)
      this.inflight.delete(target.id)
      onMessage({ type: 'completed', message: { ...message } })
      onMessage({ type: 'end' })
    }

    const tick = () => {
      if (closed) return
      const next = full.slice(cursor, cursor + DELTA_SIZE)
      cursor += DELTA_SIZE
      if (next.length > 0) onMessage({ type: 'delta', messageId, delta: next })
      if (cursor >= full.length) { finish(); return }
      timer = window.setTimeout(tick, DELTA_MS)
    }
    timer = window.setTimeout(tick, DELTA_MS)

    return () => {
      /* 退订 = 断线：停掉吐字、撤销回复登记，**不发 completed**（半截文本不算完成） */
      closed = true
      if (timer !== undefined) window.clearTimeout(timer)
      this.inflight.delete(target.id)
    }
  }
}

export const chatApi: ChatApi = new DemoChatApi()

/**
 * 把界面上的既有历史交给演示适配器（真后端不需要，它本来就有历史）。
 * 视图装载一条老会话时调用，否则适配器会把已经聊过的内容当成第一轮。
 */
export function hydrateDemoChat(
  sessionId: Id,
  messages: Array<{ role: 'user' | 'assistant'; text: string }>,
): void {
  if (chatApi instanceof DemoChatApi) chatApi.hydrate(sessionId, messages)
}