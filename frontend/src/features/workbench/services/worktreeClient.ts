import { studioHttpApi } from '@/api'

import type { SourceState as WorktreeState } from '@/api/sourceRender'
import type { SourceTargetContext } from '@/api/sourceRender'
export type { SourceState as WorktreeState } from '@/api/sourceRender'

export const readWorktreeState = (projectId: string) => studioHttpApi().http.get<WorktreeState>(
  `/projects/${encodeURIComponent(projectId)}/source/state`,
)

export const resolveSourceTarget = (projectId: string, src: string, fileHash: string) => studioHttpApi().http.post<SourceTargetContext>(
  `/projects/${encodeURIComponent(projectId)}/source/target`, { src, fileHash },
)
