import { useState } from 'react'
import { FileText, Image as ImageIcon, Music, Type, Video } from 'lucide-react'
import { ACTIVE_SCENES } from '@/data/projectModel'
import { ASSETS, type Asset } from '@/data/mock'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { ViewId } from '@/shell/views'

const KIND = {
  image: { icon: ImageIcon, label: '图片' },
  font: { icon: Type, label: '字体' },
  audio: { icon: Music, label: '音频' },
  video: { icon: Video, label: '视频' },
  doc: { icon: FileText, label: '文档' },
} as const
const FILTERS = ['all', 'image', 'font', 'audio', 'video', 'doc'] as const
const labels: Record<string, string> = { all: '全部', image: '图片', font: '字体', audio: '音频', video: '视频', doc: '文档' }

export function ContextPanel({ view }: { view: ViewId }) {
  if (view === 'production') return <ProductionContext />
  if (view === 'assets') return <AssetsContext />
  if (view === 'script') return <ScriptContext />
  if (view === 'audio') return <SimpleContext title="口播段落" items={['语速校准 · 5.15 字/秒','ASR 转写 · v1 / v2 / v3','镜头边界 · 检测器 v4']} />
  if (view === 'render') return <SimpleContext title="本地任务" items={['HyperFrames check','GitHub Actions · render-film','GitHub Actions · ASR 转写']} />
  if (view === 'knowledge') return <SimpleContext title="知识包" items={['镜头卡 · 157','审美判例 · 27','已知工程坑 · 12']} />
  return <SimpleContext title="项目内容" items={['项目文件','制作进度','素材索引']} />
}

function Shell({title,count,children}:{title:string;count?:string|number;children:React.ReactNode}) {
  return <aside className="flex w-[220px] shrink-0 flex-col border-r border-line bg-surf"><div className="panel-head">{title}<span className="num ml-auto normal-case tracking-normal">{count}</span></div>{children}</aside>
}

function ProductionContext() {
  const [tab,setTab]=useState('scenes')
  const count=tab==='scenes'?ACTIVE_SCENES.length:tab==='comp'?'30':'—'
  return <Shell title="制作素材" count={count}><Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col gap-0"><TabsList className="mx-2 mt-2"><TabsTrigger value="scenes">镜头</TabsTrigger><TabsTrigger value="comp">合成</TabsTrigger><TabsTrigger value="asset">素材</TabsTrigger></TabsList><ScrollArea className="min-h-0 flex-1"><TabsContent value="scenes" className="mt-1 px-2 pb-3"><div className="grid grid-cols-2 gap-1.5">{ACTIVE_SCENES.map(s=><div key={s.id} className="overflow-hidden rounded-sm border border-line bg-hole"><div className="aspect-video bg-bg">{s.frame?<img src={s.frame} alt="" className="size-full object-cover"/>:<span className="grid size-full place-items-center text-[8px] text-dim">未导出缩略帧</span>}</div><div className="px-1.5 py-1"><div className="truncate text-[10px]">{s.title}</div><div className="num mt-0.5 text-[8px] text-dim">{s.start.toFixed(1)}s · {s.duration.toFixed(1)}s</div></div></div>)}</div></TabsContent><TabsContent value="comp" className="mt-1 px-2 pb-3"><div className="flex flex-col gap-0.5">{Array.from({length:30},(_,i)=>{const id=`s${String(i+1).padStart(2,'0')}`;const active=ACTIVE_SCENES.some(s=>s.id===id);return <div key={id} className="flex items-center gap-2 px-1.5 py-1 text-[10px] hover:bg-soft"><FileText className="size-3 text-dim"/><span className="num">{id}.html</span><span className="ml-auto text-[8px] text-dim">{active?'已装配':'未装配'}</span></div>})}</div></TabsContent><TabsContent value="asset" className="mt-1 pb-3">{ASSETS.map(a=><AssetRow key={a.id} asset={a}/>)}</TabsContent></ScrollArea></Tabs></Shell>
}

function AssetsContext() {
  const [kind,setKind]=useState<string>('all')
  const rows=kind==='all'?ASSETS:ASSETS.filter(a=>a.kind===kind)
  return <Shell title="筛选素材" count={rows.length}><div className="flex flex-wrap gap-1 p-2">{FILTERS.map(k=><button key={k} onClick={()=>setKind(k)} className={`rounded-sm px-2 py-0.5 text-[9px] ${kind===k?'bg-acc text-white':'bg-hole text-dim hover:text-fg'}`}>{labels[k]}</button>)}</div><ScrollArea className="min-h-0 flex-1">{rows.map(a=><AssetRow key={a.id} asset={a}/>)}</ScrollArea><div className="border-t border-line p-2 text-[9px] text-dim">出處與許可需人工核實</div></Shell>
}

function ScriptContext() {
  const versions=[['SCRIPT-EP1-V3.md','当前 · 1298字'],['SCRIPT-EP1-CLEAN.md','清理版'],['SCRIPT-OPTIMIZED.md','优化版'],['SCRIPT-EP1-REWRITE.md','重写版'],['SCRIPT-REVIEW.md','审阅稿'],['SCRIPT-EP1.md','初稿']]
  return <Shell title="脚本版本" count={versions.length}><div className="flex flex-col">{versions.map(([name,detail],i)=><div key={name} className={`border-b border-line/60 px-2.5 py-2 ${i===0?'bg-acc-s':''}`}><div className="truncate text-[10px]">{name}</div><div className="mt-0.5 text-[9px] text-dim">{detail}</div></div>)}</div></Shell>
}

function SimpleContext({title,items}:{title:string;items:string[]}) { return <Shell title={title} count={items.length}><div className="flex flex-col">{items.map(x=><div key={x} className="border-b border-line/60 px-2.5 py-2 text-[10px] text-dim">{x}</div>)}</div></Shell> }
function AssetRow({asset:a}:{asset:Asset}) { const Icon=KIND[a.kind].icon; return <div className="flex items-center gap-2 px-2 py-1.5 text-[10px] hover:bg-soft"><Icon className="size-3 text-dim"/><span className="min-w-0 flex-1 truncate">{a.name}</span><Badge variant={a.commercial?'outline':'warning'} className="h-4 px-1 text-[8px]">{a.license}</Badge></div> }
