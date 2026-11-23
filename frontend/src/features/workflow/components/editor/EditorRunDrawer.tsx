import type * as React from 'react'
import { UiIcon, SemIcons } from '@/shared/icons/UiIcon'
import { workflowService, type WfArtifact, type WorkflowRun } from '@/features/workflow/services/workflowService'
import { workflowRunLabel } from '@/features/workflow/services/workflowPresentation'
import { RUN_STATUS_TXT, type FmNode } from '@/features/workflow/model/editorNodes'
import { defForNode } from '@/features/workflow/model/workflowTemplates'
import { workflowArtifactMedia } from '@/features/workflow/services/workflowGraph'
import { useEditorArtifacts } from '@/features/workflow/hooks/editor/useEditorArtifacts'
import type { TaskEvent } from '@/api/studioApi'
import type { EditorInnerProps } from '@/features/workflow/WorkflowEditor'

export interface EditorRunDrawerProps {
  artifactsToShow: WfArtifact[]
  dirty: boolean
  downloadArtifact: ReturnType<typeof useEditorArtifacts>['downloadArtifact']
  downloading: ReturnType<typeof useEditorArtifacts>['downloading']
  drawerOpen: boolean
  drawerTab: 'events' | 'outputs' | 'artifacts' | 'history'
  eventsToShow: TaskEvent[]
  isStructured: boolean
  lastRun: WorkflowRun | null
  nodes: FmNode[]
  /** 点「节点状态」里的一项：在画布上选中并定位那个节点 */
  onLocateNode: (nodeId: string) => void
  runMatches: ReturnType<typeof useEditorArtifacts>['runMatches']
  running: boolean
  selectedRunCaption: string
  setDrawerOpen: React.Dispatch<React.SetStateAction<boolean>>
  setDrawerTab: React.Dispatch<React.SetStateAction<'events' | 'outputs' | 'artifacts' | 'history'>>
  setLastRun: React.Dispatch<React.SetStateAction<WorkflowRun | null>>
  setLiveEvents: React.Dispatch<React.SetStateAction<TaskEvent[]>>
  setViewing: React.Dispatch<React.SetStateAction<WfArtifact | null>>
  viewing: WfArtifact | null
  workflowId: EditorInnerProps['workflowId']
}

/** 工作流编辑器底部的执行日志抽屉（Structured 下为评估日志）：展示所选运行的事件、节点状态、产物与运行记录，产物可查看和下载。 */
export function EditorRunDrawer({ artifactsToShow, dirty, downloadArtifact, downloading, drawerOpen, drawerTab, eventsToShow, isStructured, lastRun, nodes, onLocateNode, runMatches, running, selectedRunCaption, setDrawerOpen, setDrawerTab, setLastRun, setLiveEvents, setViewing, viewing, workflowId }: EditorRunDrawerProps) {
  return (
    /* 从没运行过、也没手动打开时不占一整条：顶栏的「运行记录」按钮可以随时打开 */
    !running && !lastRun && !drawerOpen ? null :
    <div className="wfe-drawer" data-open={drawerOpen || undefined}>
      <div className="wfe-drawer-head">
        <button type="button" className="wfe-drawer-toggle" onClick={() => setDrawerOpen((v) => !v)} aria-expanded={drawerOpen}>
          <UiIcon icon={SemIcons.collapse} size="sm" className={drawerOpen ? 'wfe-chev is-open' : 'wfe-chev'} />
          <b>{isStructured ? '评估记录' : '运行记录'}</b>
          {running || lastRun ? (
            <span className="wfe-drawer-meta" title={selectedRunCaption}>
              {selectedRunCaption}{running ? '' : ` · ${lastRun?.artifacts.length ?? 0} 项产物`}
            </span>
          ) : <span className="wfe-drawer-meta">还没有运行过</span>}
        </button>
        {/* 节点进度：每个节点一个点，点一下在画布上定位 */}
        {(running || (lastRun && runMatches)) && (
          <ol className="wfe-progress" aria-label="节点进度">
            {nodes.filter((n) => n.type === 'fm').map((n) => {
              const st = running ? n.data.status : lastRun?.nodeStatus[n.id] ?? 'idle'
              const label = defForNode({ type: n.data.defType, params: n.data.params })?.label ?? n.data.defType
              return (
                <li key={n.id}>
                  <button type="button" data-s={st} onClick={() => onLocateNode(n.id)} title={`${label} · ${RUN_STATUS_TXT[st] ?? '未运行'}`}>
                    <i aria-hidden="true" />{label}
                  </button>
                </li>
              )
            })}
          </ol>
        )}
      </div>
      {drawerOpen && (
        <div className="wfe-drawer-body">
          {/* 运行名称和状态已经在标题栏里；这里只补时间，以及「这条记录对不上当前画布」的提醒 */}
          {!running && lastRun && <p className="wfe-run-identity">
            <time dateTime={lastRun.startedAt}>{new Date(lastRun.startedAt).toLocaleString('zh-CN')}</time>
            {!runMatches && <span> · {dirty ? '画布有未保存的更改' : lastRun.projectId === undefined ? '旧记录未保存项目身份' : '与当前版本或项目不同'}，结果仅供历史查看。</span>}
          </p>}
          {!running && lastRun?.nodeIO && <details className="wfe-node-io"><summary>实际节点输入与输出</summary><pre>{JSON.stringify(lastRun.nodeIO,null,2)}</pre></details>}
          <div className="wfe-tabs sm" role="tablist" aria-label="日志视图">
            {([['outputs', '节点'], ['events', '事件'], ['artifacts', '产物'], ['history', '历史']] as const).map(([id, label]) => (
              <button key={id} type="button" role="tab" aria-selected={drawerTab === id} data-on={drawerTab === id ? '' : undefined} onClick={() => setDrawerTab(id)}>
                {label}
              </button>
            ))}
          </div>
          {drawerTab === 'history' && <div className="wfe-runhistory">{workflowService.listRuns(workflowId).length === 0 ? <p className="wfe-hint">尚无运行记录。</p> : workflowService.listRuns(workflowId).map((run) => <button type="button" key={run.id} disabled={running} data-selected={lastRun?.id === run.id || undefined} onClick={() => { setLastRun(run); setLiveEvents([]); setViewing(null); setDrawerTab('events') }}><b>{new Date(run.startedAt).toLocaleString('zh-CN')}</b><span>{workflowRunLabel(run)} · 工作流 v{run.revision} · {RUN_STATUS_TXT[run.status] ?? run.status} · {run.artifacts.length} 项产物</span></button>)}</div>}
          {drawerTab === 'events' && (
            <ul className="wfe-events">
              {eventsToShow.length === 0 && <li className="wfe-hint">还没有事件。点右上角「{isStructured ? '评估' : '运行'}」开始。</li>}
              {eventsToShow.map((e) => (
                <li key={e.id} data-k={e.kind}>
                  <span className="num">{new Date(e.at).toLocaleTimeString('zh-CN')}</span> {e.message}
                </li>
              ))}
            </ul>
          )}
          {drawerTab === 'outputs' && (
            <ul className="wfe-events wfe-steps">
              {(running ? nodes.filter((n) => n.type === 'fm').map((n) => [n.id, n.data.status] as const) : Object.entries(lastRun?.nodeStatus ?? {})).map(([id, st], index) => {
                const n = nodes.find((n) => n.id === id)
                const label = !running ? lastRun?.nodeLabels?.[id] ?? `历史节点 ${index + 1}` : n ? defForNode({ type: n.data.defType, params: n.data.params })?.label : `节点 ${index + 1}`
                const onCanvas = !!n
                return (
                  <li key={id}>
                    <button type="button" className="wfe-step" disabled={!onCanvas} onClick={() => onLocateNode(id)} title={onCanvas ? '在画布上定位这个节点' : '这个节点已不在画布上'}>
                      <i className="fm-dot" data-s={st === 'completed' ? 'done' : st === 'failed' ? 'failed' : st === 'running' ? 'running' : st === 'awaiting_info' ? 'waiting' : 'idle'} />
                      <span>{label}</span>
                      <em>{RUN_STATUS_TXT[st] ?? '未运行'}</em>
                    </button>
                  </li>
                )
              })}
              {!running && !lastRun && <li className="wfe-hint">尚未选择运行记录。</li>}
            </ul>
          )}
          {drawerTab === 'artifacts' && (
            <div className="wfe-artifacts">
              {viewing ? (
                <div className="wfe-artifact-view">
                  <div className="wfe-artifact-view-head">
                    <b>{viewing.title}</b>
                    <span>{viewing.filename}</span>
                    <button type="button" className="wfe-btn sm" onClick={() => setViewing(null)}>返回产物列表</button>
                  </div>
                  {workflowArtifactMedia(viewing) && <video className="wfe-artifact-video" src={workflowArtifactMedia(viewing)!} controls preload="metadata" aria-label="真实渲染产物预览"/>}<pre>{viewing.content}</pre>
                </div>
              ) : (
                <>
                  {artifactsToShow.length === 0 && <p className="wfe-hint">暂无产物。{isStructured ? '评估' : '运行'}完成后，产物会出现在这里。</p>}
                  {artifactsToShow.map((a) => (
                    <div key={a.id} className="wfe-artifact">
                      <div className="wfe-artifact-main">
                        <b>{a.title}</b>
                        {/* 真实产物与界面快照必须能区分：
                            以前所有产物都标「演示」，真渲出来的视频混在里面
                            用户分不清哪个能播。 */}
                        <span data-real={!a.demo || undefined}>
                          {a.demo ? '界面快照 · 无对应文件' : '真实产物'} · {a.summary}
                        </span>
                      </div>
                      <button type="button" className="wfe-btn sm" onClick={() => setViewing(a)}><UiIcon icon={SemIcons.eye} size="xs" /> 查看</button>
                      <button type="button" className="wfe-btn sm" disabled={downloading} onClick={() => { void downloadArtifact(a) }}><UiIcon icon={SemIcons.download} size="xs" /> 下载</button>
                      {(a.kind === 'render' || a.kind === 'create' || a.kind === 'evaluation') && (
                        <button type="button" className="wfe-btn sm" onClick={() => { if (lastRun?.projectId) window.postMessage({ type:'fm-nav', id:'production', projectId:lastRun.projectId }, '*') }} disabled={!lastRun?.projectId} title={!lastRun?.projectId ? '此记录没有可确认的关联项目' : '打开这次运行所属项目'}>查看所属项目</button>
                      )}
                    </div>
                  ))}
                  {artifactsToShow.some((a) => a.kind === 'create') && (
                    <p className="wfe-hint">演示产物仅为请求记录；真实视频会单独标注。「查看所属项目」打开这次运行的项目。</p>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
