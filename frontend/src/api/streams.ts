/**
 * 任务事件流与对话回复流的状态机。
 *
 * 这两条流的难点不在「连上」，而在断开之后：
 * - 契约（README §2.9、task.md §7、02 §5）要求断线**不得**被当成完成，
 *   重连要带 `Last-Event-ID`，按 `(taskId, seq)` 去重，缺口补齐前显示「正在恢复」；
 * - 服务端只保证「同一任务事件 seq 严格递增」，所以客户端要能容忍乱序到达并按 seq 排水；
 * - 终态只认 `end` 帧或终态事件（complete/error/cancelled），一个任务最多一个终态。
 *
 * 这里不做乐观成功：任何「连接断了但没收到终态」的情形都如实停在 resyncing/failed，
 * 由界面说明「未完成」，而不是悄悄报成功。
 */
// 实现按流拆在 streams/ 下；这里只转发原先对外的名字，api/index 的 export * 不会多暴露内部函数。
export {
  TERMINAL_TASK_STATUSES,
  normalizeEventList,
  openTaskEventStream,
  type TaskEventStreamHandlers,
  type TaskEventStreamOptions,
  type TaskEventStreamHandle,
} from './streams/taskEvents'
export {
  openChatSessionStream,
  type ChatStreamHandlers,
  type ChatStreamOptions,
  type ChatStreamHandle,
} from './streams/chatStream'
