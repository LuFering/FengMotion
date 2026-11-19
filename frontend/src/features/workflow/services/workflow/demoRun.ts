import { readHarnessSelection } from '@/features/harness/hooks/useHarnessSelection'
import { flushLocalDocuments } from '@/shared/local-documents/localDocuments'
import { executeWorkflow, extractReworkCorrection } from '@/features/workflow/services/workflowExecution'
import { workflowGraphProblems } from '@/features/workflow/services/workflowGraph'
import { formatApplyPresetSummary } from '@/features/workflow/services/workflowPresetBinding'
import { isPresetNotActiveError } from '@/api/skillPresets'
import { submitCreation, cancelCreationJob } from '@/features/creation/services/creationClient'
import { ensureCreationContext } from '@/features/creation/services/creationEntry'
import type { AgentReference, AgentTask, ChangeSet, TaskEvent, TaskStatus } from '@/api/studioApi'
import { studioHttpApi } from '@/api'
import type { FilmCreateResult, WorkflowContextState } from '@/api/workflowContext'
import { ARTIFACT_KIND_MAP, defForNode } from '@/features/workflow/model/workflowTemplates'
import type { WorkflowDef, WfArtifact, WfNodeStatus, WorkflowRun } from '@/features/workflow/model/workflowTypes'
import { uid, loadRuns, saveRuns } from '@/features/workflow/services/workflow/store'
import { evaluateGate } from '@/features/workflow/services/workflow/gate'
import { wait, topoOrder, json, pfArtifact, pfValidate, type DemoRunHandle } from '@/features/workflow/services/workflow/runSteps'

/** 显式引用优先，兼容工作流节点中已保存的资源 ID；不把演示名称当真实素材。 */
export function workflowResourceReferences(wf: WorkflowDef): AgentReference[] {
  const refs: AgentReference[] = [...(wf.resourceReferences ?? [])]
  for (const node of wf.nodes) {
    if (node.type === 'refs') {
      for (const id of (node.params.assetIds as string[] | undefined) ?? []) {
        if (!refs.some((r) => r.kind === 'asset' && r.assetId === id)) refs.push({
          id: `asset:${id}`, kind: 'asset', role: 'context', assetId: id, purpose: 'unspecified', label: id,
        })
      }
      for (const id of (node.params.refSegmentIds as string[] | undefined) ?? []) {
        if (!refs.some((r) => r.kind === 'reference' && r.segmentId === id)) refs.push({
          id: `reference:${id}`, kind: 'reference', role: 'context', segmentId: id, label: id,
        })
      }
    }
    if (node.type === 'capability') for (const id of (node.params.techniqueIds as string[] | undefined) ?? []) {
      if (!refs.some((r) => r.kind === 'technique' && r.techniqueId === id)) refs.push({
        id: `technique:${id}`, kind: 'technique', role: 'context', techniqueId: id, intent: 'reference', label: id,
      })
    }
  }
  return refs
}

export function startDemoRun(
  wf: WorkflowDef,
  callbacks: {
    onEvent: (event: TaskEvent) => void
    onNodeStatus: (nodeId: string, status: WfNodeStatus) => void
    /** 当前项目；有值时 Prompt-first 运行会真实建立 workflow-v0.1.1 创作上下文 */
    projectId?: string
    /** 用户原始需求；会逐字写进 prompt.original.md */
    prompt?: string
    references?: AgentReference[]
    onCreateResult?: (result: FilmCreateResult) => void
  },
): DemoRunHandle {
  if (callbacks.projectId && wf.path !== 'structured') return startProjectGraph(wf,callbacks)
  const runId = uid('run')
  const taskId = uid('task')
  const startedAt = new Date().toISOString()
  const task: AgentTask = {
    id: taskId,
    kind: 'modify',
    status: 'queued',
    title: wf.path === 'structured' ? `状态评估 · ${wf.name}` : `演示运行 · ${wf.name}`,
    createdAt: startedAt,
    mock: true,
  }
  const events: TaskEvent[] = []
  const artifacts: WfArtifact[] = []
  const nodeStatus: Record<string, WfNodeStatus> = Object.fromEntries(
    wf.nodes.filter((n) => n.type !== 'lane').map((n) => [n.id, 'pending' as WfNodeStatus]),
  )
  let cancelled = false
  let realCreationStarted = false
  const emit = (kind: TaskEvent['kind'], status: TaskStatus, message: string) => {
    const event: TaskEvent = { id: uid('evt'), taskId, kind, status, message, at: new Date().toISOString(), mock: true }
    events.push(event)
    callbacks.onEvent(event)
  }
  const setStatus = (id: string, s: WfNodeStatus) => {
    nodeStatus[id] = s
    callbacks.onNodeStatus(id, s)
  }

  const done = (async (): Promise<WorkflowRun> => {
    let status: TaskStatus = 'completed'
    /* 真实建立起来的上下文；null 表示没建（无项目或失败） */
    let contextInfo: WorkflowContextState | null = null
    /* 真实渲染出来的产物；null 表示这一轮没有真的出片 */
    let createdArtifact: FilmCreateResult | null = null
    if (wf.path === 'structured') {
      emit('accepted', 'queued', `演示评估已接收（${wf.name} · 修订 ${wf.revision}）。Structured 运行只做状态评估：清点产物与 Gate，不生成产物、不代替用户确认。`)
      const stageRows: Array<Record<string, unknown>> = []
      const arts = wf.nodes.filter((n) => n.type === 'artifact')
      for (const node of arts) {
        if (cancelled) break
        const kind = String(node.params.kind ?? '')
        const st = String(node.params.status ?? 'missing')
        setStatus(node.id, 'running')
        await wait(90)
        setStatus(node.id, st === 'missing' ? 'skipped' : 'completed')
        emit('progress', 'running', `${ARTIFACT_KIND_MAP[kind]?.label ?? kind}：${st === 'missing' ? '尚无产物' : `状态 ${st}${node.params.version ? ` · ${String(node.params.version)}` : ''}`}`)
        stageRows.push({ kind, status: st, version: String(node.params.version ?? ''), fixture: !!node.params.fixture })
      }
      const gateRows: Array<Record<string, unknown>> = []
      for (const g of wf.nodes.filter((n) => n.type === 'gate')) {
        if (cancelled) break
        const ev = evaluateGate(wf, g)
        setStatus(g.id, 'completed')
        gateRows.push({ gate: ev.gate, label: ev.label, decision: ev.decision, stale: ev.stale, blocked: ev.blocked, primary: ev.primaryKind })
        emit(
          'build',
          'building',
          `${ev.label}：${ev.decision === 'confirmed' ? (ev.stale ? '已确认（版本已变更，确认失效）' : '已确认') : ev.decision === 'pending' ? '待确认' : '未开始'}${ev.blocked.length ? `；阻塞：${ev.blocked.join('、')}` : ''}`,
        )
        await wait(90)
      }
      if (cancelled) {
        status = 'cancelled'
        emit('cancelled', 'cancelled', '评估已取消。')
      } else {
        const missing = stageRows.filter((r) => r.status === 'missing').length
        const report = {
          workflow: { id: wf.id, name: wf.name, revision: wf.revision, path: wf.path },
          artifacts: stageRows,
          gates: gateRows,
          note: '状态评估报告：反映本次评估时工作流内的产物与 Gate 状态；不代表任何产物被新生成或被确认。',
        }
        artifacts.push({
          id: uid('art'),
          nodeId: '',
          nodeType: 'evaluation',
          kind: 'evaluation',
          title: 'Structured · 状态评估报告',
          filename: 'workflow-status-report.json',
          summary: `状态评估 · 产物 ${stageRows.length} 项（缺 ${missing}）/ Gate ${gateRows.length} 个`,
          content: json(report),
          demo: true,
        })
        emit('complete', 'completed', '状态评估结束：已生成评估报告；没有新产物被生成、没有 Gate 被代为确认。')
      }
    } else {
      emit('accepted', 'queued', `已接收运行请求（${wf.name} · 修订 ${wf.revision}）。Prompt-first 路径无强制门。`)
      const order = topoOrder(wf)
      if (!order) {
        status = 'failed'
        emit('error', 'failed', '工作流连线存在循环或无效节点，请修正后再运行。')
      }

      /* 唯一真实的一步：把用户原文落进项目目录，建立 workflow-v0.1.1 认的创作上下文。
         没有这一步，后面所有「产物快照」都建在空地基上 —— 那套流程要读
         prompt.original.md 才有创作依据。失败要如实说失败，并继续把
         其余演示节点跑完会让用户以为上下文建好了。 */
      if (status === 'failed') {
        // Validate before initializing or changing the project.
      } else if (callbacks.projectId && (callbacks.prompt ?? '').trim()) {
        emit('progress', 'running', '正在建立 workflow-v0.1.1 创作上下文（写入 prompt.original.md）…')
        try {
          const outcome = await studioHttpApi().workflowContext.init(callbacks.projectId, callbacks.prompt)
          const state = outcome.state
          contextInfo = state
          /* 三种结果必须分开说：用户需要知道自己这句话是被当成「原始需求」记下了，
             还是因为原文已存在而记成了「纠正」，或者根本重复了没变化。
             统一显示「已就绪」会让人以为每句话都成了创作依据。 */
          if (!state.initialized) {
            emit('build', 'building', '创作上下文未建立成功：没有找到 prompt.original.md。')
          } else if (outcome.result === 'RECORDED_AS_CORRECTION') {
            emit('build', 'building', `原始需求已存在，本次要求已作为「纠正」记入 corrections.md（原文未被覆盖）。`
              + `当前 ${state.files.length} 个文件，原文 ${state.promptLength} 字。`)
          } else if (outcome.result === 'UNCHANGED') {
            emit('build', 'building', `需求与已有原文一致，上下文无变化：${state.files.length} 个文件，原文 ${state.promptLength} 字。`)
          } else {
            emit('build', 'building', `创作上下文已就绪：${state.files.length} 个文件，原文 ${state.promptLength} 字。`
              + `workflow-v0.1.1 工具${state.toolAvailable ? '可用' : '未找到（请检查配置）'}。`)
          }
        } catch (error) {
          /* 上下文没建起来就不该继续假装在创作 —— 直接失败，并说明原因。 */
          status = 'failed'
          emit('error', 'failed', `建立创作上下文失败：${error instanceof Error ? error.message : String(error)}`)
        }
      } else if (!callbacks.projectId) {
        emit('progress', 'running', '未指定项目目录：跳过创作上下文写入，仅做界面流程演示。')
      } else {
        /* 有项目但没写需求：不建立上下文，并明确告诉用户缺什么。
           以前这里会用模板占位建出一个「已就绪」，用户以为存好了原文。 */
        status = 'failed'
        emit('error', 'failed', '缺少创作需求：请先在「制作要求」里写下这次想做什么，'
          + 'workflow-v0.1.1 需要 prompt.original.md 保存你的原文，而不是模板占位。')
      }

      const runnable = status === 'failed' ? [] : (order ?? [])
      for (const node of runnable) {
        if (cancelled) {
          status = 'cancelled'
          setStatus(node.id, 'skipped')
          continue
        }
        const def = defForNode(node)
        const label = def?.label ?? node.type
        const problem = pfValidate(wf, node)
        if (problem) {
          setStatus(node.id, 'failed')
          emit('error', 'failed', problem)
          status = 'failed'
          for (const rest of runnable.slice(runnable.indexOf(node) + 1)) setStatus(rest.id, 'skipped')
          break
        }
        setStatus(node.id, 'running')

        /* 「制作与渲染」是这条路径上唯一能真的出片的节点：
           它对应 agent 改工程 + 后端渲染。其余节点（提示词、审片）
           仍是界面快照 —— 所以每个节点的日志都要分别讲清真假，
           不能笼统标成「已完成」让人以为整条链都真的跑了。 */
        if (node.type === 'create' && callbacks.projectId) {
          emit('progress', 'running', `${label}：Agent 正在读需求并修改工程…`)
          try {
            realCreationStarted = true
            const rendered = await studioHttpApi().workflowContext.create(
              callbacks.projectId,
              callbacks.prompt
                || String(wf.nodes.find((n) => n.type === 'prompt')?.params.text ?? '')
                || undefined,
              callbacks.references ?? workflowResourceReferences(wf),
            )
            callbacks.onCreateResult?.(rendered)
            /* agent 只提问、没动工程：这一轮没有产物。
               节点不能标「已完成」，否则用户以为片子做出来了；
               也不该判「失败」—— 它在正常地等用户补充信息，所以标为等待。 */
            if (rendered.state === 'awaiting_info' || !rendered.artifactPath) {
              setStatus(node.id, 'awaiting_info')
              emit('progress', 'awaiting_info',
                `${label}：等待补充信息，本轮没有渲染新片。${rendered.reply}`)
              status = 'awaiting_info'
              for (const rest of runnable.slice(runnable.indexOf(node) + 1)) setStatus(rest.id, 'skipped')
              break
            }
            createdArtifact = rendered
            const artifact: WfArtifact = {
              id: uid('art'),
              nodeId: node.id,
              nodeType: 'create',
              kind: 'render',
              title: '制作与渲染 · 真实产物',
              filename: rendered.artifactPath.split('/').pop() ?? 'film.mp4',
              summary: `真实渲染：${rendered.width}×${rendered.height} · ${rendered.durationInFrames} 帧 · 版本 v${rendered.version}`,
              content: json({
                real: true,
                artifactPath: rendered.artifactPath,
                file: studioHttpApi().artifacts.contentUrl(callbacks.projectId, rendered.artifactPath),
                version: rendered.version,
                resources: rendered.resources,
                agentReply: rendered.reply,
                agentMs: rendered.agentMs,
              }),
              demo: false,
            }
            artifacts.push(artifact)
            setStatus(node.id, 'completed')
            emit('build', 'building', `${label}：${artifact.summary}`)
            emit('progress', 'running', `Agent 说明：${rendered.reply.slice(0, 200)}`)
          } catch (error) {
            /* 真实环节失败就整条运行失败：不能因为后面还有演示节点
               就把失败咽下去 —— 用户会以为片子做出来了。 */
            const message = error instanceof Error ? error.message : String(error)
            setStatus(node.id, 'failed')
            emit('error', 'failed', `${label}失败：${message.slice(0, 300)}`)
            status = 'failed'
            for (const rest of runnable.slice(runnable.indexOf(node) + 1)) setStatus(rest.id, 'skipped')
            break
          }
          continue
        }

        if (node.type === 'delivery') {
          const rev = wf.nodes.find((n) => n.type === 'review')
          const checks = (rev?.params.checks as Record<string, unknown> | undefined) ?? {}
          const approved = checks.done === true && checks.rework !== true
          if (!approved) {
            setStatus(node.id, 'awaiting_info')
            emit('progress', 'awaiting_info', `${label}：等待审片通过后输出。`)
            status = 'awaiting_info'
            for (const rest of runnable.slice(runnable.indexOf(node) + 1)) setStatus(rest.id, 'skipped')
            break
          }
        }

        emit('progress', 'running', `${label}：开始处理（界面快照，不产出文件）。`)
        await wait(380)
        if (cancelled) {
          setStatus(node.id, 'skipped')
          status = 'cancelled'
          continue
        }
        const artifact = pfArtifact(node)
        artifacts.push(artifact)
        setStatus(node.id, 'completed')
        emit('build', 'building', `${label}：${artifact.summary}`)
      }
      if (status === 'completed') emit('complete', 'completed', createdArtifact
        ? `运行结束：已产出真实视频（版本 v${createdArtifact.version}，${createdArtifact.width}×${createdArtifact.height}）。其余节点的产物为界面快照，不代表已有对应文件。`
        : contextInfo
          ? `运行结束：已建立 workflow-v0.1.1 创作上下文（${contextInfo.files.length} 个文件），但**没有真实渲染**——「制作与渲染」节点未连到项目或未执行。`
          : '运行结束：产物均为工作稿/引用/请求记录快照；未接入真实渲染，没有视频生成。')
      if (status === 'cancelled') emit('cancelled', 'cancelled', '演示运行已取消；已生成的产物保留在本次运行记录中。')
    }
    task.status = status
    const changes: ChangeSet | null =
      artifacts.length > 0
        ? {
            taskId,
            files: artifacts.map((a) => ({
              path: `artifacts/${a.filename}`,
              summary: a.summary,
              additions: a.content.split('\n').length,
              deletions: 0,
            })),
            buildStatus: status === 'completed' ? 'passed' : status === 'awaiting_info' ? 'not-run' : 'failed',
            mock: true,
          }
        : null
    const run: WorkflowRun = {
      id: runId,
      workflowId: wf.id,
      workflowName: wf.name,
      revision: wf.revision,
      projectId: callbacks.projectId ?? null,
      nodeLabels: Object.fromEntries(wf.nodes.filter((n) => n.type !== 'lane').map((n) => [n.id, defForNode(n)?.label ?? n.type])),
      executionMode: wf.path === 'structured' ? 'evaluation' : callbacks.projectId ? 'project' : 'demo',
      status,
      task,
      events,
      artifacts,
      changes,
      nodeStatus,
      startedAt,
      finishedAt: new Date().toISOString(),
      demo: true,
    }
    const runs = loadRuns()
    runs.push(run)
    saveRuns(runs)
    return run
  })()

  // 后端创作请求尚无取消接口；离开页面不能被记录成「已经停止后端」。
  return { runId, done, cancel: () => { if (!realCreationStarted) cancelled = true } }
}

export function newUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

export function reworkSignatureOf(wf: WorkflowDef): string | null {
  const parts = wf.nodes
    .filter((n) => n.type === 'review')
    .map((n) => {
      const c = (n.params.checks as Record<string, unknown> | undefined) ?? {}
      if (c.rework !== true || c.done === true) return null
      return `${n.id}:${String(n.params.decidedAt ?? '')}:${String(n.params.issues ?? n.params.notes ?? '').trim()}`
    })
    .filter(Boolean)
  return parts.length ? parts.join('|') : null
}

export const activeGraphRuns=new Map<string,DemoRunHandle>()

export function startProjectGraph(wf:WorkflowDef,callbacks:Parameters<typeof startDemoRun>[1],resume?:WorkflowRun):DemoRunHandle {
  if(resume&&activeGraphRuns.has(resume.id))return activeGraphRuns.get(resume.id)!
  const runId=resume?.id??uid('run'),at=resume?.startedAt??new Date().toISOString()
  const fixed=structuredClone(wf)
  if(callbacks.prompt){const n=fixed.nodes.find(n=>n.type==='prompt');if(n)n.params.text=callbacks.prompt}
  if(callbacks.references){const refs=fixed.nodes.find(n=>n.type==='refs');if(refs)fixed.resourceReferences=callbacks.references}
  const cycle=extractReworkCorrection(fixed)
  const sig=reworkSignatureOf(fixed)
  const lastSubmittedSig=resume?undefined:loadRuns().find(r=>r.workflowId===wf.id&&r.submittedReworkSignature&&r.artifacts.some(a=>!a.demo))?.submittedReworkSignature
  const shouldSendCorrection=cycle.rework&&Boolean(cycle.correction)&&(resume?true:sig!==lastSubmittedSig)
  const run:WorkflowRun=resume?structuredClone(resume):{id:runId,workflowId:wf.id,workflowName:wf.name,revision:wf.revision,projectId:callbacks.projectId??null,
    executionMode:'project',nodeLabels:Object.fromEntries(wf.nodes.map(n=>[n.id,defForNode(n,{includeLegacy:true})?.label??n.type])),
    definition:fixed,engineSelection:readHarnessSelection(),nodeIO:{},nodeRequestIds:{},
    ...(shouldSendCorrection&&sig?{submittedReworkSignature:sig}:{}),
    status:'running',task:{id:runId,kind:'modify',status:'running',mock:false,title:wf.name,createdAt:at},events:[],artifacts:[],changes:null,nodeStatus:{},startedAt:at,finishedAt:null,demo:false}
  run.nodeRequestIds=run.nodeRequestIds??{}
  let cancelled=false
  let activeRequest:string|null=null
  const save=async()=>{const list=loadRuns();saveRuns([run,...list.filter(r=>r.id!==runId)]);await flushLocalDocuments()}
  const done=(async()=>{
    try{
      run.status='running';run.task.status='running';run.finishedAt=null
      await save()
      /* 先校验再动项目：图不合法（比如创作需求还是骨架原样）时，不能先把它写进 prompt.original.md。
         executeWorkflow 会再校验一次并给出失败原因。 */
      if(fixed.skillPresetId&&callbacks.projectId&&workflowGraphProblems(fixed.nodes,fixed.edges).length===0){
        const promptText=String(fixed.nodes.find(n=>n.type==='prompt')?.params.text??'').trim()
        if(promptText){
          await ensureCreationContext(callbacks.projectId,promptText,studioHttpApi().workflowContext)
        }
        const presetLabel=fixed.skillPresetMeta?.name||fixed.presetId
        let presetMessage:string
        try{
          const applied=await studioHttpApi().skillPresets.applyPresetToProject(callbacks.projectId,fixed.skillPresetId)
          presetMessage=formatApplyPresetSummary(presetLabel,applied)
        }catch(error){
          /* 视频类型归档后后端不再允许落地，但已经写进项目的指引仍然有效：给出警告、继续运行。
             其他失败（项目正在制作、网络中断）照旧中止。 */
          if(!isPresetNotActiveError(error))throw error
          const current=await studioHttpApi().skillPresets.getProjectPreset(callbacks.projectId).catch(()=>null)
          presetMessage=current?.presetId===fixed.skillPresetId
            ?`注意：视频类型「${presetLabel}」已归档，沿用项目里已有的 skill 指引继续运行。`
            :`注意：视频类型「${presetLabel}」已归档，这个项目还没有落地过它的指引，本次运行没有 skill 指引。`
        }
        const presetEvent:TaskEvent={id:uid('evt'),taskId:runId,kind:'progress',status:'running',mock:false,message:presetMessage,at:new Date().toISOString()}
        run.events.push(presetEvent);callbacks.onEvent(presetEvent)
      }
      const result=await executeWorkflow(fixed,{
        cancelled:()=>cancelled,
        completedIO:run.nodeIO,
        correction:shouldSendCorrection?cycle.correction:'',
        resourceReferences:(id)=>workflowResourceReferences({...fixed,nodes:fixed.nodes.filter(n=>n.id===id)}),
        onStatus:(id,status)=>{run.nodeStatus[id]=status;callbacks.onNodeStatus(id,status)},
        saveIO:async io=>{run.nodeIO=structuredClone(io);await save()},
        create:async(nodeId,input)=>{
          /* 每次运行都提交当前需求：后端和最近一次需求修改比较，相同不记，不同才追加到 corrections.md。
             只在未初始化时提交的话，首次运行后再改「创作需求」节点，agent 永远看不到。 */
          const context=await studioHttpApi().workflowContext.init(callbacks.projectId!,input.prompt)
          if(context.result==='RECORDED_AS_CORRECTION'){
            const event:TaskEvent={id:uid('evt'),taskId:runId,kind:'progress',status:'running',mock:false,message:'创作需求已修改，已作为纠正记入 corrections.md（原文未被覆盖）。',at:new Date().toISOString()}
            run.events.push(event);callbacks.onEvent(event)
          }
          const attemptKey=`${nodeId}:${run.nodeAttempts?.[nodeId]??0}`
          if(!run.nodeRequestIds![attemptKey]){run.nodeRequestIds![attemptKey]=newUuid();await save()}
          activeRequest=run.nodeRequestIds![attemptKey]
          const result=await submitCreation({projectId:callbacks.projectId!,requestId:activeRequest,intent:'',correction:input.correction,references:input.references as AgentReference[],selection:run.engineSelection??readHarnessSelection(),workflow:{id:fixed.id,revision:fixed.revision,nodeId,runId}},job=>{
            const event:TaskEvent={id:uid('evt'),taskId:runId,kind:'progress',status:'running',mock:false,message:`制作阶段：${job.phase}`,at:new Date().toISOString()}
            if(run.events.at(-1)?.message!==event.message){run.events.push(event);callbacks.onEvent(event)}
          })
          activeRequest=null
          callbacks.onCreateResult?.(result)
          if(result.state==='rendered'&&result.artifactPath)run.artifacts.push({id:uid('art'),nodeId,nodeType:'create',kind:'render',title:'制作与渲染',filename:result.artifactPath.split('/').pop()??'film.mp4',summary:`版本 v${result.version}`,content:JSON.stringify({...result,runId,file:studioHttpApi().artifacts.contentUrl(callbacks.projectId!,result.artifactPath)}),demo:false})
          return {...result,runId}
        },
      })
      run.nodeIO=result.nodeIO;run.status=result.status;run.task.status=result.status
      if(result.status==='awaiting_info'){
        const waitingDelivery=Object.values(result.nodeIO).find(io=>io.outputs?.status==='awaiting_review')
        if(waitingDelivery){
          const msg=String(waitingDelivery.outputs.reason||'等待审片通过')
          const e:TaskEvent={id:uid('evt'),taskId:runId,kind:'progress',status:'awaiting_info',mock:false,message:`交付：${msg}`,at:new Date().toISOString()}
          run.events.push(e);callbacks.onEvent(e)
        }
      }
      if(result.error){const e:TaskEvent={id:uid('evt'),taskId:runId,kind:'error',status:'failed',mock:false,message:result.error,at:new Date().toISOString()};run.events.push(e);callbacks.onEvent(e)}
    }catch(error){run.status='failed';run.task.status='failed';const e:TaskEvent={id:uid('evt'),taskId:runId,kind:'error',status:'failed',mock:false,message:error instanceof Error?error.message:'运行失败',at:new Date().toISOString()};run.events.push(e);callbacks.onEvent(e)}
    run.finishedAt=run.status==='running'?null:new Date().toISOString();activeGraphRuns.delete(runId);try{await save()}catch(e){callbacks.onEvent({id:uid('evt'),taskId:runId,kind:'error',status:'failed',mock:false,message:e instanceof Error?e.message:'运行记录保存未完成',at:new Date().toISOString()})}return run
  })()
  const handle={runId,done,cancel:()=>{cancelled=true;if(activeRequest)void cancelCreationJob(callbacks.projectId!,activeRequest).catch(e=>{cancelled=false;callbacks.onEvent({id:uid('evt'),taskId:runId,kind:'error',status:'failed',mock:false,message:e instanceof Error?e.message:'取消未送达，任务仍可能执行',at:new Date().toISOString()})})}}
  activeGraphRuns.set(runId,handle)
  return handle
}
