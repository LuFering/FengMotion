import { useState } from 'react'

export interface ChatMessage {
  id: string
  role: 'user' | 'ai'
  text: string
  taskId?: string
  /** 消息时间（对话视图轨迹 tab 用；工作台对话 tab 只渲染 text，本字段对它无影响） */
  at?: number
  /** 对话视图的演示附加块（工作台对话 tab 只渲染 text，本字段对它无影响） */
  thinking?: string
  toolCalls?: { label: string; detail: string }[]
  plan?: string[]
  /** “改了什么”表：只列真实创建的产物（项目 / 工作流），不编造文件改动 */
  changes?: { file: string; change: string }[]
}

let sequence = 0
const makeId = () => `msg-${Date.now().toString(36)}-${sequence++}`

const INITIAL_MESSAGES: ChatMessage[] = [
  {
    id: 'intro',
    role: 'ai',
    text: '预览来自项目当前可播放来源。Agent 尚未连接；演示模式可以模拟请求状态，但不会改代码或生成新画面。',
  },
]

export function useChat() {
  const [messages, setMessages] = useState(INITIAL_MESSAGES)
  const [draft, setDraft] = useState('')
  const addUserMessage = (text: string, taskId?: string) => {
    setMessages((items) => [...items, { id: makeId(), role: 'user', text, taskId, at: Date.now() }])
  }
  /* 对话视图的演示 agent 回复（原型：本地生成，未连接 Agent） */
  const addAiMessage = (m: { text: string; thinking?: string; toolCalls?: { label: string; detail: string }[]; plan?: string[]; changes?: { file: string; change: string }[] }) => {
    setMessages((items) => [...items, { id: makeId(), role: 'ai', at: Date.now(), ...m }])
  }
  /* 开新会话：回到初始状态（保留工作台对话 tab 的 intro 免责句，不动任何持久化数据） */
  const clearChat = () => {
    setMessages(INITIAL_MESSAGES)
    setDraft('')
  }
  return { messages, draft, setDraft, addUserMessage, addAiMessage, clearChat }
}

export type ChatState = ReturnType<typeof useChat>
