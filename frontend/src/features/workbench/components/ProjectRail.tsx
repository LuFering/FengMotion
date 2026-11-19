import { UiIcon, SemIcons } from '@/shared/icons/UiIcon'
import { ArrowUpRight, File01, Folder, MusicNote01, Type01 } from '@untitledui/icons'
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react'
import { ProjectArtifacts } from '@/features/workbench/components/ProjectArtifacts'
import { type ContentOutline, type ContentRow } from '@/features/workbench/model/contentOutline'
import { type MaterialFile, type MaterialShelf } from '@/features/workbench/model/materialDeck'
import { fmtClock } from '@/shared/lib/status'
import { SegmentedControl } from '@/shared/ui/segmented-control'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shared/ui/tooltip'
import { type CapabilityResult } from '@/features/workbench/services/workbenchCapabilityEvaluator'
import type { RailTab } from '@/features/workbench/model/workbenchConsole'
import { RailDeck } from '@/features/workbench/components/RailDeck'

export function ProjectRail({ projectName, projectId, open, onClose, tab, onTab, onOpenBrief, onEditScene,
  directEditCapability,
  confirmed,
  decisions, onDecide, workflowId, outline, materials, openShelf, onToggleShelf,
  activeSceneId, liveState, onSelectContent, onOpenWorkflowEditor,
  wholeFilmActive, onSelectWholeFilm, onOpenMaterials, progressPanel }:
  { projectName: string; projectId: string; open: boolean; onClose: () => void
    tab: RailTab; onTab: (tab: RailTab) => void
    confirmed: { id: string; title: string; hint: string }[]
    decisions: { wfId: string; nodeId: string; id: string; title: string; hint: string; detail: string }[]
    onDecide: (wfId: string, nodeId: string, verdict: 'done' | 'rework') => void
    workflowId: string | null
    /** 内容页的行（整片之外真实存在的内容单元）与它从哪来 */
    outline: ContentOutline
    /** 资料页的三格：素材 / 参考 / 缺失（素材与参考分开，每格按格式一摞一摞堆） */
    materials: MaterialShelf[]
    openShelf: string | null
    onToggleShelf: (id: string) => void
    /** 现在被设为 AI 修改范围的那个单元 */
    activeSceneId: string | null
    /** AI 任务正在跑时的状态词（执行中…）；没在跑就是 null —— 正在处理的那一行自己显示它 */
    liveState: string | null
    onSelectContent: (row: ContentRow) => void
    onOpenWorkflowEditor?: (workflowId: string) => void
    /** 整片：不管项目有没有分镜都固定存在的入口，选中即把修改范围设为整个项目。 */
    wholeFilmActive: boolean
    onSelectWholeFilm: () => void
    /** 内容行缺素材时，把人带到资料页那摞素材卡上 */
    onOpenMaterials: () => void
    /** 概览第一格：当前进度卡（读数 + 运行入口，见 RailProgress.tsx） */
    onOpenBrief: () => void
    onEditScene: () => void
    directEditCapability?: CapabilityResult
    progressPanel?: ReactNode }) {
  /* 给结论后先让那张卡退场（牌堆态滑出、列表态右滑淡出），动画结束再写回工作流。
     卡片的形态、位移与弹窗都在 RailDeck 里，这里只留「哪张正在退场」和它的定时器。 */
  const [leaving, setLeaving] = useState<{ id: string; verdict: 'done' | 'rework' } | null>(null)
  const [removing, setRemoving] = useState<string | null>(null)
  const leavingTimer = useRef<number | null>(null)
  const removingTimer = useRef<number | null>(null)
  useEffect(() => () => {
    if (leavingTimer.current) window.clearTimeout(leavingTimer.current)
    if (removingTimer.current) window.clearTimeout(removingTimer.current)
  }, [])
  const decideFromModal = (d: (typeof decisions)[number], source: 'stack' | 'list', verdict: 'done' | 'rework') => {
    if (leaving || removing) return
    if (source === 'list') {
      setRemoving(d.id)
      removingTimer.current = window.setTimeout(() => { onDecide(d.wfId, d.nodeId, verdict); setRemoving(null) }, 220)
    } else {
      setLeaving({ id: d.id, verdict })
      leavingTimer.current = window.setTimeout(() => { onDecide(d.wfId, d.nodeId, verdict); setLeaving(null) }, 280)
    }
  }
  return (
    <aside className="fw-ing" data-open={open ? '' : undefined} aria-label="项目导航">
      <div className="wb-space-heading"><UiIcon icon={Folder} size="sm" /><span>项目空间</span></div>
      {/* 四个页签就是这一栏的全部导航。原来那行「概览 1 项」标题只是把页签名和
          一个计数又写了一遍，还把首屏高度花在标题上，去掉。 */}
      <div className="fw-ing-hd">
        <SegmentedControl value={tab} onChange={onTab} ariaLabel="工作区导航"
                          className="fw-rail-seg"
                          options={[
                            { value: 'overview', label: '概览' },
                            { value: 'artifacts', label: '产物' },
                            { value: 'content', label: '内容' },
                            { value: 'materials', label: '资料' },
                          ]} />
        <button className="iconbtn fw-mobile" type="button" title="收起" onClick={onClose}>
          <UiIcon icon={SemIcons.close} className="size-4" />
        </button>
      </div>

      {tab === 'artifacts' ? (
        <div className="fw-artifacts" role="tabpanel">
          {/* 只列项目目录里真实存在的东西。
              原先这里固定渲染 WORKBENCH_ARTIFACTS（Token 科普、视觉方向、导演处理、
              质量证据四条示例），打开任何项目都显示同样内容 —— 用户会把它当成
              自己项目的产出。示例已经删除，空就如实说空。 */}
          <ProjectArtifacts projectId={projectId} />
        </div>
      ) : tab === 'content' ? (
        /* 内容 —— 这部片有哪些画面，是这一栏的主要导航：找到某个画面，并把修改范围
           明确给 AI。整片固定存在（不然用户没法说「整部片的节奏太慢」）；下面的行
           只在项目真有可靠结构时出现（见 data/contentOutline.ts）。

           行只显示它真有的东西：名称、产物的状态、产物里真写了帧号才有时间、指到
           预览文件才有缩略图。没有画面就不留空缩略图位，也不拿渲染切片冒充内容。 */
        <div className="fw-ing-list">
          <button type="button" className="fm-unit" data-state="whole"
                  aria-current={wholeFilmActive ? 'true' : undefined}
                  onClick={onSelectWholeFilm}>
            <span className="fm-unit-body">
              <b>整片 · {projectName}</b>
              <span>需求与视觉方向</span>
            </span>
          </button>

          {outline.rows.map((row) => {
            /* 正在处理的就是这一行：状态改成实时状态、圆点亮起来 ——
               「当前进度」卡在概览页，用户浏览内容列表时看不到它，所以让行自己说。
               这不新开栏目，也不铺执行细节（细节在右侧任务页与底部面板）。 */
            const busy = liveState !== null && row.ref.sceneId === activeSceneId
            return (
              <Fragment key={row.id}>
              <button type="button" className="fm-unit" data-part={row.depth}
                      data-busy={busy || undefined}
                      aria-current={row.ref.sceneId === activeSceneId ? 'true' : undefined}
                      onClick={() => onSelectContent(row)}>
                {row.thumb && <span className="fm-unit-frame"><img src={row.thumb} alt="" /></span>}
                {busy && <i className="fm-dot" data-s="running" />}
                <span className="fm-unit-body">
                  <b>{row.index && <span className="fm-unit-index">{row.index}</span>}{row.name}</b>
                  <span>
                    {busy ? `正在制作 · ${liveState}` : row.status}
                    {row.span ? ` · ${fmtClock(row.span.from)}–${fmtClock(row.span.from + row.span.duration)}` : ''}
                  </span>
                </span>
              </button>
              {/* 这一行自己声明要外部素材、而素材索引里没有场景级绑定时，就地提醒一次；
                  点它去资料页看那摞素材卡（不是跳素材库）。 */}
              {row.needs && (
                <button type="button" className="fm-unit-need" onClick={onOpenMaterials}>
                  需要{row.needs} · 还没绑定素材 ›
                </button>
              )}
              </Fragment>
            )
          })}

          {outline.rows.length === 0 && (
            <p className="fw-rail-none">
              还没有能拆开的内容结构：工作流产出场景规格或导演处理之后，这里才会出现画面单元。
            </p>
          )}
        </div>
      ) : tab === 'materials' ? (
        /* 资料 —— 素材与参考**分开两格**，各自按格式一摞一摞地堆（图片/视频/音频）。
           不做抽屉、不跳素材库：几十张图铺进左栏会挤掉内容导航，跳走又会丢掉来路。
           「产物」入口已按作者定稿去掉。
           三个入口用概览同一套蓝色标签（.fw-tag）：原来是一排灰卡 + 右侧数字 + ›，
           和概览的分组标题不是一个语言，且数字在右、标题在左，读起来要来回跳。
           现在数字并进标签内部、贴着标题，右侧不再有第二个数字和箭头。
           下面那段「素材索引只记…」的说明是给开发看的字段限制，不是作者要读的话，去掉。 */
        <div className="fw-ing-list">
          {materials.map((shelf) => (
            <Fragment key={shelf.id}>
              <button type="button" className="fw-tag fw-tag--shelf"
                      aria-expanded={openShelf === shelf.id}
                      onClick={() => onToggleShelf(shelf.id)}>
                {shelf.title}<span className="fw-tag-n num">{shelf.count}</span>
              </button>

              {openShelf === shelf.id && (
                shelf.piles.length === 0 ? (
                  <p className="fw-rail-none">{shelf.empty ?? '这一格现在是空的。'}</p>
                ) : (
                  /* 和概览同一套牌堆，同一套叠放与翻卡 —— 区别只在卡片本身：
                     这里的每张卡就是一个文件（卡面是它自己的缩略图），
                     相同格式的文件堆成一摞：图片一摞、视频一摞、音频一摞。 */
                  shelf.piles.map((pile) => (
                    <Fragment key={pile.id}>
                      <div className="fw-stack-hd">
                        {pile.title}
                        <span className="num">{pile.files.length}</span>
                      </div>
                      <RailDeck items={pile.files.map(fileEntry)} dotStatus="idle" variant="file"
                                renderModal={(file, { close }) => (
                                  <>
                                    <div className="fw-modal-head">
                                      <span className="fw-rail-decision-main">
                                        <b>{file.title}</b><small>{file.hint}</small>
                                      </span>
                                      <button type="button" className="fw-modal-close" aria-label="关闭" onClick={close}>×</button>
                                    </div>
                                    <span className="fw-asset-preview">
                                      {file.thumb
                                        ? <img src={file.thumb} alt={file.title} />
                                        : <span className="fw-file-ph">{file.icon}</span>}
                                    </span>
                                  </>
                                )} />
                    </Fragment>
                  ))
                )
              )}
            </Fragment>
          ))}

          {materials.length === 0 && (
            <p className="fw-rail-none">这个项目还没有素材文件。</p>
          )}

        </div>
      ) : (
        <div className="fw-ing-list">
          {/* 概览第一格：当前进度（读数 + 运行入口）。原来这里还并排一块「正在制作」
              面板，两块报同一件事、同屏出现两个阶段数，已合成一张卡（RailProgress.tsx）。
              下面两段是同一份快照的两种过滤：等你拍板的、和你已经定下的。 */}
          {progressPanel}

          {decisions.length > 0 && <section>
            <div className="fw-scene-hd">
              <span className="fw-tag">待决定<span className="fw-tag-n num">{decisions.length}</span></span>
            </div>
            {(
              /* 多条决定：牌堆态（小卡叠放，圆点选最前）与列表态（向下排列）共用同一批
                 卡片节点；详情只在弹窗里，不再有展开的大卡片。 */
              <RailDeck items={decisions} dotStatus="waiting" variant="decision"
                        leavingId={leaving?.id ?? null} removingId={removing}
                        renderModal={(d, { close, source }) => (
                          <>
                            <div className="fw-modal-head">
                              <span className="fm-dot" data-s="waiting" />
                              <span className="fw-rail-decision-main"><b>{d.title}</b><small>{d.hint}</small></span>
                              <button type="button" className="fw-modal-close" aria-label="关闭" onClick={close}>×</button>
                            </div>
                            <p className="fw-modal-detail">{d.detail}</p>
                            <div className="fw-rail-decision-acts">
                              <button type="button" className="fw-decide-btn" data-kind="done"
                                      onClick={() => decideFromModal(d, source, 'done')}>通过</button>
                              <button type="button" className="fw-decide-btn" data-kind="rework"
                                      onClick={() => decideFromModal(d, source, 'rework')}>要改</button>
                            </div>
                            <button type="button" className="fw-rail-decision-more"
                                    onClick={() => { close(); if (workflowId) onOpenWorkflowEditor?.(workflowId) }}>打开工作流查看详情</button>
                          </>
                        )} />
            )}
          </section>}

          {confirmed.length > 0 && (
            /* 已确认和待决定用同一套牌堆：卡多了叠起来、‹ › 翻、点主卡散开成列表。
               区别只在内容 —— 它是记录，没有可操作项，所以弹窗里只给深链。 */
            <section>
              <div className="fw-scene-hd">
                <span className="fw-tag">最近已决定<span className="fw-tag-n num">{confirmed.length}</span></span>
              </div>
              <RailDeck items={confirmed} dotStatus="done" variant="record"
                        renderModal={(c, { close }) => (
                          <>
                            <div className="fw-modal-head">
                              <span className="fm-dot" data-s="done" />
                              <span className="fw-rail-decision-main"><b>{c.title}</b><small>{c.hint}</small></span>
                              <button type="button" className="fw-modal-close" aria-label="关闭" onClick={close}>×</button>
                            </div>
                            <button type="button" className="fw-rail-decision-more"
                                    onClick={() => { close(); if (workflowId) onOpenWorkflowEditor?.(workflowId) }}>打开工作流查看详情</button>
                          </>
                        )} />
            </section>
          )}

        </div>
      )}

      <div className="wb-space-links">
        <span>项目工具</span>
        <button type="button" onClick={onOpenBrief}><UiIcon icon={File01} size="sm" />制作要求<UiIcon icon={ArrowUpRight} size="sm" /></button>
        {directEditCapability && !directEditCapability.allowed ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="opacity-40 cursor-not-allowed hover:bg-transparent"
                onClick={() => {}}
                aria-disabled="true"
              >
                <UiIcon icon={SemIcons.film} size="sm" />场景编辑器<UiIcon icon={ArrowUpRight} size="sm" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-[220px] text-xs">
              {directEditCapability.reason}
            </TooltipContent>
          </Tooltip>
        ) : (
          <button type="button" onClick={onEditScene}><UiIcon icon={SemIcons.film} size="sm" />场景编辑器<UiIcon icon={ArrowUpRight} size="sm" /></button>
        )}
      </div>
    </aside>
  )
}

/** 文件格式 → 占位图标（没有缩略图时用；不画空框） */
export const MEDIA_NODE: Record<MaterialFile['media'], ReactNode> = {
  image: <UiIcon icon={SemIcons.image} className="size-5" />,
  video: <UiIcon icon={SemIcons.film} className="size-5" />,
  audio: <UiIcon icon={MusicNote01} className="size-5" />,
  font: <UiIcon icon={Type01} className="size-5" />,
  doc: <UiIcon icon={File01} className="size-5" />,
}

/** 一个文件 → 牌堆里的一张卡。卡面就是文件本身，卡脚是名字与授权/审核。 */
export const fileEntry = (f: MaterialFile) => ({
  id: f.id,
  title: f.name,
  hint: `${f.adopted ? '引用 · ' : ''}${f.meta}`,
  thumb: f.thumb,
  icon: MEDIA_NODE[f.media],
})
