import { useEffect, useMemo, useState } from 'react'
import { Image as ImageIcon, Film, Sparkles, Plus } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { studioHttpApi } from '@/services/api'
import type { AgentReference } from '@/services/studioApi'

/**
 * 从资源库引用：把素材 / 参考片 / 特效交给 agent 时，顺手说清怎么用。
 *
 * 为什么必须在这里问用途：同一个素材，用户可能是要「放进画面」，
 * 也可能只是「参考它的风格」。只传一个 ID，agent 只能猜；
 * 猜错的结果是画面里出现了本不该出现的素材。参考片还要说清
 * 「看哪一段」与「借鉴什么、避开什么」，特效要说清「照着做」还是「只作参考」。
 *
 * 选完不会自动发送：只是把引用挂到这一轮的意见上，用户仍要写一句要求再提交。
 * 选资源不等于提要求，混在一起会让人不知道这轮到底让它干什么。
 */

/** 素材用途；与后端 ResourceContextBuilder 的取值一致。 */
const ASSET_PURPOSES = [
  { value: 'visual', label: '用作画面', hint: '应出现在成片里' },
  { value: 'reference', label: '仅参考风格', hint: '不要放进成片' },
  { value: 'audio', label: '用作音频', hint: '配乐或音效' },
  { value: 'information', label: '仅作资料', hint: '不要出现在画面' },
] as const

interface AssetRow { id: string; name: string; mimeType?: string; mediaType?: string }
interface VideoRow { id: string; title: string; segmentCount?: number }
interface SegmentRow { id: string; videoId: string; index: number; startMs: number; endMs: number; observation?: string }
interface TechniqueRow { id: string; name: string; categoryLabel?: string }

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`
}

export function ResourcePicker({
  open,
  onOpenChange,
  onAdd,
}: {
  open: boolean
  onOpenChange: (next: boolean) => void
  /** 用户确认一项资源后回调；调用方负责去重与挂到引用列表 */
  onAdd: (ref: AgentReference) => void
}) {
  const [kind, setKind] = useState<'asset' | 'reference' | 'technique'>('asset')
  const [assets, setAssets] = useState<AssetRow[]>([])
  const [videos, setVideos] = useState<VideoRow[]>([])
  const [techniques, setTechniques] = useState<TechniqueRow[]>([])
  const [segments, setSegments] = useState<SegmentRow[]>([])
  const [activeVideo, setActiveVideo] = useState('')
  const [error, setError] = useState('')

  /* 素材用途与说明 */
  const [purpose, setPurpose] = useState<'visual' | 'reference' | 'audio' | 'information'>('visual')
  const [note, setNote] = useState('')
  /* 参考片：借鉴什么 / 避开什么 */
  const [wants, setWants] = useState('')
  /* 默认留空而不是预填一句「不要使用原片的画面」：预填后用户再输一句就成了两句拼接，
     上下文里会重复。后端在没有 avoid 时也会自己写明「不要直接使用它的画面」。 */
  const [avoid, setAvoid] = useState('')
  /* 特效：照着做还是只作参考 */
  const [fxIntent, setFxIntent] = useState<'apply' | 'reference'>('reference')

  const api = studioHttpApi()

  useEffect(() => {
    if (!open) return
    let active = true
    setError('')
    const load = async () => {
      try {
        if (kind === 'asset') {
          const page = await api.assets.list({ limit: 100 })
          if (active) setAssets((page.items ?? []) as AssetRow[])
        } else if (kind === 'reference') {
          const list = await api.library.reference.listVideos()
          if (active) setVideos(list as VideoRow[])
        } else {
          const page = await api.library.fx.listTechniques({ limit: 100 })
          if (active) setTechniques((page.items ?? []) as TechniqueRow[])
        }
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : String(cause))
      }
    }
    void load()
    return () => { active = false }
  }, [kind, open, api])

  /* 选中视频后再读它的片段：只有片段能表达「哪一段」 */
  useEffect(() => {
    if (!activeVideo) { setSegments([]); return }
    let active = true
    void api.library.reference.listSegments({ videoId: activeVideo })
      .then((rows) => { if (active) setSegments(rows as SegmentRow[]) })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : String(cause)) })
    return () => { active = false }
  }, [activeVideo, api])

  const videoTitle = useMemo(
    () => videos.find((v) => v.id === activeVideo)?.title ?? '',
    [videos, activeVideo],
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="t-head">从资源库引用</DialogTitle>
        </DialogHeader>

        {error && <p className="t-meta text-danger">{error}</p>}

        <Tabs value={kind} onValueChange={(v) => { setKind(v as typeof kind); setActiveVideo('') }}>
          <TabsList>
            <TabsTrigger value="asset"><ImageIcon className="size-3.5" /> 素材</TabsTrigger>
            <TabsTrigger value="reference"><Film className="size-3.5" /> 参考片</TabsTrigger>
            <TabsTrigger value="technique"><Sparkles className="size-3.5" /> 特效</TabsTrigger>
          </TabsList>

          {/* 素材：先选用途，再选素材 */}
          <TabsContent value="asset" className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <span className="t-meta">用途</span>
              <ToggleGroup type="single" value={purpose} onValueChange={(v) => v && setPurpose(v as typeof purpose)} className="flex-wrap">
                {ASSET_PURPOSES.map((p) => (
                  <ToggleGroupItem key={p.value} value={p.value} className="h-auto flex-col items-start gap-0 px-3 py-1.5">
                    <span className="t-body">{p.label}</span>
                    <span className="t-dim text-muted-foreground">{p.hint}</span>
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </div>
            <Input placeholder="补充说明（可选）" value={note} onChange={(e) => setNote(e.target.value)} />
            <ScrollArea className="h-64">
              <div className="flex flex-col gap-1 pr-3">
                {assets.length === 0 && <p className="t-meta text-muted-foreground">素材库还没有内容</p>}
                {assets.map((a) => (
                  <Button key={a.id} variant="ghost" className="h-auto justify-between px-2 py-2"
                    onClick={() => {
                      onAdd({
                        id: `asset:${a.id}`,
                        role: 'context',
                        kind: 'asset',
                        assetId: a.id,
                        purpose,
                        ...(note.trim() ? { note: note.trim() } : {}),
                        label: a.name,
                      })
                      onOpenChange(false)
                    }}>
                    <span className="flex min-w-0 flex-col items-start">
                      <span className="t-body truncate">{a.name}</span>
                      <span className="t-dim text-muted-foreground">{a.mimeType ?? a.mediaType ?? ''}</span>
                    </span>
                    <Plus className="size-3.5 shrink-0" />
                  </Button>
                ))}
              </div>
            </ScrollArea>
          </TabsContent>

          {/* 参考片：先选片，再选段 */}
          <TabsContent value="reference" className="flex flex-col gap-3">
            <ScrollArea className="h-40">
              <div className="flex flex-col gap-1 pr-3">
                {videos.length === 0 && <p className="t-meta text-muted-foreground">参考片库还没有内容</p>}
                {videos.map((v) => (
                  <Button key={v.id} variant={activeVideo === v.id ? 'secondary' : 'ghost'}
                    className="h-auto justify-between px-2 py-2" onClick={() => setActiveVideo(v.id)}>
                    <span className="t-body truncate">{v.title}</span>
                    <Badge variant="outline">{v.segmentCount ?? 0} 段</Badge>
                  </Button>
                ))}
              </div>
            </ScrollArea>

            {activeVideo && (
              <>
                <span className="t-meta">要看哪一段</span>
                <ScrollArea className="h-40">
                  <div className="flex flex-col gap-1 pr-3">
                    {segments.length === 0 && (
                      <p className="t-meta text-muted-foreground">这条参考片还没有切片段，请先在参考片库切出一段。</p>
                    )}
                    {segments.map((s) => (
                      <Button key={s.id} variant="ghost" className="h-auto justify-between px-2 py-2"
                        onClick={() => {
                          onAdd({
                            id: `reference:${s.id}`,
                            role: 'context',
                            kind: 'reference',
                            segmentId: s.id,
                            videoId: s.videoId,
                            startMs: s.startMs,
                            endMs: s.endMs,
                            ...(wants.trim() ? { wants: wants.trim() } : {}),
                            ...(avoid.trim() ? { avoid: avoid.trim() } : {}),
                            label: `${videoTitle} · 第 ${s.index + 1} 段`,
                          })
                          onOpenChange(false)
                        }}>
                        <span className="flex min-w-0 flex-col items-start">
                          <span className="t-body num">第 {s.index + 1} 段 · {seconds(s.startMs)}–{seconds(s.endMs)}</span>
                          {s.observation && <span className="t-dim truncate text-muted-foreground">{s.observation.slice(0, 40)}…</span>}
                        </span>
                        <Plus className="size-3.5 shrink-0" />
                      </Button>
                    ))}
                  </div>
                </ScrollArea>
              </>
            )}

            <div className="flex flex-col gap-1.5">
              <span className="t-meta">借鉴什么</span>
              <Input placeholder="例如：运镜节奏、转场方式" value={wants} onChange={(e) => setWants(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="t-meta">要避开什么</span>
              <Input placeholder="例如：不要使用原片画面" value={avoid} onChange={(e) => setAvoid(e.target.value)} />
            </div>
          </TabsContent>

          {/* 特效：照着做 or 只作参考 */}
          <TabsContent value="technique" className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <span className="t-meta">用法</span>
              <ToggleGroup type="single" value={fxIntent} onValueChange={(v) => v && setFxIntent(v as typeof fxIntent)}>
                <ToggleGroupItem value="reference" className="h-auto flex-col items-start gap-0 px-3 py-1.5">
                  <span className="t-body">只作技法参考</span>
                  <span className="t-dim text-muted-foreground">不要求完全照做</span>
                </ToggleGroupItem>
                <ToggleGroupItem value="apply" className="h-auto flex-col items-start gap-0 px-3 py-1.5">
                  <span className="t-body">按这种技法实现</span>
                  <span className="t-dim text-muted-foreground">画面要真的做出来</span>
                </ToggleGroupItem>
              </ToggleGroup>
            </div>
            <ScrollArea className="h-64">
              <div className="flex flex-col gap-1 pr-3">
                {techniques.length === 0 && <p className="t-meta text-muted-foreground">特效库还没有内容</p>}
                {techniques.map((t) => (
                  <Button key={t.id} variant="ghost" className="h-auto justify-between px-2 py-2"
                    onClick={() => {
                      onAdd({
                        id: `technique:${t.id}`,
                        role: 'context',
                        kind: 'technique',
                        techniqueId: t.id,
                        intent: fxIntent,
                        label: t.name,
                      })
                      onOpenChange(false)
                    }}>
                    <span className="flex min-w-0 flex-col items-start">
                      <span className="t-body truncate">{t.name}</span>
                      <span className="t-dim text-muted-foreground">{t.categoryLabel ?? ''}</span>
                    </span>
                    <Plus className="size-3.5 shrink-0" />
                  </Button>
                ))}
              </div>
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
