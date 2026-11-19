import { createServer } from 'vite'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
const values=new Map()
globalThis.localStorage={getItem:k=>values.get(k)??null,setItem:(k,v)=>{values.set(k,String(v));Object.defineProperty(globalThis.localStorage,k,{value:String(v),configurable:true,enumerable:true})},removeItem:k=>{values.delete(k);delete globalThis.localStorage[k]}}
const server=await createServer({root:fileURLToPath(new URL('..',import.meta.url)),server:{middlewareMode:true},appType:'custom',logLevel:'silent'})
try{
 const apiModule=await server.ssrLoadModule('/src/api/index.ts')
 apiModule.studioHttpApi().patchConfig({baseUrl:'http://127.0.0.1:45999/api'})
 const {initializeDocuments,flushLocalDocuments}=await server.ssrLoadModule('/src/shared/local-documents/localDocuments.ts')
 await initializeDocuments()
 const {setHarnessSelection}=await server.ssrLoadModule('/src/features/harness/hooks/useHarnessSelection.ts')
 setHarnessSelection({harness:'codex',model:'gpt-6.1-sol',reasoningEffort:'low'})
 const {workflowService,startDemoRun}=await server.ssrLoadModule('/src/features/workflow/services/workflowService.ts')
 const api=apiModule.studioHttpApi()
 const project=await api.projects.create({name:'端口真实提交验证'})
 const wf=workflowService.createFromPath('prompt-first','general','真实图执行-无工程验证',{projectId:project.id,seedPrompt:'不调用工具，不修改文件，只回答：收到需求，等待我继续。'})
 await flushLocalDocuments()
 const run=await startDemoRun(wf,{projectId:project.id,prompt:'不调用工具，不修改文件，只回答：收到需求，等待我继续。',onEvent:e=>{if(e.kind==='error')process.stdout.write(e.message+'\n')},onNodeStatus(){}}).done
 console.log(JSON.stringify({projectId:project.id,workflowId:wf.id,runId:run.id,status:run.status,io:Object.keys(run.nodeIO??{}),artifacts:run.artifacts.length}))
 assert.equal(run.status,'awaiting_info');assert.ok(run.nodeIO)
 const docs=await api.http.get('/local-documents');assert.ok(docs.some(d=>d.namespace==='workflow-run'&&d.id===run.id))
 await api.http.del('/projects/'+project.id)
}finally{await server.close();delete globalThis.localStorage}
