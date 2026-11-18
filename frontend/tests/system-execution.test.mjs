import assert from 'node:assert/strict'
import {before,after,test} from 'node:test'
import {createServer} from 'vite'
import {fileURLToPath} from 'node:url'
let server,executeWorkflow
before(async()=>{server=await createServer({root:fileURLToPath(new URL('..',import.meta.url)),server:{middlewareMode:true},appType:'custom',logLevel:'silent'});({executeWorkflow}=await server.ssrLoadModule('/src/services/workflowExecution.ts'))})
after(async()=>{await server.close()})
const n=(id,type,params={})=>({id,type,params,position:{x:0,y:0}})
const e=(id,source,sourcePort,target,targetPort)=>({id,source,sourcePort,target,targetPort})
test('second graph carries prompt and selected references into creation without legacy workdoc concatenation',async()=>{
 const wf={nodes:[n('p','prompt',{text:'作品需求'}),n('r','refs'),n('cap','capability'),n('c','create')],edges:[e('a','p','doc','c','prompt'),e('b','r','refs','c','refs'),e('d','cap','caps','c','caps')]}
 let sent
 const result=await executeWorkflow(wf,{resourceReferences:(id)=>id==='r'?[{kind:'asset',assetId:'a'}]:[{kind:'technique',techniqueId:'t'}],create:async(id,input)=>{sent=input;return {state:'rendered'}},saveIO:async()=>{},onStatus(){},cancelled:()=>false})
 assert.equal(result.status,'completed');assert.equal(sent.prompt,'作品需求');assert.equal(sent.correction,undefined);assert.deepEqual(sent.references,[{kind:'asset',assetId:'a'},{kind:'technique',techniqueId:'t'}]);assert.equal(result.nodeIO.c.inputs.prompt,'作品需求')
})
test('saved successful upstream IO is reused on reconnect without running creation twice',async()=>{
 const wf={nodes:[n('p','prompt',{text:'changed'}),n('c','create'),n('r','review')],edges:[e('a','p','doc','c','prompt'),e('b','c','render','r','render')]}
 let calls=0
 const result=await executeWorkflow(wf,{completedIO:{p:{label:'需求',inputs:{},outputs:{doc:'原始'}},c:{label:'制作',inputs:{prompt:'原始'},outputs:{render:{state:'rendered'}}}},resourceReferences:()=>[],create:async()=>{calls++;return {}},saveIO:async()=>{},onStatus(){},cancelled:()=>false})
 assert.equal(result.status,'completed');assert.equal(calls,0);assert.equal(result.nodeIO.r.outputs.notes.automaticallyReviewed,false)
})
test('unsupported nodes fail before any side effect and cancellation skips execution',async()=>{
 let calls=0
 const deps={resourceReferences:()=>[],create:async()=>{calls++;return {}},saveIO:async()=>{},onStatus(){},cancelled:()=>false}
 assert.equal((await executeWorkflow({nodes:[n('x','unknown')],edges:[]},deps)).status,'failed')
 assert.equal((await executeWorkflow({nodes:[n('p','prompt',{text:'需求'})],edges:[]},{...deps,cancelled:()=>true})).status,'cancelled');assert.equal(calls,0)
})

test('lost task status remains reconnectable and does not advance downstream',async()=>{
 const wf={nodes:[n('p','prompt',{text:'需求'}),n('c','create'),n('r','review')],edges:[e('a','p','doc','c','prompt'),e('b','c','render','r','render')]}
 const error=Object.assign(new Error('状态未确认'),{outcomeUnknown:true})
 const result=await executeWorkflow(wf,{resourceReferences:()=>[],create:async()=>{throw error},saveIO:async()=>{},onStatus(){},cancelled:()=>false})
 assert.equal(result.status,'running');assert.equal(result.nodeIO.r,undefined);assert.match(result.nodeIO.c.error,/未确认/)
})

test('retryable graph reruns failed node while reusing successful source IO',async()=>{
 const wf={nodes:[n('p','prompt',{text:'later edit'}),n('c','create')],edges:[e('a','p','doc','c','prompt')]}
 let got
 const result=await executeWorkflow(wf,{completedIO:{p:{label:'需求',inputs:{},outputs:{doc:'原轮次输入'}},c:{label:'制作',inputs:{prompt:'原轮次输入'},outputs:{},error:'上一轮失败'}},resourceReferences:()=>[],create:async(id,input)=>{got=input;return {state:'rendered'}},saveIO:async()=>{},onStatus(){},cancelled:()=>false})
 assert.equal(result.status,'completed');assert.equal(got.prompt,'原轮次输入')
})
