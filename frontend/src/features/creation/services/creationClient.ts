import { studioHttpApi } from '@/api'
import { stableStringify } from '@/features/chat/model/sendFingerprint'
import type { AgentReference } from '@/api/studioApi'
import type { FilmCreateResult } from '@/api/workflowContext'
export interface CreationInput {
  projectId: string; requestId: string; sessionId?: string; userMessageId?: string
  intent: string; references?: AgentReference[]; previewImage?: string; baseVersion?: number; correction?: string
  workflow?:{id:string;revision:number;nodeId:string;runId:string}
  selection?: { harness: string; model?: string; reasoningEffort?: string }
}
export interface CreationJob { projectId:string; requestId:string; sessionId:string|null; userMessageId:string|null;state:string;phase:string;result:FilmCreateResult|null;error:string|null;createdAt:string }
const inFlight=new Map<string,{ fingerprint:string; promise:Promise<FilmCreateResult> }>()
const path=(p:string)=>`/projects/${encodeURIComponent(p)}/creation-jobs`
const wait=()=>new Promise(resolve=>setTimeout(resolve,1500))
export const readCreationJob=(projectId:string,id:string)=>studioHttpApi().http.get<CreationJob>(`${path(projectId)}/${encodeURIComponent(id)}`)
export const listCreationJobs=(projectId:string)=>studioHttpApi().http.get<CreationJob[]>(path(projectId))
export const cancelCreationJob=(projectId:string,id:string)=>studioHttpApi().http.post<CreationJob>(`${path(projectId)}/${encodeURIComponent(id)}/cancel`,{})
export class CreationOutcomeUnknown extends Error { readonly outcomeUnknown=true }

/** Exact request identities survive connection loss. Never silently fall back to legacy POST. */
export function submitCreation(input:CreationInput,onState?:(job:CreationJob)=>void):Promise<FilmCreateResult>{
  if(!input.requestId) return Promise.reject(new Error('制作请求缺少身份，请重新提交。'))
  const fingerprint=stableStringify(input), id=`${input.projectId}:${input.requestId}`, existing=inFlight.get(id)
  if(existing)return existing.fingerprint===fingerprint?existing.promise:Promise.reject(new Error('这次请求身份已用于不同内容，请重新提交。'))
  const promise=(async():Promise<FilmCreateResult>=>{
    const body={workflow:input.workflow,intent:input.intent,...input.selection,references:input.references,previewImage:input.previewImage,baseVersion:input.baseVersion,correction:input.correction,requestId:input.requestId,sessionId:input.sessionId,userMessageId:input.userMessageId}
    let job:CreationJob
    try{job=await studioHttpApi().http.post<CreationJob>(path(input.projectId),body)}
    catch(error){
      // POST may have reached the server even if its response was lost. Query, don't re-run.
      try{job=await readCreationJob(input.projectId,input.requestId)}catch{
        const code=(error as {code?:string}).code
        if(['validation_error','task_idempotency_conflict','project_busy'].includes(code??''))throw error
        throw new CreationOutcomeUnknown('制作请求是否送达尚未确认，原请求已保留。恢复连接后接回此轮，勿重复制作。')
      }
    }
    for(let i=0;i<1200;i++){
      if(job.projectId!==input.projectId||job.requestId!==input.requestId||input.sessionId&&job.sessionId!==input.sessionId||input.userMessageId&&job.userMessageId!==input.userMessageId)throw new Error('制作返回的项目或会话身份不匹配，已停止接收。')
      onState?.(job)
      if(job.state==='rendered'||job.state==='awaiting_info'){
        if(!job.result)throw new Error('制作结果尚未读取完整，请稍后重新读取原任务。')
        return job.result
      }
      if(job.state==='failed'||job.state==='interrupted'||job.state==='cancelled')return {state:'failed',reply:job.error??'制作中断，请核对工程后重试',agentMs:0,artifactPath:null,version:null,durationInFrames:0,width:0,height:0,fps:0,resources:[],requestId:input.requestId,userMessageId:input.userMessageId}
      await wait();
      try{job=await readCreationJob(input.projectId,input.requestId)}catch{throw new CreationOutcomeUnknown('制作仍可能在后台执行，暂时读不到状态。请恢复连接后接回原运行。')}
    }
    throw new CreationOutcomeUnknown('制作仍未确认结束，请在项目里重新读取原任务，不要重复提交。')
  })().finally(()=>inFlight.delete(id))
  inFlight.set(id,{fingerprint,promise});return promise
}
