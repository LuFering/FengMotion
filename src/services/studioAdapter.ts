import type { ProjectVersion, TaskRequest } from '@/services/studioApi'
import { PROJECT } from '@/data/projectModel'

export interface ApiCapabilities {
  agentConnected: boolean
  remotionEditor: boolean
  previewVideo: boolean
  cloudRender: boolean
}

export interface StudioAdapter {
  mode: 'demo'
  capabilities: ApiCapabilities
  project: typeof PROJECT
  buildTaskRequest(input: Omit<TaskRequest, 'attachments'> & { attachments?: TaskRequest['attachments'] }): TaskRequest
  versions(): ProjectVersion[]
}

/**
 * Local demo adapter. All false capabilities are displayed in the UI as unavailable;
 * requests route through MockStudioApi and cannot claim real code writes/builds.
 */
export const studioAdapter: StudioAdapter = {
  mode: 'demo',
  capabilities: {
    agentConnected: false,
    remotionEditor: false,
    previewVideo: true,
    cloudRender: false,
  },
  project: PROJECT,
  buildTaskRequest(input) {
    return { ...input, attachments: input.attachments ?? [], references: input.references ?? [] }
  },
  versions() {
    return [
      {
        id: 'legacy-render', name: '当前播放影片', source: 'token-full-legacy.mp4',
        createdAt: '本地项目文件', summary: '152 秒旧版 HyperFrames 混合剪辑，包含 V3 素材段16–19', restorable: false,
      },
      {
        id: 'v3-storyboard', name: 'V3 目标分镜', source: '完整分镜表-V3.md',
        createdAt: '本地项目文件', summary: '273.6 秒目标结构；不是当前可播放成片', restorable: false,
      },
    ]
  },
}
