/**
 * 对话区组件。
 *
 * 每个组件都独立、只依赖项目 token，对话界面与工作台左栏共用同一套 ——
 * 同一个语义在两处长成两个样，用户会以为是两种不同的东西。
 */

export { ChatMessage, MessageActions } from './ChatMessage'

export {
  ReasoningBlock,
  ToolCalls,
  ToolCallRow,
  RunningRow,
  AnswerBody,
  AnswerActions,
  ToolResultPanel,
  RunningDivider,
  TurnTrigger,
} from './AiTurn'
export type { ToolCallItem } from './AiTurn'
export type { ChatMessageProps } from './ChatMessage'

export { ChatComposer } from './ChatComposer'
export type { ChatComposerProps } from './ChatComposer'

export { MarkdownText } from './MarkdownText'

export { TaskList, useRevealTicker } from './TaskList'
export type { TaskListProps, TaskItem, TaskStep, TaskStepChip } from './TaskList'

export { ThinkingIndicator } from './ThinkingIndicator'
export type { ThinkingPhase } from './ThinkingIndicator'

export { SessionRow } from './SessionRow'
export type { SessionRowProps } from './SessionRow'

export { ChatSkeleton, SessionListSkeleton } from './ChatSkeleton'

export { SOFT_EASE } from './chat-motion'
