import { Fragment, type ReactNode } from 'react'
import type { ChatMessageToolCall, ChatReasoningSegment } from '@/api/contracts'
import { splitAssistantTurn } from '@/features/chat/model/assistantTurn'

/**
 * 按发生顺序摆放一轮回复：思考 → 正文 → 工具 → 思考 → 正文 → 工具……
 *
 * 没给 `renderReasoning` 时不显示分段思考（例如工作台侧栏本来就不放思考）。
 */
export function AssistantTurnContent({ text, tools = [], reasoning = [], renderText, renderTools, renderReasoning, hideProcess = false }: {
  text: string
  /** 一轮结束后收起执行过程：只留交付正文（最后一段工具调用之后的正文）。正文块的 key 不变，正在逐字输出的段落不会被重建 */
  hideProcess?: boolean
  tools?: ChatMessageToolCall[]
  reasoning?: ChatReasoningSegment[]
  renderText: (text: string) => ReactNode
  renderTools: (tools: ChatMessageToolCall[]) => ReactNode
  /** `last`：这是整轮里最后一块，流式时它就是「正在思考」的那一段 */
  renderReasoning?: (text: string, last: boolean) => ReactNode
}) {
  const blocks = splitAssistantTurn(text, tools, reasoning)
  /* 收起执行过程时只留交付正文：最后一个「工具 / 思考」块之后的那几段。
     夹在调用之间的过程说明（「我先确认一下渲染链路…」）属于执行过程，一起收起；
     若一轮以工具调用结尾、后面没有正文，就退回显示最后一段正文，不让回复变成空白。 */
  const lastProcess = blocks.reduce((at, block, i) => (block.kind === 'text' ? at : i), -1)
  const lastText = blocks.reduce((at, block, i) => (block.kind === 'text' ? i : at), -1)
  const textShown = (index: number) => !hideProcess || index > lastProcess || (lastProcess > lastText && index === lastText)
  /* 同一正文位置上可能有好几组「工具 / 思考」交替出现，key 只用位置会重复 */
  return <>{blocks.map((block, index) => block.kind === 'text' && !textShown(index) ? null : (
    <Fragment key={`${block.kind}-${block.offset}-${index}`}>
      {block.kind === 'tools' ? (hideProcess ? null : renderTools(block.calls))
        : block.kind === 'reasoning' ? (hideProcess ? null : renderReasoning?.(block.text, index === blocks.length - 1) ?? null)
          : renderText(block.text)}
    </Fragment>
  ))}</>
}
