import { useState } from 'react'

export interface ChatMessage {
  id: string
  role: 'user' | 'ai'
  text: string
  /** 服务端确认并保存的附件，用于回看消息时显示文件名。 */
  attachments?: { name: string; mimeType: string; sizeBytes: number; fileId?: string }[]
  taskId?: string
  projectId?: string
  /** 消息时间（工作台对话 tab 只渲染 text，本字段对它无影响） */
  at?: number
  /** 对话视图的演示附加块（工作台对话 tab 只渲染 text，本字段对它无影响） */
  thinking?: string
  toolCalls?: { label: string; detail: string }[]
  /**
   * 从服务端消息里读回的工具调用记录。
   *
   * 与上面的 `toolCalls`（演示适配器用的 `{label, detail}`）是两回事，不能合并：
   * 那个是演示数据里手写的摘要，这个是真实执行记录，带参数与成败。
   * 分开存是为了不破坏演示路径，同时让真实回复切走会话再回来仍能回看。
   */
  executedTools?: { callId?: string; name: string; arguments?: string; done?: boolean; isError?: boolean }[]
  plan?: string[]
  /** “改了什么”表：只列真实创建的产物（项目 / 工作流），不编造文件改动 */
  changes?: { file: string; change: string }[]
  /** 演示适配器产出的回复：界面必须显示「未连接 Agent」，不得含糊成真实能力 */
  demo?: boolean
  /** 正在流式接收：文字还不完整，界面按「还没说完」呈现 */
  streaming?: boolean
  /** 流失败或中断的原因。有值 = 这条回复没有完成，界面不得当作成功 */
  failed?: string
}

let sequence = 0
const makeId = () => `msg-${Date.now().toString(36)}-${sequence++}`

const INITIAL_MESSAGES: ChatMessage[] = [
  {
    id: 'intro',
    role: 'ai',
    text: '说说你想做什么片子。',
  },
]

export function useChat() {
  const [messages, setMessages] = useState(INITIAL_MESSAGES)
  const [draft, setDraft] = useState('')
  /* 返回新消息 id：排队中的消息先占位，任务真正启动时再把 taskId 补上去。 */
  const addUserMessage = (text: string, taskId?: string, projectId?: string) => {
    const id = makeId()
    setMessages((items) => [...items, { id, role: 'user', text, taskId, projectId, at: Date.now() }])
    return id
  }
  const setMessageTaskId = (messageId: string, taskId: string) => {
    setMessages((items) => items.map((m) => (m.id === messageId ? { ...m, taskId } : m)))
  }
  /* 对话视图的演示 agent 回复（本地生成） */
  const addAiMessage = (m: { text: string; thinking?: string; toolCalls?: { label: string; detail: string }[]; plan?: string[]; changes?: { file: string; change: string }[] }) => {
    setMessages((items) => [...items, { id: makeId(), role: 'ai', at: Date.now(), ...m }])
  }

  /* 追加一条**服务端已确认**的消息（带服务端 id）。
     用服务端 id 而不是本地生成：重新装载历史时同一个 id 不会出现两份。
     已在列表里的直接跳过 —— 重复提交 / 历史与发送竞态下不该出现两条一样的消息。 */
  const appendMessage = (m: ChatMessage) => {
    setMessages((items) => (items.some((x) => x.id === m.id) ? items : [...items, m]))
  }

  /* ── 流式回复（对话区走 services/chatService 的 stream）──────────
     分成「占位 / 追加 / 收尾 / 失败」四步，是为了让界面能如实显示
     「正在说」而不必等整段落地，并且失败时能明确标出这条没完成 ——
     契约要求不得用半截文本冒充完成。
     `demo` 只给演示适配器产的回复：服务端真回复传 `{ demo: false }`，
     否则界面会给真实回复挂上「未连接 Agent」的假标签。 */
  const startAiMessage = (options: { demo?: boolean } = {}) => {
    const id = makeId()
    const demo = options.demo ?? true
    setMessages((items) => [
      ...items,
      { id, role: 'ai', text: '', at: Date.now(), streaming: true, demo },
    ])
    return id
  }
  const appendAiText = (messageId: string, delta: string) => {
    if (!delta) return
    setMessages((items) => items.map((m) => (m.id === messageId ? { ...m, text: m.text + delta } : m)))
  }
  /* `completed` 给的是最终完整文本，**以它为准**（覆盖已拼接的），见契约 §4 */
  const finishAiMessage = (
    messageId: string,
    text: string,
    executedTools?: { callId?: string; name: string; arguments?: string; done?: boolean; isError?: boolean }[],
  ) => {
    setMessages((items) => items.map((m) => (
      m.id === messageId
        ? {
            ...m, text, streaming: false, failed: undefined,
            /* 把本轮收集到的工具记录挂到消息上：completed 之后会异步重读服务端消息，
               在那之前实时列表已经随 pending 消失 —— 不挂上的话，这一瞬间列表会闪空。 */
            ...(executedTools && executedTools.length > 0 ? { executedTools } : {}),
          }
        : m
    )))
  }
  const failAiMessage = (messageId: string, note: string) => {
    setMessages((items) => items.map((m) => (
      m.id === messageId ? { ...m, streaming: false, failed: note } : m
    )))
  }
  /* 丢弃一条还没说完的消息：流被中断（切会话 / 卸载 / 重挂载）时用。
     不丢的话，重挂载会另起一条，用户就会看到两条半截回复。 */
  const removeMessage = (messageId: string) => {
    setMessages((items) => items.filter((m) => m.id !== messageId))
  }
  /* 切换会话时整体换掉消息列表（会话树 → 当前对话） */
  const replaceMessages = (next: ChatMessage[]) => setMessages(next)
  /* 开新会话：回到初始状态（不动任何持久化数据） */
  const clearChat = () => {
    setMessages(INITIAL_MESSAGES)
    setDraft('')
  }
  return {
    messages, draft, setDraft, addUserMessage, setMessageTaskId, addAiMessage, appendMessage, clearChat,
    replaceMessages, startAiMessage, appendAiText, finishAiMessage, failAiMessage, removeMessage,
  }
}

export type ChatState = ReturnType<typeof useChat>
