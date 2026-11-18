import { studioHttpApi } from './api'

type Document = { namespace: string; id: string; projectId: string | null; revision: number; data: unknown; deleted: boolean; updatedAt: string }
type Status = { ready: boolean; pending: number; error: string; conflicts:number; epoch:number }
const rows = new Map<string, Document>()
const listeners = new Set<() => void>()
let status: Status = { ready: false, pending: 0, error: '', conflicts:0, epoch:0 }
let chain = Promise.resolve()
const baselineMembers=new Map<string,Set<string>>()
const key = (namespace: string, id: string) => `${namespace}:${id}`
export const subscribeDocuments = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn) } }
export const documentsStatus = () => status
export function acknowledgeDocumentDifferences(){emit({conflicts:0})}
function emit(patch: Partial<Status>) { status = { ...status, ...patch }; listeners.forEach((fn) => fn()) }
export const readLocalJson = <T,>(storageKey: string, fallback: T): T => { try { return JSON.parse(localStorage.getItem(storageKey) ?? 'null') ?? fallback } catch { return fallback } }

function binding(storageKey: string): { namespace: string; projectId: string | null; array: boolean } | null {
  if (storageKey === 'fm-workflow-versions-v1') return { namespace: 'workflow-version', projectId: null, array: true }
  if (storageKey === 'fm-workflows-v2') return { namespace: 'workflow', projectId: null, array: true }
  if (storageKey === 'fm-workflow-runs-v2') return { namespace: 'workflow-run', projectId: null, array: true }
  for (const [prefix, namespace, array] of [
    ['fengmotion:review:v1:', 'review', false],
    ['fengmotion:scene-documents:v1:', 'editor-document', true],
    ['fengmotion:editor-renders:', 'editor-render', true],
  ] as const) if (storageKey.startsWith(prefix)) return { namespace, projectId: storageKey.slice(prefix.length), array }
  return null
}
function storageKey(row: Document) {
  if (row.namespace === 'workflow-version') return 'fm-workflow-versions-v1'
  if (row.namespace === 'workflow') return 'fm-workflows-v2'
  if (row.namespace === 'workflow-run') return 'fm-workflow-runs-v2'
  const prefix: Record<string,string> = { review:'fengmotion:review:v1:', 'editor-document':'fengmotion:scene-documents:v1:', 'editor-render':'fengmotion:editor-renders:' }
  return `${prefix[row.namespace]}${row.projectId}`
}
async function put(namespace: string, id: string, projectId: string | null, data: unknown, deleted = false) {
  const before = rows.get(key(namespace, id))
  const row = await studioHttpApi().http.put<Document>(`/local-documents/${namespace}/${encodeURIComponent(id)}`, { projectId, expectedRevision: before?.revision ?? 0, data, deleted })
  rows.set(key(namespace,id), row)
  localStorage.setItem(`fengmotion:document-sync:${namespace}:${id}`,JSON.stringify({revision:row.revision,data:row.data,deleted:row.deleted}))
}

/** Browser cache stays as a recoverable copy; conflicting local content is never uploaded over the server. */
let initializing:Promise<void>|null=null
export function initializeDocuments() {
  if(initializing)return initializing
  initializing=hydrate().finally(()=>{initializing=null})
  return initializing
}
async function hydrate() {
  emit({ error:'', ready:false })
  const remote = await studioHttpApi().http.get<Document[]>('/local-documents')
  rows.clear(); remote.forEach((row) => rows.set(key(row.namespace,row.id),row))
  const keys = Object.keys(localStorage).filter((name) => binding(name))
  const local = keys.map((name) => ({ name, bind:binding(name)!, value:readLocalJson<unknown>(name,null) }))
  // Before migration preserve an exact original export, including conflicting browser data.
  const backup=JSON.stringify(Object.fromEntries(local.map((x)=>[x.name,x.value])))
  const previousBackup=localStorage.getItem('fengmotion:local-document-backup:latest')
  if(!previousBackup || localStorage.getItem(previousBackup)!==backup){
    const backupName=`fengmotion:local-document-backup:v1:${Date.now()}`
    localStorage.setItem(backupName,backup)
    localStorage.setItem('fengmotion:local-document-backup:latest',backupName)
  }
  let conflicts=0
  for (const { bind, value } of local) {
    const values = bind.array ? Array.isArray(value) ? value : [] : value ? [value] : []
    for (const data of values) {
      const id = bind.array ? String(data.id ?? '') : bind.projectId!
      if(!id)continue
      const remote=rows.get(key(bind.namespace,id))
      if(remote){
        if(remote.deleted||JSON.stringify(remote.data)!==JSON.stringify(data)){
          const last=readLocalJson<{revision:number;data:unknown} | null>(`fengmotion:document-sync:${bind.namespace}:${id}`,null)
          if(!remote.deleted && last?.revision===remote.revision && JSON.stringify(last.data)===JSON.stringify(remote.data))await put(bind.namespace,id,bind.projectId??data.projectId??null,data)
          else conflicts++
        }
        continue
      }
      await put(bind.namespace,id,bind.projectId ?? data.projectId ?? null,data)
    }
  }
  const groups = new Map<string, Document[]>()
  for (const row of rows.values()) { const name=storageKey(row); groups.set(name,[...(groups.get(name) ?? []),row]) }
  for (const name of keys) if (!groups.has(name)) groups.set(name,[])
  for (const [name, docs] of groups) {
    const bind=binding(name); if(!bind)continue; const alive=docs.filter((x)=>!x.deleted)
    localStorage.setItem(name,JSON.stringify(bind.array ? alive.map((x)=>x.data) : alive[0]?.data ?? null))
    for(const row of docs)localStorage.setItem(`fengmotion:document-sync:${row.namespace}:${row.id}`,JSON.stringify({revision:row.revision,data:row.data,deleted:row.deleted}))
  }
  baselineMembers.clear()
  for(const [name,docs] of groups)baselineMembers.set(name,new Set(docs.filter(d=>!d.deleted).map(d=>d.id)))
  emit({ready:true,error:'',conflicts,epoch:status.epoch+1})
}

/** Called after a successful cache write. Sequential writes use the latest confirmed revision. */
export function persistLocalDocument(storageKey: string, value: unknown) {
  if (!status.ready) return
  if(status.error) {emit({error:'本机保存尚有冲突或错误，新增修改仍留在浏览器。请导出副本后重新核对。'});return}
  const bind = binding(storageKey); if (!bind) return
  const snapshot = structuredClone(value)
  emit({ pending:status.pending+1 })
  chain = chain.then(async () => {
    if(status.error)throw new Error(status.error)
    const values = bind.array ? Array.isArray(snapshot) ? snapshot : [] : [snapshot]
    const present=new Set<string>()
    for (const data of values) {
      if (!data) continue
      const id=bind.array ? String(data.id ?? '') : bind.projectId!
      if (!id) continue
      present.add(id)
      const old=rows.get(key(bind.namespace,id))
      if (old && !old.deleted && JSON.stringify(old.data)===JSON.stringify(data)) continue
      await put(bind.namespace,id,bind.projectId ?? data.projectId ?? null,data)
    }
    if (bind.array && ['workflow','editor-document'].includes(bind.namespace)) for (const row of [...rows.values()]) {
      if (row.namespace===bind.namespace && (bind.projectId===null || row.projectId===bind.projectId) && !row.deleted && baselineMembers.get(storageKey)?.has(row.id) && !present.has(row.id)) await put(row.namespace,row.id,row.projectId,row.data,true)
    }
    baselineMembers.set(storageKey,present)
  }).catch((error) => { emit({error:error instanceof Error?error.message:'本机记录保存失败，浏览器备份仍保留。'}) })
    .finally(() => emit({pending:Math.max(0,status.pending-1)}))
}
export async function flushLocalDocuments() { await chain; if (status.error) throw new Error(status.error) }

export function downloadDocumentBackup(){
  const latest=localStorage.getItem('fengmotion:local-document-backup:latest')
  const data={current:Object.fromEntries(Object.keys(localStorage).filter(k=>binding(k)).map(k=>[k,readLocalJson(k,null)])),beforeMigration:latest?readLocalJson(latest,null):null}
  const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}))
  const a=document.createElement('a');a.href=url;a.download='FengMotion-创作记录备份.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),30000)
}
