import type * as React from 'react'
import { useEffect, useRef } from 'react'
import { DialogContent } from '@/shared/ui/dialog'
import { ChevronLeft, ChevronRight } from '@untitledui/icons'
import { UiIcon, SemIcons } from '@/shared/icons/UiIcon'
import { FX_EXEC_TYPES, type FxTechnique } from '@/features/fx/model/fxTechniques'
import { Star01, Dataflow04 } from '@untitledui/icons'
import type { FxLibState } from '@/features/fx/model/fxLibraryStore'
import { categoryLabel } from '@/features/fx/model/fxFilters'
import { shortSourceUrl, sourceCategory } from '@/features/fx/model/fxDisplay'
import { resolvePoster, type OriginalPosterMap } from '@/features/fx/components/fxPoster'

export interface FxDetailDialogProps {
  /** 与卡片同一个「加入待发送」，同一去重规则 */
  addFxToPending: (list: FxTechnique[]) => void
  fxInPending: (id: string) => boolean
  /** 当前墙的可见顺序，上一条/下一条照它走（契约 §6） */
  wall: FxTechnique[]
  closeDrawer: () => void
  closeRef: React.RefObject<HTMLButtonElement | null>
  copied: 'idle' | 'ok' | 'fail'
  copyRecipe: () => Promise<void>
  current: FxTechnique | null
  lib: FxLibState
  modalRef: React.RefObject<HTMLDivElement | null>
  openDrawer: (id: string) => void
  /** 原始场景封面清单：详情与卡片用同一张画面 */
  originalPosters: OriginalPosterMap
  playing: boolean
  setPlayingId: React.Dispatch<React.SetStateAction<string | null>>
  setWorkflowFor: React.Dispatch<React.SetStateAction<FxTechnique | null>>
  techniques: FxTechnique[]
  toggleFavorite: (id: string) => void
}

/** 技法详情弹窗：预览与动作播放，名称说明、收藏、复制配方与用于工作流，以及用处、步骤、参数、注意事项、同类技法和技术细节。 */
export function FxDetailDialog({ addFxToPending, fxInPending, wall, closeDrawer, closeRef, copied, copyRecipe, current, lib, modalRef, openDrawer, originalPosters, playing, setPlayingId, setWorkflowFor, techniques, toggleFavorite }: FxDetailDialogProps) {
  const poster = current ? resolvePoster(current, originalPosters) : ''
  const subCategory = current ? sourceCategory(current) : null
  const added = current ? fxInPending(current.id) : false
  /* 从「同类技法」跳进来的条目可能不在当前墙里：那时不显示计数与切换 */
  const idx = current ? wall.findIndex((t) => t.id === current.id) : -1
  const prev = idx > 0 ? wall[idx - 1] : null
  const next = idx >= 0 && idx < wall.length - 1 ? wall[idx + 1] : null
  const bodyRef = useRef<HTMLDivElement>(null)

  /* 换条目时正文回到顶部，否则会停在上一条滚到的位置 */
  useEffect(() => { bodyRef.current?.scrollTo({ top: 0 }) }, [current?.id])

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return
    const el = e.target as HTMLElement
    if (el.closest('input, textarea, select, [contenteditable="true"], [role="menu"]')) return
    if (e.key === 'ArrowLeft' && prev) { e.preventDefault(); openDrawer(prev.id) }
    if (e.key === 'ArrowRight' && next) { e.preventDefault(); openDrawer(next.id) }
  }

  return (
    <DialogContent className="fx-modal" showCloseButton={false} onKeyDown={onKeyDown}>
      {/* 关闭键挂在弹窗根部而不是预览图里：条目没有预览图时，
          放在预览里的按钮会跟着一起消失，用户就只能靠 Esc 关闭。 */}
      <button
        ref={closeRef}
        type="button"
        className="fx-modal-close"
        onClick={closeDrawer}
        aria-label="关闭技法详情"
        title="关闭（Esc）"
      >
        <UiIcon icon={SemIcons.close} size="sm" aria-hidden="true" />
      </button>
      {idx >= 0 && wall.length > 1 && (
        <div className="fx-modal-nav" role="group" aria-label="切换技法">
          <button type="button" className="fx-modal-navbtn" disabled={!prev} onClick={() => prev && openDrawer(prev.id)}
                  aria-label={prev ? `上一条：${prev.name}` : '已是第一条'} title="上一条（←）">
            <UiIcon icon={ChevronLeft} size="sm" aria-hidden="true" />
          </button>
          <span className="fx-modal-count" aria-live="polite">{idx + 1} / {wall.length}</span>
          <button type="button" className="fx-modal-navbtn" disabled={!next} onClick={() => next && openDrawer(next.id)}
                  aria-label={next ? `下一条：${next.name}` : '已是最后一条'} title="下一条（→）">
            <UiIcon icon={ChevronRight} size="sm" aria-hidden="true" />
          </button>
        </div>
      )}
      {current && (
        <div ref={modalRef} className="fx-modal-scroll">
          {poster ? <div className="fx-preview">
            {/* 同图虚化铺底：主图完整显示（contain），两侧不留死黑 */}
            <img className="fx-preview-bg" src={poster} alt="" aria-hidden="true" />
            <img
              className="fx-preview-main"
              src={poster}
              alt=""
              onError={(e) => e.currentTarget.classList.add('is-broken')}
            />
            {playing && current.previewVideo && (
              <video
                key={current.id}
                className="fx-preview-video"
                src={current.previewVideo}
                poster={poster}
                muted
                loop
                playsInline
                autoPlay
                onError={() => setPlayingId(null)}
              />
            )}
            {current.previewVideo && (
              <button
                type="button"
                className="fx-preview-toggle"
                onClick={() => setPlayingId((p) => (p === current.id ? null : current.id))}
                aria-label={playing ? '暂停动作预览' : '播放动作预览'}
                title={playing ? '暂停动作预览' : '播放动作预览'}
              >
                {playing ? <UiIcon icon={SemIcons.pause} size="sm" aria-hidden="true" /> : <UiIcon icon={SemIcons.play} size="sm" aria-hidden="true" />}
              </button>
            )}
            {/* 能力标签只保留操作行旁那一处，画面上不再重复 */}
            {current.previewCaption && <span className="fx-preview-caption">{current.previewCaption}</span>}
          </div> : null}

          <div className="fx-drawer-body" ref={bodyRef}>
            {/* 打开卡片的意图：先认清「这是什么效果」，再决定「用不用得上」，
                最后才是「怎么拿走」。所以顺序是 名称 → 一句话说明 → 操作 → 用处 → 细节，
                技术元数据（复杂度/依赖/来源/版本）收进折叠区，不跟主信息抢位置。 */}

            {/* 标题、说明、操作吸顶：正文滚下去也能随时加入待发送或复制 */}
            <div className="fxm-top">
            <header className="fxm-head">
              <div className="fxm-head-main">
                <p className="fxm-eyebrow">
                  {categoryLabel(current.category)}
                  {current.sourceProject && <span> · {current.sourceProject}</span>}
                </p>
                <h2 id="fx-drawer-title">{current.name}</h2>
                {current.nameEn && <span className="fxm-nameen">{current.nameEn}</span>}
              </div>
              <button
                type="button"
                className="fx-favbtn"
                data-on={lib.favorites.includes(current.id) ? '' : undefined}
                aria-pressed={lib.favorites.includes(current.id)}
                onClick={() => toggleFavorite(current.id)}
              >
                <UiIcon icon={Star01} size="xs" fill={lib.favorites.includes(current.id) ? 'currentColor' : 'none'} aria-hidden="true" />
                {lib.favorites.includes(current.id) ? '已收藏' : '收藏'}
              </button>
            </header>

            {/* 来源没给说明就不留空段落：空 p 的外边距会在标题和操作之间撑出一块空白 */}
            {current.intent?.trim() && <p className="fxm-intent">{current.intent}</p>}

            {/* 主操作紧跟说明：读懂了就能立刻拿走，不用滚到底部去找。
                状态标签（能否一键运行）就放在按钮旁边，避免读完正文才发现用不了。 */}
            <div className="fxm-actions">
              {/* 主操作：交给创作对话。原先 fx-btn-primary 与样式里的 .is-primary 对不上，主按钮一直没有底色 */}
              <button type="button" className="fx-btn is-primary" disabled={added} onClick={() => addFxToPending([current])}>
                <UiIcon icon={added ? SemIcons.check : SemIcons.plus} size="sm" aria-hidden="true" />
                {added ? '已在待发送' : '加入待发送'}
              </button>
              <button type="button" className="fx-btn" onClick={copyRecipe}>
                {copied === 'ok' ? <UiIcon icon={SemIcons.check} size="sm" aria-hidden="true" /> : <UiIcon icon={SemIcons.copy} size="sm" aria-hidden="true" />}
                {copied === 'ok' ? '已复制' : copied === 'fail' ? '复制失败' : '复制配方'}
              </button>
              <button type="button" className="fx-btn" onClick={() => setWorkflowFor(current)}>
                <UiIcon icon={Dataflow04} size="sm" aria-hidden="true" />
                用于工作流
              </button>
              <span className={`fxm-mode fx-cap-${current.execType}`} title={FX_EXEC_TYPES[current.execType].hint}>
                {current.execLabel}
              </span>
            </div>
            </div>

            {/* 用处：只有真填了才显示。外部导入的条目往往没有 antiScenes，
                以前会留一个空的「不适用」标题，看起来像内容加载失败。 */}
            {(current.scenes.length > 0 || current.antiScenes.length > 0) && (
              <section className="fxm-sec">
                <h3 className="fxm-label">用在哪</h3>
                {current.scenes.length > 0 && (
                  <p className="fxm-useline"><span className="fxm-useok">适合</span>{current.scenes.join('、')}</p>
                )}
                {current.antiScenes.length > 0 && (
                  <p className="fxm-useline"><span className="fxm-useno">不适合</span>{current.antiScenes.join('、')}</p>
                )}
              </section>
            )}

            {/* 制作步骤：只有真写了步骤才成节。
                没有步骤时「实现方式：AI 生成」这种一行信息并入技术细节，
                不在正文里单独立一个只有五个字的标题。 */}
            {current.steps.length > 0 && (
              <section className="fxm-sec">
                <h3 className="fxm-label">怎么做</h3>
                <ol className="fxm-steps">
                  {current.steps.map((step, i) => (
                    <li key={i}><span className="fxm-stepno num">{i + 1}</span><span>{step}</span></li>
                  ))}
                </ol>
              </section>
            )}

            {/* 参数：空数组时整节不出现（以前会留一个空标题） */}
            {current.params.length > 0 && (
              <section className="fxm-sec">
                <h3 className="fxm-label">参数</h3>
                <ul className="fxm-params">
                  {current.params.map((param) => (
                    <li key={param.key}>
                      <span className="fxm-param-label">{param.label}</span>
                      <b className="num">{param.value}</b>
                      {param.hint && <em title={param.hint}>{param.hint}</em>}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {/* 限制与失败：这是「用了会踩坑」的预警，属于主信息，不折叠 */}
            {current.limitations.length > 0 && (
              <section className="fxm-sec">
                <h3 className="fxm-label">注意</h3>
                <ul className="fxm-warns">
                  {current.limitations.map((item) => <li key={item}>{item}</li>)}
                </ul>
                {current.failures.length > 0 && (
                  <ul className="fxm-warns fxm-warns-sub">
                    {current.failures.map((item) => <li key={item}>{item}</li>)}
                  </ul>
                )}
              </section>
            )}

            {current.related.length > 0 && (
              <section className="fxm-sec">
                <h3 className="fxm-label">同类技法</h3>
                <div className="fxm-related">
                  {[...current.related, ...current.alternatives].map((id) => {
                    const rel = techniques.find((t) => t.id === id)
                    if (!rel) return null
                    return (
                      <button key={id} type="button" className="fx-relchip" onClick={() => openDrawer(id)}>
                        {rel.name}
                      </button>
                    )
                  })}
                </div>
              </section>
            )}

            {/* 技术细节：复杂度、依赖、兼容、输入输出、来源许可、版本。
                这些是「要不要用/出了事查」的信息，不是打开卡片就想看的，
                折起来让主内容一屏能读完。 */}
            <details className="fxm-details">
              <summary>技术细节</summary>
              <dl className="fx-io">
                <div><dt>分类</dt><dd>{categoryLabel(current.category)}</dd></div>
                {subCategory && <div><dt>来源分类</dt><dd>{subCategory}</dd></div>}
                <div><dt>实现</dt><dd>{current.implLabel}</dd></div>
                <div><dt>复杂度</dt><dd className="num">{current.complexity} / 5</dd></div>
                {current.inputRequirement && <div><dt>输入</dt><dd>{current.inputRequirement}</dd></div>}
                {current.output && <div><dt>输出</dt><dd>{current.output}</dd></div>}
                {current.dependencies.length > 0 && <div><dt>依赖</dt><dd>{current.dependencies.join('；')}</dd></div>}
                {current.compatibility.length > 0 && <div><dt>兼容</dt><dd>{current.compatibility.join('；')}</dd></div>}
                {current.sourceProject && <div><dt>来源</dt><dd>{current.sourceProject}</dd></div>}
                {current.sourceUrl && (
                  <div><dt>链接</dt><dd><a href={current.sourceUrl} target="_blank" rel="noreferrer" title={current.sourceUrl}>{shortSourceUrl(current.sourceUrl)}</a></dd></div>
                )}
                {current.licenseCode && <div><dt>代码许可</dt><dd>{current.licenseCode}</dd></div>}
                {current.licensePreview && <div><dt>预览许可</dt><dd>{current.licensePreview}</dd></div>}
                <div><dt>版本</dt><dd className="num">v{current.version}</dd></div>
              </dl>
              {current.attribution && <p className="fxm-note">{current.attribution}</p>}
              {/* 有源码不等于能一键跑 —— 这句必须留，否则用户会以为点了就生成 */}
              {current.sourceKind && current.sourceKind !== 'builtin' && (
                <p className="fxm-note">该条目仅提供说明与源码参考，尚未接入执行适配器，不能一键运行。</p>
              )}
            </details>
          </div>
        </div>
      )}
    </DialogContent>
  )
}
