/**
 * 「项目出了新版本」的页面内广播。
 *
 * 对话里一轮改动了工程，后端会自动渲染（见契约 agent.md 的 render 帧）。
 * 发起对话的视图不一定是工作台：在对话页发的消息，工作台要是开着也该立刻刷新版本、播新片。
 */
const target = new EventTarget()
const EVENT = 'project-rendered'

export function notifyProjectRendered(projectId: string, version?: number): void {
  target.dispatchEvent(new CustomEvent(EVENT, { detail: { projectId, version } }))
}

/** 订阅；返回取消订阅的函数，供 useEffect 清理。 */
export function onProjectRendered(listener: (event: { projectId: string; version?: number }) => void): () => void {
  const handler = (event: Event) => listener((event as CustomEvent<{ projectId: string; version?: number }>).detail)
  target.addEventListener(EVENT, handler)
  return () => target.removeEventListener(EVENT, handler)
}
