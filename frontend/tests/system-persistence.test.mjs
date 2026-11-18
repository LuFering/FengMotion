import assert from 'node:assert/strict'
import {before,after,test} from 'node:test'
import {createServer} from 'vite'
import {fileURLToPath} from 'node:url'
let server,api,store,client
const values=new Map()
globalThis.localStorage={getItem:k=>values.get(k)??null,setItem:(k,v)=>{values.set(k,String(v));Object.defineProperty(globalThis.localStorage,k,{value:String(v),configurable:true,enumerable:true})},removeItem:k=>{values.delete(k);delete globalThis.localStorage[k]}}
before(async()=>{server=await createServer({root:fileURLToPath(new URL('..',import.meta.url)),server:{middlewareMode:true},appType:'custom',logLevel:'silent'});api=(await server.ssrLoadModule('/src/services/api/index.ts')).studioHttpApi();store=await server.ssrLoadModule('/src/services/localDocuments.ts');client=await server.ssrLoadModule('/src/services/creationClient.ts')})
after(async()=>{await server.close();delete globalThis.localStorage})
test('lost POST response queries the same durable job rather than starting a second creation',async()=>{
 let posts=0,gets=0
 const input={projectId:'p',requestId:'r',sessionId:'s',userMessageId:'u',intent:'需求'}
 const job={...input,state:'rendered',phase:'completed',result:{state:'rendered',reply:'OK',artifactPath:'a.mp4',version:1},error:null}
 api.http.post=async()=>{posts++;throw new Error('响应丢失')};api.http.get=async()=>{gets++;return job}
 assert.equal((await client.submitCreation(input)).version,1);assert.equal(posts,1);assert.equal(gets,1)
})
test('duplicate in-flight identity reuses promise; changed request and wrong session are refused',async()=>{
 let finish
 api.http.post=()=>new Promise(r=>{finish=r})
 const input={projectId:'p',requestId:'dup',intent:'原文',sessionId:'s'}
 const first=client.submitCreation(input),second=client.submitCreation(input)
 assert.equal(first,second)
 await assert.rejects(client.submitCreation({...input,intent:'变更'}),/不同内容/)
 finish({projectId:'p',requestId:'dup',sessionId:'wrong',state:'rendered',result:{state:'rendered'}})
 await assert.rejects(first,/身份不匹配/)
})
test('persistent writes retain revision and only confirm after service response',async()=>{
 const remote=[];let calls=0
 api.http.get=async()=>remote
 api.http.put=async(path,body)=>{calls++;const [ns,id]=path.split('/').slice(-2);const row={namespace:ns,id:decodeURIComponent(id),revision:body.expectedRevision+1,...body};remote.push(row);return row}
 await store.initializeDocuments()
 store.persistLocalDocument('fm-workflows-v2',[{id:'w',name:'第一次',projectId:'p'}]);await store.flushLocalDocuments()
 store.persistLocalDocument('fm-workflows-v2',[{id:'w',name:'第二次',projectId:'p'}]);await store.flushLocalDocuments()
 assert.equal(calls,2);assert.equal(remote.at(-1).revision,2);assert.equal(store.documentsStatus().pending,0)
 api.http.put=async()=>{throw new Error('版本冲突')}
 store.persistLocalDocument('fm-workflows-v2',[{id:'w',name:'本地未保存',projectId:'p'}])
 await assert.rejects(store.flushLocalDocuments(),/版本冲突/);assert.match(store.documentsStatus().error,/版本冲突/)
})

test('hydrate restores server records while preserving conflicting browser originals',async()=>{
 // Clear previous intentional error, then rehydrate the service-side winner.
 const remote=[{namespace:'workflow',id:'conflict',projectId:'p',revision:4,data:{id:'conflict',name:'服务端版本',projectId:'p'},deleted:false,updatedAt:new Date().toISOString()}]
 localStorage.setItem('fm-workflows-v2',JSON.stringify([{id:'conflict',name:'浏览器未同步版本',projectId:'p'}]))
 api.http.get=async()=>remote
 await store.initializeDocuments()
 assert.equal(JSON.parse(localStorage.getItem('fm-workflows-v2'))[0].name,'服务端版本')
 const backupKey=localStorage.getItem('fengmotion:local-document-backup:latest')
 assert.match(localStorage.getItem(backupKey),/浏览器未同步版本/)
 assert.equal(store.documentsStatus().conflicts,1)
})

test('unsynced cache with matching last-confirmed revision uploads after reload',async()=>{
 const before={id:'recover',name:'已确认',projectId:'p'},next={...before,name:'刷新前编辑'}
 localStorage.setItem('fm-workflows-v2',JSON.stringify([next]))
 localStorage.setItem('fengmotion:document-sync:workflow:recover',JSON.stringify({revision:7,data:before,deleted:false}))
 const remote=[{namespace:'workflow',id:'recover',projectId:'p',revision:7,data:before,deleted:false,updatedAt:new Date().toISOString()}]
 api.http.get=async()=>remote;let uploaded
 api.http.put=async(path,body)=>{uploaded=body;return {...remote[0],revision:8,data:body.data}}
 await store.initializeDocuments();assert.equal(uploaded.expectedRevision,7);assert.equal(uploaded.data.name,'刷新前编辑');assert.equal(JSON.parse(localStorage.getItem('fm-workflows-v2'))[0].name,'刷新前编辑')
})
