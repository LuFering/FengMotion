/**
 * 对话加载态。
 *
 * 第 13 项。三处场景用同一套骨架：
 *   · 消息区正在读历史（不是空对话）
 *   · AI 正在思考但还没有正文（此时用 ThinkingOrb，见 ChatThread）
 *   · 会话列表正在加载
 *
 * ⚠️ 骨架而不是转圈：转圈只说明「在等」，骨架还能说明「等来的东西长什么样」，
 * 后者能让布局不跳。形状按真实消息的排布来 —— 宽度错落、右侧留一个用户气泡位。
 */

import './chat-skeleton.css'

export function ChatSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="cs" role="status" aria-label="正在加载对话">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="cs-item" data-role={i % 2 === 0 ? 'user' : 'ai'}>
          {i % 2 === 1 ? <span className="cs-avatar" aria-hidden /> : null}
          <div className="cs-lines">
            <span className="cs-line" style={{ width: i % 2 === 0 ? '42%' : '72%' }} />
            <span className="cs-line" style={{ width: i % 2 === 0 ? '0' : '58%' }} />
          </div>
        </div>
      ))}
    </div>
  )
}

/** 会话列表骨架：行高与真实行一致（32px），加载完不会跳 */
export function SessionListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="cs-list" role="status" aria-label="正在加载会话">
      {Array.from({ length: rows }, (_, i) => (
        <span key={i} className="cs-list-row" style={{ width: `${88 - i * 9}%` }} />
      ))}
    </div>
  )
}

export default ChatSkeleton
