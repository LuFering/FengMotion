import { Fragment, type ReactNode } from 'react'
import type { ChatMessageToolCall, ChatReasoningSegment } from '@/types/contracts'
import { splitAssistantTurn } from '@/services/assistantTurn'

/**
 * 按发生顺序摆放一轮回复：思考 → 正文 → 工具 → 思考 → 正文 → 工具……
 *
 * 没给 `renderReasoning` 时不显示分段思考（例如工作台侧栏本来就不放思考）。
 */
export function AssistantTurnContent({ text, tools = [], reasoning = [], renderText, renderTools, renderReasoning }: {
  text: string
  tools?: ChatMessageToolCall[]
  reasoning?: ChatReasoningSegment[]
  renderText: (text: string) => ReactNode
  renderTools: (tools: ChatMessageToolCall[]) => ReactNode
  /** `last`：这是整轮里最后一块，流式时它就是「正在思考」的那一段 */
  renderReasoning?: (text: string, last: boolean) => ReactNode
}) {
  const blocks = splitAssistantTurn(text, tools, reasoning)
  /* 同一正文位置上可能有好几组「工具 / 思考」交替出现，key 只用位置会重复 */
  return <>{blocks.map((block, index) => (
    <Fragment key={`${block.kind}-${block.offset}-${index}`}>
      {block.kind === 'tools' ? renderTools(block.calls)
        : block.kind === 'reasoning' ? renderReasoning?.(block.text, index === blocks.length - 1) ?? null
          : renderText(block.text)}
    </Fragment>
  ))}</>
}
