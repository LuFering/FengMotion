import { useState } from 'react'
import { AssistantTurnContent } from '@/features/chat/components/AssistantTurnContent'
import { MarkdownText } from '@/features/chat/components/MarkdownText'
import { TypewriterText } from '@/features/chat/components/TypewriterText'
import { ProcessDrawer } from '@/features/chat/components/ProcessDrawer'
import { ProcessToggle } from '@/features/chat/components/conversation/ProcessToggle'
import { processSummary } from '@/features/chat/model/processSummary'
import type { ChatMessage } from '@/features/chat/hooks/useChat'

/**
 * 工作台右栏一条 AI 回复的正文与执行过程，与对话页同一套方案：
 * 正文逐字输出；执行步骤在抽屉里，执行中展开；一轮结束后整轮过程收成一行「已完成 · …」，点开回看。
 * 中途失败的轮次保持展开。右栏不放思考过程，所以收起行里只计工具调用。
 */
export function WorkbenchAiContent({ m }: { m: ChatMessage }) {
  const [manual, setManual] = useState<boolean | null>(null)
  const live = m.streaming === true
  const summary = processSummary(m)
  const process = summary && summary.tools > 0 ? { ...summary, thoughts: 0 } : null
  const open = manual ?? (live || Boolean(m.failed))
  return (
    <>
      {process && !live && <ProcessToggle summary={process} open={open} onToggle={() => setManual(!open)} />}
      <AssistantTurnContent
        text={m.text}
        tools={m.executedTools}
        hideProcess={process !== null && !open}
        renderText={(text) => (
          <TypewriterText text={text} live={live}>
            {(visible, settled) => <MarkdownText text={settled ? text : visible} streaming={!settled} />}
          </TypewriterText>
        )}
        renderTools={(tools) => <ProcessDrawer tools={tools} running={live} />}
      />
    </>
  )
}
