/**
 * 「这次发送是不是上一轮的重试」—— 决定能否复用幂等键与创作 requestId。
 *
 * <p>核心原则：<strong>身份必须由**真正发出去的请求**算出，不能另写一份「等价标识」。</strong>
 * 早期版本手写了「文字 + fileId + 目标部分字段」之类的近似值，
 * 结果漏掉素材引用、目标图片等真实字段 —— 文字不变、只换参考素材时，
 * 仍会被认成旧请求。</p>
 *
 * <p>现在分两层：</p>
 * <ul>
 *   <li>{@link messageFingerprint}：消息接口的请求身份（text/references/attachments/constraints）；</li>
 *   <li>{@link creationFingerprint}：创作接口的请求身份（intent/references/图片/基准版本/修正文本）。</li>
 * </ul>
 * <p>两者都在「请求组装完成之后」调用，入参就是即将发送的那份对象。</p>
 *
 * <p><strong>与后端保持一致的规范化规则</strong>：后端
 * （`ChatMessageService.fingerprint`）把 references/attachments **按数组原样序列化**
 * 后做摘要 —— 顺序变化会改变摘要。所以前端**不做排序**：
 * 若前端认为「顺序无关」而复用旧键，后端仍会报幂等冲突。
 * 两侧必须用同一套（这里是「保序」）规则。</p>
 */

/** 稳定序列化：对象键排序（键序无语义），但**数组保序**（与后端一致）。 */
export function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return 'null'
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

/**
 * 消息接口的请求身份。
 *
 * <p>入参就是即将 POST 到 `/messages` 的那几个字段。
 * 不含 idempotencyKey 本身（那正是被它保护的东西）。</p>
 */
export function messageFingerprint(input: {
  sessionId: string
  text: string
  references?: unknown
  attachments?: unknown
  constraints?: unknown
}): string {
  return stableStringify({
    sessionId: input.sessionId,
    text: input.text,
    references: input.references ?? null,
    attachments: input.attachments ?? null,
    constraints: input.constraints ?? null,
  })
}

/**
 * 创作接口的请求身份。
 *
 * <p>入参是即将 POST 到 `/workflow/create` 的那几个字段。</p>
 */
/**
 * 内容摘要：对完整字符串做 FNV-1a 64 位（十六进制）。
 *
 * <p>为什么不直接塞原文：图片 data URL 动辄几十万字符，塞进 localStorage 的
 * promptKey 会把存储撑爆。也不能只取长度 + 首尾片段 —— 两张只在中间不同的图
 * 会撞成同一个身份（复审指出）。这里对**完整内容**算摘要，既省空间又不漏。</p>
 */
export function contentDigest(input: string): string {
  let h1 = 0x811c9dc5
  let h2 = 0x01000193
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i)
    h1 ^= c
    h1 = Math.imul(h1, 0x01000193) >>> 0
    h2 = (Math.imul(h2 ^ c, 0x85ebca6b) >>> 0)
  }
  /* 两路混合，降低短字符串碰撞概率；再带上长度做最后一道区分 */
  return `${input.length.toString(36)}-${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`
}

export function creationFingerprint(input: {
  projectId: string
  intent: string
  references?: unknown
  previewImage?: string | null
  baseVersion?: number | null
  correction?: string | null
}): string {
  /* 图片可能是很长的 data URL：对**完整内容**算摘要，
     既不撑爆存储，也不会像「长度+首尾片段」那样让中间不同的两张图撞在一起。 */
  const img = input.previewImage ?? null
  const imgTag = img ? contentDigest(img) : null
  return stableStringify({
    projectId: input.projectId,
    intent: input.intent,
    references: input.references ?? null,
    previewImage: imgTag,
    baseVersion: input.baseVersion ?? null,
    correction: input.correction ?? null,
  })
}

/**
 * 这份身份是否与上一轮 pendingSubmission 属于**同一个请求**。
 *
 * <p>只有「消息身份」一致才认作重试。创作身份另存一份用于核对，
 * 但**不参与**「是否重试」的判定 —— 创作请求的重试必须建立在
 * 「同一条用户消息」之上，否则会出现「新消息 + 旧任务」的错配。</p>
 *
 * <p>旧草稿（没有 `promptKey` 或格式不同）**一律不认作重试**：
 * 宁可多保存一条消息、也不要把用户的旧任务认成新请求的结果。
 * 这条兼容策略是刻意保守的 —— 无法确认身份时不猜。</p>
 */
export function isSameRequest(
  currentMessageFingerprint: string,
  pending: {
    promptKey?: string
    /** 旧格式用「会话:项目:文字」拼接，不是指纹 */
    text?: string
    requestId?: string | null
    messageFingerprint?: string
  } | null | undefined,
): boolean {
  if (!pending || !pending.requestId) return false
  const recorded = pending.messageFingerprint
    ?? (pending.promptKey && pending.promptKey.startsWith('{') ? pending.promptKey : undefined)
  /* 只认能确定身份的记录。旧格式（会话:项目:文字）不足以确认目标和附件，
     不能当作「完整匹配」。 */
  if (!recorded) return false
  return recorded === currentMessageFingerprint
}
