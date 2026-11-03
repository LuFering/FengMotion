/**
 * 项目产物域客户端：列出项目目录下的真实文件、读取文件内容。
 *
 * <p>与 `projects.ts` 里的 `WorkbenchArtifact` 不是一回事：那是工作流产出的
 * **文档型产物**（有版本、状态、正文），这边是项目目录里的**真实文件**
 * （AI 用 write/bash 写出来的 mp4、md、png 等）。两者来源不同，不要混用。</p>
 *
 * <p>数据源是文件系统本身，不是数据库表 —— 所以没有 etag、没有版本概念，
 * 也不支持修改。列出来的就是磁盘上此刻存在的东西。</p>
 */
import type { HttpClient } from './http'

/** 产物文件的归类。 */
export type ProjectArtifactKind = 'video' | 'image' | 'audio' | 'code' | 'document' | 'file'

/** 项目目录里的一个文件。 */
export interface ProjectArtifact {
  /** 相对项目根目录的路径，读取内容时原样传回 */
  path: string
  /** 文件名（不含目录） */
  name: string
  sizeBytes: number
  kind: ProjectArtifactKind
  /** 最后修改时间 */
  modifiedAt: string
}

/** 产物列表响应。 */
export interface ProjectArtifactList {
  items: ProjectArtifact[]
  /** 项目根目录；项目还没有目录时为 null */
  rootPath: string | null
}

export interface ArtifactsResource {
  /**
   * 列出项目产物。
   *
   * @param projectId 项目 ID
   * @param options 请求选项
   */
  list(projectId: string, options?: { signal?: AbortSignal }): Promise<ProjectArtifactList>

  /**
   * 产物的可访问 URL。
   *
   * 返回完整地址而不是相对路径：产物内容由 `<video src>` / `<img src>` 直接加载，
   * 这里的 baseUrl 可能指向另一个端口（打包态后端端口是动态的），
   * 拼相对路径会打到前端 dev server 上。
   *
   * @param projectId 项目 ID
   * @param path 相对项目根目录的路径
   */
  contentUrl(projectId: string, path: string): string
}

export function createArtifactsResource(http: HttpClient): ArtifactsResource {
  return {
    async list(projectId, options = {}) {
      const result = await http.get<ProjectArtifactList>(
        `/projects/${encodeURIComponent(projectId)}/artifacts`,
        { signal: options.signal },
      )
      // 后端可能返回 null 字段（项目无目录）；这里归一成空数组，调用方不用到处判空
      return {
        items: Array.isArray(result?.items) ? result.items : [],
        rootPath: result?.rootPath ?? null,
      }
    },

    contentUrl(projectId, path) {
      // path 里可能含中文、空格、斜杠：逐段编码，保留分隔符
      const encoded = path.split('/').map(encodeURIComponent).join('/')
      return http.url(
        `/projects/${encodeURIComponent(projectId)}/artifacts/content?path=${encoded}`,
      )
    },
  }
}
