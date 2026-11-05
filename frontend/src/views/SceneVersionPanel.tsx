import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, ArrowLeft, Check, History, RotateCcw, Undo2 } from 'lucide-react'
import { studioHttpApi } from '@/services/api'
import type { ProjectSceneState } from '@/services/api/taskClient'
import type { RestoreFailure, useSceneVersions } from '@/hooks/useSceneVersions'

/**
 * 场景版本历史面板。
 *
 * <p><strong>与「预览版本」页签不是一回事</strong>：那边列举的是工作流/编辑器产出的
 * 文件（测试帧、试片、整片），这边是<strong>修改任务的提交结果</strong> ——
 * 每一条对应一次「自然语言修改 → 校验 → 渲染 → 提交」产生的场景版本。
 * 把两者混在一个列表里，用户会以为「回退视频」和「回退场景」是同一件事。</p>
 *
 * <p><strong>回退按钮的措辞刻意写「回退到此版本」而不是「恢复视频」</strong>：
 * 回退只还原场景数据，不重新渲染视频。写成「恢复视频」会让用户以为
 * 画面已经变回去了，而实际上需要再跑一次修改才产生新视频。</p>
 */

/** 时间显示：只在列表里看「什么时候改的」，不需要秒。 */
const when = (value: string) =>
  new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })

/**
 * 单条版本的视频预览。
 *
 * <p>没有产物路径时不渲染播放器，也不放假占位图 —— 那一版可能没渲染成功，
 * 编一个空画面会让用户以为视频丢了。</p>
 */
function VersionVideo({ projectId, artifactPath }: { projectId: string; artifactPath: string | null }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => { setFailed(false) }, [artifactPath])

  if (!artifactPath) {
    return <p className="wb-sv-noart">这一版没有留下视频文件</p>
  }
  if (failed) {
    /* 文件可能已被清理：如实说读不到，不显示一个永远转圈的播放器 */
    return <p className="wb-sv-noart">视频文件已不可读（可能已被清理）</p>
  }
  return (
    <video
      className="wb-sv-video"
      src={studioHttpApi().artifacts.contentUrl(projectId, artifactPath)}
      controls
      playsInline
      preload="metadata"
      onError={() => setFailed(true)}
    />
  )
}

/** 回退失败提示。不同原因给不同的下一步，而不是一句红字了事。 */
function FailureNotice({ failure, onDismiss }: { failure: RestoreFailure; onDismiss: () => void }) {
  const next: Record<RestoreFailure['reason'], string> = {
    conflict: '列表已过期，请稍后重新打开版本历史再试。',
    noop: '这一版就是当前版本，不需要回退。',
    corrupt: '这一版的场景数据不可用，换一版试试。',
    unreachable: '连不上后端，请确认应用正常运行后重试。',
    rejected: '请求没有被接受。',
  }
  return (
    <div className="wb-sv-failure" role="alert">
      <AlertTriangle size={13} />
      <div>
        <p>{failure.message}</p>
        <small>{next[failure.reason]}</small>
      </div>
      <button type="button" onClick={onDismiss} aria-label="关闭提示">×</button>
    </div>
  )
}

export function SceneVersionPanel({ projectId, scene, versions, onClose }: {
  projectId: string
  scene: ProjectSceneState | null
  versions: ReturnType<typeof useSceneVersions>
  onClose: () => void
}) {
  const { versions: items, loading, loadError, restoring, failure, lastRestored, restore, clearFailure } = versions
  /** 待确认回退的目标：回退会改动项目内容，不应该点一下就执行 */
  const [confirming, setConfirming] = useState<number | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)

  /* 回退成功后滚回顶部：新版本在最上面，而用户此刻可能停在列表底部
     （他是在那里点的「回退到此版本」）。不滚回去，最新的结果和一整条
     「已回退」提示都在视野之外，看起来像什么都没发生。 */
  useEffect(() => {
    if (!lastRestored) return
    scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
  }, [lastRestored])

  const currentVersion = scene?.initialized ? scene.version : 0

  return (
    <aside className="fw-panel wb-scene-versions" aria-label="场景版本历史">
      <header className="wb-desk-header">
        <div>
          <span className="wb-desk-eyebrow">SCENE VERSIONS</span>
          <h2>场景版本 <span>{items.length ? `${items.length} 版` : '还没有版本'}</span></h2>
        </div>
        <button type="button" onClick={onClose} aria-label="返回对话" title="返回对话"><ArrowLeft size={16} /></button>
      </header>

      <div className="wb-desk-scroll" ref={scrollRef}>
        <div className="wb-desk-section-heading">
          <div>
            <h3>每次修改都留下一版</h3>
            <p>这里是修改任务真正提交过的场景版本。回退会新增一版，不会删掉已有的。</p>
          </div>
        </div>

        {/* 当前版本单独说明一次：用户最常问的就是「我现在是哪一版」 */}
        <div className="wb-sv-current">
          <span className="wb-sv-current-label">当前场景</span>
          <b>{currentVersion ? `版本 v${currentVersion}` : '还没有场景'}</b>
          {scene?.updatedAt && <time dateTime={scene.updatedAt}>{when(scene.updatedAt)}</time>}
        </div>

        {failure && <FailureNotice failure={failure} onDismiss={clearFailure} />}

        {lastRestored && (
          <div className="wb-sv-success" role="status">
            <Check size={13} />
            <span>已回退到版本 {lastRestored.fromVersion} 的内容，产生新版本 v{lastRestored.version}。</span>
          </div>
        )}

        {loading && <p className="wb-sv-hint">正在读取版本…</p>}
        {loadError && !loading && (
          <p className="wb-sv-hint wb-sv-err">读不到版本列表：{loadError}</p>
        )}

        {!loading && !loadError && items.length === 0 && (
          <div className="wb-desk-empty">
            <History size={28} strokeWidth={1.2} />
            <h3>还没有场景版本</h3>
            <p>用自然语言修改一次视频后，这里会出现可回退的版本。</p>
          </div>
        )}

        <div className="wb-sv-list">
          {items.map((item) => {
            const isCurrent = item.version === currentVersion
            const isConfirming = confirming === item.version
            const sourceProject = 'kind' in item.film && item.film.kind === 'project-render'
            const canRestore = !sourceProject || ('sourceSnapshot' in item.film && !!item.film.sourceSnapshot)
            return (
              <article className="wb-sv-item" key={item.version} data-current={isCurrent}>
                <header>
                  <span className="wb-sv-num">v{item.version}</span>
                  {isCurrent && <span className="wb-sv-badge">当前版本</span>}
                  {item.source === 'restore' && (
                    <span className="wb-sv-badge wb-sv-badge-restore">
                      <Undo2 size={10} />回退自 v{item.fromVersion}
                    </span>
                  )}
                  <time dateTime={item.createdAt}>{when(item.createdAt)}</time>
                </header>

                {/* 变更摘要：版本号本身回答不了「这一版改了什么」 */}
                <p className="wb-sv-summary">{item.editSummary || '无变更摘要'}</p>

                {item.prompt && (
                  <details className="wb-sv-prompt">
                    <summary>当时的修改要求</summary>
                    <p>{item.prompt}</p>
                  </details>
                )}

                <VersionVideo projectId={projectId} artifactPath={item.artifactPath} />

                {!isCurrent && !canRestore && <p className="wb-sv-hint">这个旧版本未保存工程源码，可预览视频，无法恢复工程。</p>}
                {!isCurrent && canRestore && (
                  <div className="wb-sv-actions">
                    {isConfirming ? (
                      <>
                        <button
                          type="button"
                          className="wb-desk-primary"
                          disabled={restoring !== null}
                          onClick={async () => {
                            const ok = await restore(item.version, currentVersion || undefined)
                            setConfirming(null)
                            if (!ok) return
                          }}
                        >
                          <RotateCcw size={12} />
                          {restoring === item.version ? '正在回退…' : `确认回退到 v${item.version}`}
                        </button>
                        <button type="button" className="wb-desk-secondary" onClick={() => setConfirming(null)}>
                          取消
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className="wb-desk-secondary"
                        disabled={restoring !== null}
                        onClick={() => { clearFailure(); setConfirming(item.version) }}
                      >
                        <RotateCcw size={12} />回退到此版本
                      </button>
                    )}
                  </div>
                )}

                {isConfirming && (
                  <p className="wb-sv-warn">
                    {sourceProject ? '恢复该版工程代码与素材，沿用该版视频；后续修改从该版工程继续。' : '回退只还原场景数据，不会重新生成视频。后续修改以此版为基线。'}
                  </p>
                )}
              </article>
            )
          })}
        </div>
      </div>

      <footer className="wb-desk-footer">
        <span>回退新增版本 · 历史不会被删除</span>
      </footer>
    </aside>
  )
}
