import type { WorkflowDef } from './workflowService'
import { defForNode } from '../data/workflowTemplates'
import { workflowGraphProblems } from './workflowGraph'

export interface NodeOutput { [port: string]: unknown }
export interface NodeIO { label:string; inputs:Record<string,unknown>; outputs:NodeOutput; error?:string }
export interface ExecutionResult { nodeIO:Record<string,NodeIO>; status:'completed'|'awaiting_info'|'failed'|'cancelled'|'running'; error?:string }
const SUPPORTED=new Set(['prompt','refs','lookdev','filmplan','capability','create','review','finishing'])
/** Deterministic port-driven executor. Work documents are inputs, not fabricated AI output. */
export async function executeWorkflow(wf:WorkflowDef,deps:{
  resourceReferences:(nodeId:string)=>unknown[]
  create:(nodeId:string,input:{intent:string;references:unknown[]})=>Promise<unknown>
  saveIO:(nodeIO:Record<string,NodeIO>)=>Promise<void>
  onStatus:(id:string,status:'running'|'completed'|'failed'|'skipped'|'awaiting_info')=>void
  cancelled:()=>boolean
  completedIO?:Record<string,NodeIO>
}):Promise<ExecutionResult>{
  const nodeIO:Record<string,NodeIO>=structuredClone(deps.completedIO??{})
  const problems=workflowGraphProblems(wf.nodes,wf.edges)
  if(problems.length)return {nodeIO,status:'failed',error:problems[0].message}
  for(const n of wf.nodes)if(!SUPPORTED.has(n.type))return {nodeIO,status:'failed',error:`节点「${n.type}」尚无实际执行器`}
  const remaining=new Map(wf.nodes.filter(n=>!nodeIO[n.id]||nodeIO[n.id].error||!Object.keys(nodeIO[n.id].outputs).length).map(n=>[n.id,n]))
  while(remaining.size){
    if(deps.cancelled())return {nodeIO,status:'cancelled'}
    const node=[...remaining.values()].find(n=>wf.edges.filter(e=>e.target===n.id).every(e=>nodeIO[e.source]))
    if(!node)return {nodeIO,status:'failed',error:'连接存在循环或缺少上游结果'}
    remaining.delete(node.id)
    const inputs:Record<string,unknown>={}
    for(const e of wf.edges.filter(e=>e.target===node.id)){
      const value=nodeIO[e.source]?.outputs[e.sourcePort]
      if(value===undefined)return {nodeIO,status:'failed',error:`节点「${node.type}」的输入 ${e.targetPort} 没有上游输出`}
      inputs[e.targetPort]=value
    }
    const label=defForNode(node)?.label??node.type
    nodeIO[node.id]={label,inputs,outputs:{}}
    deps.onStatus(node.id,'running')
    try{
      const p=node.params
      let outputs:NodeOutput
      if(node.type==='prompt')outputs={doc:String(p.text??'')}
      else if(node.type==='refs')outputs={refs:deps.resourceReferences(node.id)}
      else if(node.type==='lookdev'||node.type==='filmplan'){
        const text=Object.values(p).filter(v=>typeof v==='string'&&v.trim()).join('\n')
        outputs={doc:[inputs.prompt,inputs.look,text].filter(Boolean).join('\n\n')}
      }else if(node.type==='capability')outputs={caps:deps.resourceReferences(node.id)}
      else if(node.type==='create'){
        const refs=[inputs.refs,inputs.caps].flatMap(v=>Array.isArray(v)?v:[])
        const intent=[inputs.prompt,inputs.look,inputs.plan].filter(v=>typeof v==='string'&&v.trim()).join('\n\n')
        const result=await deps.create(node.id,{intent,references:refs}) as {state:string;reply?:string;artifactPath?:string}
        outputs={render:result}
        if(result.state==='failed')throw new Error(result.reply||'制作失败')
        if(result.state==='awaiting_info'){
          nodeIO[node.id].outputs=outputs;deps.onStatus(node.id,'awaiting_info');await deps.saveIO(nodeIO)
          for(const n of remaining.values())deps.onStatus(n.id,'skipped')
          return {nodeIO,status:'awaiting_info'}
        }
      }else if(node.type==='review')outputs={notes:{render:inputs.render,notes:p.issues??p.notes??'',answers:p.checks??p.answers??{},automaticallyReviewed:false}}
      else outputs={render:inputs.render,notes:inputs.notes??null,polished:false}
      nodeIO[node.id].outputs=outputs;deps.onStatus(node.id,'completed');await deps.saveIO(nodeIO)
    }catch(error){
      if((error as {outcomeUnknown?:boolean}).outcomeUnknown){nodeIO[node.id].error=error instanceof Error?error.message:'结果未确认';await deps.saveIO(nodeIO);return {nodeIO,status:'running',error:nodeIO[node.id].error}}
      if(deps.cancelled()){nodeIO[node.id].error='制作已取消';deps.onStatus(node.id,'skipped');await deps.saveIO(nodeIO);return {nodeIO,status:'cancelled'}}
      nodeIO[node.id].error=error instanceof Error?error.message:'执行失败';deps.onStatus(node.id,'failed');await deps.saveIO(nodeIO)
      for(const n of remaining.values())deps.onStatus(n.id,'skipped')
      return {nodeIO,status:'failed',error:nodeIO[node.id].error}
    }
  }
  return {nodeIO,status:'completed'}
}
