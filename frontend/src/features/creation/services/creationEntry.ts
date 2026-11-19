/** Prepare a real project session without sending a message or starting an Agent. */
export async function prepareCreationEntry(input: {
  projectId: string | null
  title?: string
}, deps: {
  createProject: () => Promise<{ id: string }>
  createSession: (input: { projectId: string; firstText?: string }) => Promise<{ session: { id: string; projectId: string | null; origin?: string } | null; error: string | null }>
  onProjectReady?: (id: string) => void
}) {
  const projectId = input.projectId ?? (await deps.createProject()).id
  deps.onProjectReady?.(projectId)
  const { session, error } = await deps.createSession({ projectId, firstText: input.title })
  if (error || !session || session.origin !== 'server' || session.projectId !== projectId) {
    throw new Error(error || '项目会话尚未保存，请重试。输入内容仍保留。')
  }
  return { projectId, sessionId: session.id }
}

/** Write the initial brief only on explicit creation submission, never on discussion. */
export async function ensureCreationContext(projectId: string, text: string, api: {
  state: (id: string) => Promise<{ initialized: boolean }>
  init: (id: string, text: string) => Promise<unknown>
}) {
  if (!(await api.state(projectId)).initialized) await api.init(projectId, text)
}
