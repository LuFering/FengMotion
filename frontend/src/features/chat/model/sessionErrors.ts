import { ApiError, userMessageForError } from '@/api/errors'

/** 创建失败的展示文案：错误对象的人话优先，空则给稳定兜底。 */
export function createErrorMessage(cause: unknown): string {
  if (cause instanceof ApiError) {
    if (cause.code === 'network_error') return '无法连接本地服务，会话没有创建。请确认后端已启动。'
    if (cause.code === 'aborted') return '请求已取消，会话没有创建。'
    // not_found 既可能是项目被删，也可能是这个端点还没实现（现骨架就是这样）。
    // 区分不了就不硬说「项目不存在」——两种可能都说，文案尽量短，左栏不占三行。
    if (cause.code === 'not_found') {
      return '会话接口尚未接入，或项目不存在，没有创建。'
    }
    // 统一走 userMessageForError：服务端没给 message 时也不会显示空内容，
    // 且 internal_error 之类不透传技术细节。
    return userMessageForError(cause, '会话没有创建。')
  }
  return cause instanceof Error ? cause.message : '会话没有创建。'
}

/** 列表读取失败的展示文案：读失败就说读失败，不能显示成「没有会话」。 */
export function listErrorMessage(cause: unknown): string {
  if (cause instanceof ApiError) {
    if (cause.code === 'network_error') return '无法连接本地服务，会话列表没有读到。请确认后端已启动。'
    // 与创建同理：404 分不清「项目被删」还是「会话端点没实现」，两种可能都说。
    if (cause.code === 'not_found') return '会话接口尚未接入，或项目不存在，列表没有读到。'
    return userMessageForError(cause, '会话列表没有读到。')
  }
  return cause instanceof Error ? cause.message : '会话列表没有读到。'
}

/** 详情读取失败的展示文案。不复用通用错误文案：503 在契约里兜底成
    「Agent 服务未连接，任务没有创建」，而这里只是读会话详情，说成任务没创建会误导。 */
export function detailErrorMessage(cause: unknown): string {
  if (cause instanceof ApiError) {
    if (cause.code === 'network_error') return '无法连接本地服务，会话详情没有读到。请确认后端已启动。'
    if (cause.code === 'not_found') return '服务端没有找到这条会话，可能已被删除。'
    if (cause.code === 'validation_error' && cause.message.trim()) return cause.message
    const id = cause.requestId ? `（请求 ID：${cause.requestId}）` : ''
    return `服务端没有返回会话详情${id}，可稍后重试。`
  }
  return cause instanceof Error ? cause.message : '无法读取会话详情。'
}

/** 消息历史读取失败的展示文案。单独一套：这里失败不等于会话不存在，
    更不能显示成「这条对话是空的」—— 空会话与没读到是两件事。 */
export function messagesErrorMessage(cause: unknown): string {
  if (cause instanceof ApiError) {
    if (cause.code === 'network_error') return '无法连接本地服务，历史消息没有读到。请确认后端已启动。'
    if (cause.code === 'not_found') return '服务端没有找到这条会话，可能已被删除。'
    if (cause.code === 'validation_error' && cause.message.trim()) return cause.message
    return userMessageForError(cause, '历史消息没有读到。')
  }
  return cause instanceof Error ? cause.message : '历史消息没有读到。'
}

/** 删除失败的展示文案。不复用发送文案：删除不涉及消息内容，
    说成「消息没发出去」会让人以为输入的东西丢了。 */
export function removeErrorMessage(cause: unknown): string {
  if (cause instanceof ApiError) {
    if (cause.code === 'network_error') return '无法连接本地服务，会话没有删除。请确认后端已启动。'
    if (cause.code === 'validation_error' && cause.message.trim()) return cause.message
    if (cause.code === 'internal_error' && cause.requestId) {
      return `服务端出现未预期错误，会话没有删除（请求 ID：${cause.requestId}）。`
    }
    return '服务端没有确认删除，会话仍保留在列表里。'
  }
  return cause instanceof Error ? cause.message : '会话没有删除。'
}

/** 给一句已经自带句号的错误接续说明，避免「。。」。 */
export function withPeriod(text: string): string {
  return /[。！？.!?]$/.test(text.trim()) ? text.trim() : `${text.trim()}。`
}
