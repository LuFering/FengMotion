/**
 * 项目文件产物：项目目录里真实存在的文件（AI 用 write/bash 产出的视频、脚本、图片）。
 *
 * <p>与工作流产物（`data/workbenchArtifacts`）是两回事：那些是流程节点的文档型产出，
 * 有版本与状态；这里是磁盘上此刻真实存在的文件。放在同一页里是为了让用户一眼看到
 * 「这个项目里到底有什么东西」，但视觉上分开呈现，不混成一份列表。</p>
 *
 * <p>数据直接来自文件系统，所以没有编辑、没有版本 —— 用户想改就改文件本身。</p>
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { FolderOpen } from 'lucide-react'

import { studioHttpApi } from '@/services/api'
import type { ProjectArtifact } from '@/services/api/artifacts'

/** 人类可读的文件大小。 */
function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/** 相对时间，与左栏会话列表口径一致。 */
function fmtAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  if (Number.isNaN(ms)) return ''
  const min = Math.floor(ms / 60000)
  if (min < 1) return '刚刚'
  if (min < 60) return `${min}分钟前`
  const hour = Math.floor(min / 60)
  if (hour < 24) return `${hour}小时前`
  return `${Math.floor(hour / 24)}天前`
}

export interface ProjectArtifactsProps {
  projectId: string
  /** 刷新触发信号：任务结束等时机由外层递增，用来重新拉列表 */
  refreshKey?: number
}

export function ProjectArtifacts({ projectId, refreshKey = 0 }: ProjectArtifactsProps) {
  const [items, setItems] = useState<ProjectArtifact[]>([])
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [error, setError] = useState<string | null>(null)
  /** 当前展开预览的产物路径；null = 没有展开 */
  const [preview, setPreview] = useState<string | null>(null)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  const load = useCallback(async (signal?: AbortSignal) => {
    setState('loading')
    setError(null)
    try {
      const result = await studioHttpApi().artifacts.list(projectId, { signal })
      if (!mounted.current) return
      setItems(result.items)
      setState('ready')
    } catch (cause) {
      if (!mounted.current) return
      // 读不到就说读不到，不显示一个空列表让人以为「项目里什么都没有」
      setError(cause instanceof Error ? cause.message : '读不到项目文件')
      setState('failed')
    }
  }, [projectId])

  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [load, refreshKey])

  if (state === 'loading' && items.length === 0) {
    return (
      <div className="fw-artifacts-files">
        <p className="fw-rail-none">正在读取项目文件…</p>
      </div>
    )
  }

  if (state === 'failed') {
    return (
      <div className="fw-artifacts-files">
        <p className="fw-rail-none" role="alert">读不到项目文件：{error}</p>
        <button type="button" className="fw-rail-retry" onClick={() => void load()}>重试</button>
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div className="fw-artifacts-files">
        <p className="fw-rail-none">
          项目目录里还没有文件。让 Agent 做点什么（比如生成一段视频），产出会出现在这里。
        </p>
      </div>
    )
  }

  const api = studioHttpApi()
  const previewItem = preview !== null ? items.find((i) => i.path === preview) : undefined

  return (
    <div className="fw-artifacts-files">
      <p className="fw-files-head">
        <FolderOpen size={12} /> 项目文件 · {items.length} 个
      </p>
      <ul className="fw-files-list">
        {items.map((item) => (
          <li key={item.path} className="fw-file" data-kind={item.kind}>
            <button type="button" className="fw-file-row"
                    aria-expanded={preview === item.path}
                    onClick={() => setPreview(preview === item.path ? null : item.path)}>
              <span className="fw-file-name">{item.name}</span>
              <span className="fw-file-meta">
                {item.path.includes('/') && <span className="fw-file-dir">{item.path.slice(0, item.path.lastIndexOf('/'))}/</span>}
                {fmtSize(item.sizeBytes)} · {fmtAgo(item.modifiedAt)}
              </span>
            </button>
          </li>
        ))}
      </ul>

      {/* 预览：视频/图片直接播放显示，其他类型给一个「在文件管理器中打开」的提示。
          不在这里做代码高亮之类的富展示 —— 用户要看内容用编辑器更合适。 */}
      {previewItem && (
        <div className="fw-file-preview">
          {previewItem.kind === 'video' ? (
            <video src={api.artifacts.contentUrl(projectId, previewItem.path)} controls preload="metadata" />
          ) : previewItem.kind === 'image' ? (
            <img src={api.artifacts.contentUrl(projectId, previewItem.path)} alt={previewItem.name} />
          ) : (
            <p className="fw-rail-none">
              {previewItem.name} 是 {previewItem.kind} 类型，暂不支持内嵌预览。
            </p>
          )}
        </div>
      )}
    </div>
  )
}
