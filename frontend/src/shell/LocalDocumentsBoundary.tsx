import { Fragment, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import { initDesktopApiBase } from '../services/api'
import { initializeDocuments, documentsStatus, subscribeDocuments, flushLocalDocuments, downloadDocumentBackup, acknowledgeDocumentDifferences } from '../services/localDocuments'
import { Button } from '../components/ui/button'

export function LocalDocumentsBoundary({ children }: { children: ReactNode }) {
  const state = useSyncExternalStore(subscribeDocuments,documentsStatus,documentsStatus)
  const [error,setError]=useState('')
  const [attempt,setAttempt]=useState(0)
  useEffect(()=>{ let alive=true; void initDesktopApiBase().then(initializeDocuments).catch(e=>{if(alive)setError(e instanceof Error?e.message:'本机记录无法读取')});return()=>{alive=false} },[attempt])
  useEffect(()=>{ const warn=(e:BeforeUnloadEvent)=>{if(state.pending){e.preventDefault();e.returnValue=''}};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn) },[state.pending])
  if(!state.ready)return <div className="fm-local-gate" role={error?'alert':'status'}><h1>{error?'本机创作记录尚未载入':'正在读取本机创作记录…'}</h1>{error&&<><p>{error}</p><p>浏览器中的原记录没有被删除。连接恢复后重试。</p><Button variant="outline" onClick={downloadDocumentBackup}>导出浏览器副本</Button><Button onClick={()=>{setError('');setAttempt(n=>n+1)}}>重新读取</Button></>}</div>
  return <><Fragment key={state.epoch}>{children}</Fragment>{(state.pending>0||state.error||state.conflicts>0)&&<div className="fm-save-status" role="status">{state.error?'本机保存未完成，浏览器副本已保留。':state.pending?`正在保存 ${state.pending} 项记录…`:`发现 ${state.conflicts} 项浏览器旧副本差异，已使用本机服务记录；原副本已备份。`}{(state.error||state.conflicts>0)&&<Button variant="outline" size="sm" onClick={downloadDocumentBackup}>导出副本</Button>}{state.conflicts>0&&!state.error&&<Button size="sm" variant="ghost" onClick={acknowledgeDocumentDifferences}>知道了</Button>}{state.error&&<Button size="sm" variant="outline" onClick={()=>void flushLocalDocuments().catch(()=>{setError('');setAttempt(n=>n+1)})}>重新核对</Button>}</div>}</>
}
