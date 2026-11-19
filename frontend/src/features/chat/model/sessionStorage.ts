import type { ChatMessage } from '@/features/chat/hooks/useChat'

let seq = 0

export const makeId = () => `s-${Date.now().toString(36)}-${seq++}`

/**
 * 记住用户最后打开的那条会话。
 *
 * <p>为什么需要：activeId 只存在内存里，刷新后必然是 null —— 于是左栏没有
 * 任何会话被选中，输入框空白，草稿虽然还在 localStorage 里却无处显示。
 * 用户看到的是「我的草稿丢了」。记住 id 才能在启动时把它接回来。</p>
 */
export const ACTIVE_SESSION_KEY = 'fengmotion:active-session:v1'

export function readLastActiveId(): string | null {
  try {
    const value = localStorage.getItem(ACTIVE_SESSION_KEY)
    return value && value.trim() ? value : null
  } catch {
    return null
  }
}

export function writeLastActiveId(id: string | null) {
  try {
    if (id) localStorage.setItem(ACTIVE_SESSION_KEY, id)
    else localStorage.removeItem(ACTIVE_SESSION_KEY)
  } catch {
    /* 存储不可用只影响「下次自动接回」，不影响本次使用。 */
  }
}

export const now = () => Date.now()

/** 读取本地持久化的会话附加消息（如工作台完成的 AI 创作答复） */
export function loadSessionExtras(sessionId: string): ChatMessage[] {
  try {
    const raw = localStorage.getItem(`fm-session-extras:${sessionId}`)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/** 持久化保存一条会话附加消息，确保在服务端历史重新读取或刷新后不丢失 */
export function saveSessionExtra(sessionId: string, message: ChatMessage) {
  try {
    const list = loadSessionExtras(sessionId)
    if (!list.some((m) => m.id === message.id)) {
      list.push(message)
      localStorage.setItem(`fm-session-extras:${sessionId}`, JSON.stringify(list.slice(-500)))
    }
  } catch (err) {
    console.warn('[useSessions] 附加消息本地缓存暂不可用:', err)
  }
}
