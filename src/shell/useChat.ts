import { useState } from 'react'

export interface ChatMessage {
  id: string
  role: 'user' | 'ai'
  text: string
  taskId?: string
}

let sequence = 0
const makeId = () => `msg-${Date.now().toString(36)}-${sequence++}`

const INITIAL_MESSAGES: ChatMessage[] = [
  {
    id: 'intro',
    role: 'ai',
    text: '预览播放的是项目里已有的 152 秒旧版成片。Agent 尚未连接；演示模式可以模拟请求状态，但不会改代码或生成新画面。',
  },
]

export function useChat() {
  const [messages, setMessages] = useState(INITIAL_MESSAGES)
  const [draft, setDraft] = useState('')
  const addUserMessage = (text: string, taskId?: string) => {
    setMessages((items) => [...items, { id: makeId(), role: 'user', text, taskId }])
  }
  return { messages, draft, setDraft, addUserMessage }
}

export type ChatState = ReturnType<typeof useChat>
