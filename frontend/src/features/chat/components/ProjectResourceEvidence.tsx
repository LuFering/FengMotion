import { useEffect, useState } from 'react'
import { studioHttpApi } from '@/api'
import { listCreationJobs } from '@/features/creation/services/creationClient'
const usageLabel:Record<string,string>={unspecified:'未指定用途',reference:'作为参考',visual:'用于画面',audio:'作为音频',information:'提供信息',apply:'按技法实现'}
export function ProjectResourceEvidence({projectId}:{projectId:string}){
  const [rows,setRows]=useState<Array<{requestId:string;state:string;version?:number;resolved:Array<{kind:string;id:string;label:string;usage:string;version?:string;sourceUrl?:string;license?:string}>}>>([])
  const [error,setError]=useState('')
  useEffect(()=>{let alive=true;void listCreationJobs(projectId).then(jobs=>Promise.all(jobs.map(j=>studioHttpApi().http.get<typeof rows[number]>(`/projects/${encodeURIComponent(projectId)}/creation-jobs/${encodeURIComponent(j.requestId)}/resources`)))).then(result=>{if(alive)setRows(result.filter(r=>r.resolved?.length))}).catch(e=>{if(alive)setError(e instanceof Error?e.message:'引用记录未能读取')});return()=>{alive=false}},[projectId])
  return <details className="project-resource-evidence"><summary>本项目资源引用记录{rows.length?` · ${rows.length} 轮`:''}</summary><p>这里只核对已送达并解析的资源。是否实际用于成片，需要对照工程或画面确认。</p>{error&&<p role="alert">{error}</p>}{!error&&!rows.length&&<p>暂无可核对的资源引用记录。</p>}{rows.map((r,i)=><div key={r.requestId}><b>{r.version?`产出 v${r.version}`:`制作记录 ${i+1}`} · {r.state==='rendered'?'已生成版本':r.state==='awaiting_info'?'未生成新版本':r.state}</b><ul>{r.resolved.map((x,index)=><li key={`${x.kind}:${x.id}:${index}`}>{x.label}{x.version?` · ${x.version}`:''}{x.license?` · ${x.license}`:''} · {usageLabel[x.usage]??x.usage}</li>)}</ul></div>)}</details>
}
