import { useEffect, useState } from 'react'
import { UiIcon, SemIcons } from '@/components/icons/UiIcon'
import { MessageSquare01 } from '@untitledui/icons'
import type { ProjectSummary } from '../data/projects'
import { studioHttpApi } from '../services/api'
import { listCreationJobs, type CreationJob } from '../services/creationClient'
import { Button } from '../components/ui/button'
import '../styles/projects-home.css'

type Snapshot={version:number|null;job:CreationJob|null;error:string;poster?:string;requestError?:string}
const status=(s:Snapshot|undefined)=>s?.job?.state==='running'||s?.job?.state==='accepted'||s?.job?.state==='cancelling'?'正在制作':s?.job?.state==='failed'||s?.job?.state==='interrupted'?'需要处理':s?.version?'可继续创作':'尚未制作'
export function ProjectsHome({projects,loading,error,onRefresh,onCreate,onOpen,onChat,embedded=false}:{projects:ProjectSummary[];loading:boolean;error:string|null;onRefresh:()=>void;onCreate:()=>Promise<unknown>;onOpen:(id:string,mode:'conversation'|'production')=>void;onChat:()=>void;embedded?:boolean}){
  const [q,setQ]=useState(''),[creating,setCreating]=useState(false),[failure,setFailure]=useState('')
  const [failedCovers,setFailedCovers]=useState<Set<string>>(new Set())
  const [states,setStates]=useState<Record<string,Snapshot>>({})
  const ids=projects.map(p=>p.id).join(',')
  useEffect(()=>{
    let alive=true
    let fetching=false
    const read=async()=>{if(fetching||document.hidden)return;fetching=true;const results=await Promise.all(projects.map(async p=>{
      try{const [scene,jobs]=await Promise.all([studioHttpApi().task.currentScene(p.id),listCreationJobs(p.id)]);const job=jobs.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).find(j=>j.state==='running'||j.state==='accepted'||j.state==='cancelling')??jobs[0]??null;return [p.id,{version:scene.initialized?scene.version:null,job,error:'',poster:scene.initialized?`${studioHttpApi().config.baseUrl}/projects/${encodeURIComponent(p.id)}/poster?version=${scene.version}`:undefined}] as const}
      catch(e){return [p.id,{version:null,job:null,error:e instanceof Error?e.message:'状态读取失败'}] as const}
    }));if(alive)setStates(Object.fromEntries(results));fetching=false}
    void read(); const timer=setInterval(()=>void read(),7000);const visible=()=>{if(!document.hidden)void read()};document.addEventListener('visibilitychange',visible)
    return()=>{alive=false;clearInterval(timer);document.removeEventListener('visibilitychange',visible)}
  // IDs control the scope; titles update separately through props.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[ids])
  const filtered=projects.filter(p=>`${p.name} ${p.tagline}`.toLowerCase().includes(q.toLowerCase()))
  return <section className={`ph-page${embedded?' ph-page-embedded':''}`} aria-label="我的创作项目">
    <header><div><h1>{embedded?'全部项目':'我的创作'}</h1></div><div><Button variant="outline" onClick={onChat}><UiIcon icon={MessageSquare01} size="sm" />{embedded?'返回对话':'直接进入对话'}</Button><Button disabled={creating} onClick={()=>{setCreating(true);setFailure('');void onCreate().catch(e=>setFailure(e instanceof Error?e.message:'创建失败')).finally(()=>setCreating(false))}}><UiIcon icon={SemIcons.folder} size="sm" />{creating?'正在创建…':'新建项目'}</Button></div></header>
    <div className="ph-tools"><label><UiIcon icon={SemIcons.search} size="sm" /><input value={q} onChange={e=>setQ(e.target.value)} aria-label="搜索项目" placeholder="搜索项目"/></label><button type="button" onClick={onRefresh} aria-label="刷新项目"><UiIcon icon={SemIcons.refresh} size="md" /></button><span>{projects.length} 个项目</span></div>
    {(error||failure)&&<p role="alert">{error||failure}<button type="button" onClick={onRefresh}>重试读取</button></p>}
    {loading&&!projects.length?<p role="status">正在读取项目…</p>:!filtered.length?<div className="ph-empty"><UiIcon icon={SemIcons.film} size="xl" /><h2>{q?'没有找到这个项目':'从你的第一个作品开始'}</h2>{q && <p>换个名称试试。</p>}</div>:<div className="ph-grid">{filtered.map(p=>{
      const s=states[p.id]
      return <article key={p.id} className="ph-card"><button className="ph-cover" type="button" onClick={()=>onOpen(p.id,s?.version?'production':'conversation')} aria-label={`打开项目：${p.name}`}>{(p.cover||s?.poster)&&!failedCovers.has(`${p.id}:${s?.version}`)?<img src={p.cover||s?.poster} alt="" loading="lazy" onError={()=>setFailedCovers(prev=>new Set([...prev,`${p.id}:${s?.version}`]))}/>:<UiIcon icon={SemIcons.film} size="xl" />}<span>{s?.error?'状态未确认':!s?'读取状态…':status(s)}</span></button><div className="ph-copy"><h2 title={p.name}>{p.name}</h2><p title={s?.job?.error??p.tagline}>{s?.job?.state==='failed'||s?.job?.state==='interrupted'?s.job.error||'上次制作未完成':p.tagline|| (s?.version?`当前工程 v${s.version}`:'写下需求，开始制作')}</p><div><time dateTime={p.updatedAt}>{new Date(p.updatedAt).toLocaleDateString('zh-CN')}</time><button type="button" onClick={()=>onOpen(p.id,s?.version?'production':'conversation')}>继续创作<UiIcon icon={SemIcons.forward} size="sm" /></button>{s?.version&&<button type="button" aria-label={`预览 ${p.name}`} onClick={()=>onOpen(p.id,'production')}><UiIcon icon={SemIcons.play} size="sm" /></button>}</div></div></article>
    })}</div>}
  </section>
}
