/**
 * 项目与内容域（README §3.2 / project.md）：项目、时间轴、场景、分镜、镜头参数、产物、版本。
 *
 * 为什么这些端点合成一个 resource：它们全部以 `projectId` 为路径前缀，而且共享同一条并发规则 ——
 * 可变资源（项目、镜头参数、产物）必须用 `If-Match` 条件更新（README §2.7）。
 * 集中一处才能保证「读到的 etag 一定被原样传回去」；散在调用点里迟早会漏。
 *
 * 路径一律相对 base（如 `/projects/prj_1`），base 由 `HttpClient.config` 提供：
 * 02 §1 决定前缀延续 `/api`，且明确「绝不悄悄引入 `/api/v1`」，所以本文件不出现任何前缀。
 */
import type {
  ArtifactStatus,
  ArtifactType,
  Page,
  PageQuery,
  ProjectCreateRequest,
  ProjectDetail,
  ProjectListQuery,
  ProjectSummary,
  ProjectUpdateRequest,
  ProjectVersion,
  Scene,
  ShotOverride,
  ShotSettings,
  StoryboardEntry,
  TaskAcceptedResponse,
  Timeline,
  WorkbenchArtifact,
} from '@/types/contracts'
import type { HttpClient } from './http'
import { ApiError } from './errors'
import { asPage } from './pagination'

export interface CreateProjectOptions {
  /** 同一次「新建」的重试必须复用同一个键；缺省时由 HttpClient 生成一次性键（README §2.7）。 */
  idempotencyKey?: string
  signal?: AbortSignal
}

export interface UpdateProjectOptions {
  signal?: AbortSignal
}

export interface CreateArtifactOptions {
  idempotencyKey?: string
  signal?: AbortSignal
}

export interface RestoreVersionOptions {
  idempotencyKey?: string
  signal?: AbortSignal
}

export interface ArtifactListQuery extends PageQuery {
  type?: ArtifactType
}

/**
 * 新建产物只接受这些字段（project.md §7）：`id`/`version`/`status`/`updatedAt`/`etag` 由服务端产生，
 * 用 `Pick` 从契约类型取而不是另抄一份，避免哪天实体加字段这里悄悄落后。
 */
export type ArtifactCreateRequest = Pick<
  WorkbenchArtifact,
  'type' | 'title' | 'summary' | 'body' | 'relatedSceneIds'
>

/** 更新产物同样带 `If-Match`（project.md §7）；status 用于 draft → needs-review → confirmed 流转。 */
export type ArtifactUpdateRequest = Partial<ArtifactCreateRequest> & { status?: ArtifactStatus }

export interface ProjectsResource {
  list(query?: ProjectListQuery): Promise<Page<ProjectSummary>>
  create(body: ProjectCreateRequest, options?: CreateProjectOptions): Promise<ProjectDetail>
  get(projectId: string): Promise<ProjectDetail>
  update(
    projectId: string,
    body: ProjectUpdateRequest,
    etag: string,
    options?: UpdateProjectOptions,
  ): Promise<ProjectDetail>
  remove(projectId: string): Promise<void>
  timeline(projectId: string): Promise<Timeline>
  scenes(projectId: string, query?: PageQuery): Promise<Page<Scene>>
  scene(projectId: string, sceneId: string): Promise<Scene>
  storyboard(projectId: string, query?: PageQuery): Promise<Page<StoryboardEntry>>
  getSceneOverride(projectId: string, sceneId: string): Promise<ShotOverride | null>
  saveSceneOverride(
    projectId: string,
    sceneId: string,
    settings: ShotSettings,
    etag?: string,
  ): Promise<ShotOverride>
  artifacts(projectId: string, query?: ArtifactListQuery): Promise<Page<WorkbenchArtifact>>
  artifact(projectId: string, artifactId: string): Promise<WorkbenchArtifact>
  createArtifact(
    projectId: string,
    body: ArtifactCreateRequest,
    options?: CreateArtifactOptions,
  ): Promise<WorkbenchArtifact>
  updateArtifact(
    projectId: string,
    artifactId: string,
    body: ArtifactUpdateRequest,
    etag: string,
  ): Promise<WorkbenchArtifact>
  versions(projectId: string): Promise<ProjectVersion[]>
  restoreVersion(
    projectId: string,
    versionId: string,
    options?: RestoreVersionOptions,
  ): Promise<TaskAcceptedResponse>
}

export function createProjectsResource(http: HttpClient): ProjectsResource {
  const projectPath = (projectId: string) => `/projects/${projectId}`

  return {
    async list(query) {
      // 筛选参数由服务端解释：project.md §3.1 明确 `q` 只匹配项目名与 tagline，不搜内容；
      // 未知参数按 README §2.5 由服务端忽略，前端不自行过滤后再发（那会骗过 total）。
      const payload = await http.get<unknown>('/projects', { query: query ? { ...query } : undefined })
      return asPage<ProjectSummary>(payload, { source: 'GET /projects' })
    },

    create(body, options = {}) {
      // POST /projects + Idempotency-Key（project.md §3.2）：重试必须复用同一个键，
      // 否则同目录重名会撞 409，或真的建出两个项目。缺省时 HttpClient 生成一次性键（防不住重复点击）。
      return http.post<ProjectDetail>('/projects', body, {
        idempotencyKey: options.idempotencyKey,
        signal: options.signal,
      })
    },

    get(projectId) {
      return http.get<ProjectDetail>(projectPath(projectId))
    },

    update(projectId, body, etag, options = {}) {
      // etag 在签名上必填而不是可选：project.md §3.4 写明「If-Match 缺失返回 412（不是 428）」。
      // 既然缺版本一定被拒，就要求调用方先读一次详情拿到 etag，把失败提前到编译期而不是运行期。
      return http.patch<ProjectDetail>(projectPath(projectId), body, {
        ifMatch: etag,
        signal: options.signal,
      })
    },

    async remove(projectId) {
      // 成功 204（无内容）。有未完成任务时服务端返回 409 conflict 并列出 blockingTasks（project.md §3.5），
      // 这里不吞、不重试：界面要提示「先停掉这些任务」，而不是显示删除成功。
      await http.del(projectPath(projectId))
    },

    timeline(projectId) {
      // Timeline.source 区分 assembly（真实组装）与 demo（演示数据）：演示时间轴不得驱动渲染（project.md §4.1），
      // 本层只如实透出，不在这里降级或加默认值。
      return http.get<Timeline>(`${projectPath(projectId)}/timeline`)
    },

    async scenes(projectId, query) {
      const payload = await http.get<unknown>(`${projectPath(projectId)}/scenes`, {
        query: query ? { ...query } : undefined,
      })
      return asPage<Scene>(payload, { source: `GET /projects/${projectId}/scenes` })
    },

    scene(projectId, sceneId) {
      // project.md §4.3：详情可能额外带 storyboard 段对象，契约类型没收录；多余字段忽略即可，
      // 需要分镜时走 storyboard()，不在这里把额外字段塞进 Scene。
      return http.get<Scene>(`${projectPath(projectId)}/scenes/${sceneId}`)
    },

    async storyboard(projectId, query) {
      const payload = await http.get<unknown>(`${projectPath(projectId)}/storyboard`, {
        query: query ? { ...query } : undefined,
      })
      // 分镜是只读规划数据（project.md §5）：timecode/duration 保留原始文本，不在传输层解析成毫秒。
      return asPage<StoryboardEntry>(payload, { source: `GET /projects/${projectId}/storyboard` })
    },

    async getSceneOverride(projectId, sceneId) {
      try {
        return await http.get<ShotOverride>(`${projectPath(projectId)}/scenes/${sceneId}/override`)
      } catch (error) {
        // project.md §6：这个场景**没保存过**镜头参数时服务端返回 404。
        // `null` 在这里表达「明确无此关联」（README §2.6 只允许 null 表达这个意思），
        // 因此转成 null 不是吞错误：其它状态码、超时、断网、解析失败一律原样抛出。
        // 存疑：若服务端也用 404 表示「项目/场景不存在」，这一层无法区分（见汇报）。
        if (error instanceof ApiError && error.isNotFound) return null
        throw error
      }
    },

    saveSceneOverride(projectId, sceneId, settings, etag) {
      // PUT 是整体替换：body 形状按 project.md §6 包一层 `settings`。
      // 首次保存本就没有 etag，不带 If-Match；已经读到过 etag 就必须带，否则会静默覆盖别人的改动。
      return http.put<ShotOverride>(
        `${projectPath(projectId)}/scenes/${sceneId}/override`,
        { settings },
        { ifMatch: etag },
      )
    },

    async artifacts(projectId, query) {
      const payload = await http.get<unknown>(`${projectPath(projectId)}/artifacts`, {
        query: query ? { ...query } : undefined,
      })
      // 只返回真实存在的产物（02 §3：不返回占位）；`type` 由服务端筛选，排序固定 updatedAt 倒序。
      return asPage<WorkbenchArtifact>(payload, { source: `GET /projects/${projectId}/artifacts` })
    },

    artifact(projectId, artifactId) {
      return http.get<WorkbenchArtifact>(`${projectPath(projectId)}/artifacts/${artifactId}`)
    },

    createArtifact(projectId, body, options = {}) {
      // 产物没有删除端点、只归档（project.md §7），所以「重复点击建出两份草稿」的代价尤其高；
      // 同样按 README §2.7 支持调用方传入幂等键。
      return http.post<WorkbenchArtifact>(`${projectPath(projectId)}/artifacts`, body, {
        idempotencyKey: options.idempotencyKey,
        signal: options.signal,
      })
    },

    updateArtifact(projectId, artifactId, body, etag) {
      // etag 必填的理由同 update()：project.md §7 要求带 If-Match，
      // 且 confirmed 产物改内容必须回 needs-review，服务端要靠版本判断这是不是同一份内容。
      return http.patch<WorkbenchArtifact>(`${projectPath(projectId)}/artifacts/${artifactId}`, body, {
        ifMatch: etag,
      })
    },

    async versions(projectId) {
      // 裸数组而不是 Page（project.md §8）：版本是有限集合，不分页。
      // 但仍借共享 asPage 做形状校验后取 items —— 认不出的形状必须抛错，
      // 不能把 `{nope:true}` 当版本数组传下去；核心层只提供 asPage，没有数组版助手。
      // restorable=false 的项（旧成片、分镜草稿）禁止显示可用恢复按钮，判定交给界面。
      const payload = await http.get<unknown>(`${projectPath(projectId)}/versions`)
      return asPage<ProjectVersion>(payload, { source: `GET /projects/${projectId}/versions` }).items
    },

    restoreVersion(projectId, versionId, options = {}) {
      // 202 + TaskAcceptedResponse：只表示「受理了一个 restore 任务」（project.md §8、README §2.3），
      // 恢复完成才改项目内容，所以调用方拿到后应订阅该任务的事件流。
      // restorable=false 的来源服务端返回 422 capability_unavailable，这里如实抛出、不降级成 500 或空对象。
      return http.post<TaskAcceptedResponse>(
        `${projectPath(projectId)}/versions/${versionId}/restore`,
        undefined,
        { idempotencyKey: options.idempotencyKey, signal: options.signal },
      )
    },
  }
}
