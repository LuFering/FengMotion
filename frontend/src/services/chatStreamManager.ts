/**
 * 全局统一的会话回复流管理器与响应式状态中心。
 *
 * <p>本文件只做两件事：把后端的停止接口接进内核、把内核接到 React。
 * 真正的状态机与停止流程在 {@link ChatStreamCore} —— 拆出去是为了让
 * 「停止响应晚于新一轮启动」这类时序问题能被真实代码测试覆盖，
 * 而不是靠测试脚本里另写一份副本去模拟。</p>
 *
 * 契约要求：
 * 1. 同一会话在同一时刻只能有一个正在运行的回复流；
 * 2. 界面切换（如从工作台切到对话区，或从对话区切到工作台）不能打断后台在途流，
 *    新挂载的视图绝不重复向后端发起第二条流；
 * 3. 流状态（streaming / completed / error / stopped）对外提供全局可订阅的响应式通知，
 *    切页后新组件能实时感知当前是在流式回复还是已完成，绝不卡死在 pending 状态。
 */
import { useSyncExternalStore } from 'react'
import { studioHttpApi } from '@/services/api'
import { ChatStreamCore } from './chatStreamCore'

export type { ActiveStream, SessionStreamState, StreamPhase, StopTransport } from './chatStreamCore'
export type { StopOutcome } from './chatStreamCore'

export const chatStreamManager = new ChatStreamCore((sessionId) => studioHttpApi().chat.stop(sessionId))

/** React Hook: 响应式监听当前会话的回复流状态 */
export function useSessionStream(sessionId?: string | null) {
  const sid = sessionId ?? ''
  return useSyncExternalStore(
    (onStoreChange) => {
      if (!sid) return () => {}
      return chatStreamManager.subscribe(sid, () => onStoreChange())
    },
    () => chatStreamManager.getState(sid),
    () => chatStreamManager.getState(sid),
  )
}
