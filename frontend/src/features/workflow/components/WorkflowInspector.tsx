import { useEffect, useState, type ReactNode } from 'react'
import { UiIcon, SemIcons } from '@/shared/icons/UiIcon'
import { ARTIFACT_KIND_MAP, STRUCTURED_STAGES, defForNode } from '@/features/workflow/model/workflowTemplates'
import { listAssets } from '@/features/assets/services/assetApiService'
import type { MyAsset } from '@/features/assets/model/myAssets'
import { MEDIA_LABEL } from '@/features/assets/model/myAssets'
import { FX_TECHNIQUES } from '@/features/fx/model/fxTechniques'
import { REFERENCE_SEGMENTS, REFERENCE_VIDEOS } from '@/features/reference/model/referenceLibrary'
import { QUALITY_QUESTIONS, type WorkflowDef, type WfArtifact } from '@/features/workflow/services/workflowService'
import { type FmNode, NODE_COPY, ARTIFACT_STATUS_LABEL, RUN_STATUS_TXT } from '@/features/workflow/model/editorNodes'

export function InspHead(props: { kicker: string; title: string; chip?: ReactNode }) {
  return (
    <div className="wfe-insp-head">
      <span className="wfe-insp-kicker">{props.kicker}</span>
      <div className="wfe-insp-titlerow">
        <h3>{props.title}</h3>
        {props.chip}
      </div>
    </div>
  )
}

export function TechDetails({ node }: { node: FmNode }) {
  const def = defForNode({ type: node.data.defType, params: node.data.params }, { includeLegacy: true })
  if (!def) return null
  const fmt = (ports: typeof def.inputs) =>
    ports.length ? ports.map((x) => `${x.label}（${x.type}）`).join('、') : '无'
  return (
    <details className="wfe-tech">
      <summary>技术细节</summary>
      <dl className="wfe-kv">
        <dt>节点 ID</dt><dd className="num">{node.id}</dd>
        <dt>节点类型</dt>
        <dd>
          {node.data.defType}
          {node.data.defType === 'artifact' ? ` · ${String(node.data.params.kind ?? '')}` : ''}
          {node.data.defType === 'gate' ? ` · ${String(node.data.params.gate ?? '')}` : ''}
        </dd>
        <dt>输入端口</dt><dd>{fmt(def.inputs)}</dd>
        <dt>输出端口</dt><dd>{fmt(def.outputs)}</dd>
        {node.data.defType === 'gate' && (
          <>
            <dt>确认记录</dt>
            <dd>{String(node.data.params.decision ?? 'not-started')}{typeof node.data.params.confirmedAt === 'string' && node.data.params.confirmedAt ? ` · ${new Date(node.data.params.confirmedAt).toLocaleString('zh-CN')}` : ''}</dd>
          </>
        )}
      </dl>
    </details>
  )
}

/* ── 检查器三格契约（P0-2）：输入 | 参数（只运行此节点）| 输出 ── */

export interface InspInputItem {
  nodeId: string
  label: string
  detail: string
}

export function InspInputs({ items, onSelectNode }: { items: InspInputItem[]; onSelectNode: (id: string) => void }) {
  return (
    <div className="wfe-sect3">
      <div className="wfe-sect3-head">输入</div>
      {items.length === 0 ? (
        <p className="wfe-hint">无上游输入（起始节点）。</p>
      ) : (
        <div className="wfe-in3-list">
          {items.map((it) => (
            <button key={it.nodeId} type="button" className="wfe-in3" onClick={() => onSelectNode(it.nodeId)}>
              <b>{it.label}</b>
              <span>{it.detail}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function InspParamsHead({ runLabel, busy, onRunNode }: { runLabel: string; busy: boolean; onRunNode: () => void }) {
  return (
    <div className="wfe-sect3-head is-row">
      参数
      <button type="button" className="wfe-btn sm is-primary" disabled={busy} onClick={onRunNode}>
        <UiIcon icon={SemIcons.play} size="xs" /> {runLabel}
      </button>
    </div>
  )
}

export function InspOutput({ output, emptyText }: { output: WfArtifact | null; emptyText: string }) {
  return (
    <div className="wfe-sect3">
      <div className="wfe-sect3-head">输出 · 最近一次运行</div>
      {output ? (
        <div className="wfe-out3">
          <b>{output.title}</b>
          <span>{output.summary}</span>
          <span className="num">{output.filename} · {output.demo ? '界面快照' : '真实产物'}</span>
        </div>
      ) : (
        <p className="wfe-hint">{emptyText}</p>
      )}
    </div>
  )
}

export function Inspector(props: {
  tab: 'params' | 'inputs' | 'outputs'
  node: FmNode
  workflow: WorkflowDef | null
  onParams: (patch: Record<string, unknown>) => void
  inputs: InspInputItem[]
  output: WfArtifact | null
  latestRender: { version: number | null; artifactPath: string | null; runId: string } | null
  busy: boolean
  onRunNode: () => void
  onSelectNode: (id: string) => void
}) {
  const [liveAssets,setLiveAssets]=useState<MyAsset[]>([])
  const [assetError,setAssetError]=useState('')
  useEffect(()=>{if(props.node.data.defType!=='refs')return;let alive=true;void listAssets().then(items=>{if(alive)setLiveAssets(items)}).catch(e=>{if(alive)setAssetError(e instanceof Error?e.message:'素材未能读取')});return()=>{alive=false}},[props.node.data.defType])
  const { node, onParams } = props
  const def = defForNode({ type: node.data.defType, params: node.data.params }, { includeLegacy: true })
  const p = node.data.params
  if (!def) return null
  const tokenAssets=liveAssets
  if (props.tab !== 'params') return <div className="wfe-insp"><InspHead kicker={def.group} title={NODE_COPY[node.data.defType]?.title ?? def.label}/>{props.tab === 'inputs' ? <InspInputs items={props.inputs} onSelectNode={props.onSelectNode}/> : <InspOutput output={props.output} emptyText="还没有此节点的输出。运行后可在这里查看。"/>}<TechDetails node={node}/></div>

  if (node.data.defType === 'gate') {
    const ev = node.data.gateEval
    const primaryKind = ev?.primaryKind ?? ''
    const primaryLabel = ARTIFACT_KIND_MAP[primaryKind]?.label ?? primaryKind
    const primaryNode = props.workflow?.nodes.find((n) => n.type === 'artifact' && String(n.params.kind ?? '') === primaryKind)
    const primaryVersion = String(primaryNode?.params.version ?? '')
    const lines = (v: unknown) => ((v as string[] | undefined) ?? []).join('\n')
    const parseLines = (s: string) => s.split('\n').map((x) => x.trim()).filter(Boolean)
    return (
      <div className="wfe-insp">
        <InspHead
          kicker="检查点 · Gate"
          title={def.label}
          chip={
            <span className="wfn-gate-chip" data-d={ev?.stale ? 'confirmed-stale' : (ev?.decision ?? 'not-started')}>
              {ev?.stale ? '已确认 · 已失效' : ev?.decision === 'confirmed' ? '已确认' : ev?.decision === 'pending' ? '待确认' : '未开始'}
            </span>
          }
        />
        <p className="wfe-hint">检查点问题：{def.description}。确认绑定具体产物与版本；推荐不等于确认。</p>
        <div className="wfe-runrow">
          <button type="button" className="wfe-btn sm is-primary" disabled={props.busy} onClick={props.onRunNode}>
            <UiIcon icon={SemIcons.play} size="xs" /> 评估此检查点
          </button>
          <span className="wfe-hint">只评估当前状态，不代替确认</span>
        </div>
        <dl className="wfe-kv">
          <dt>主检产物</dt>
          <dd>{primaryLabel}（{ev?.primaryStatus ?? 'missing'}{primaryVersion ? ` · ${primaryVersion}` : ''}）</dd>
          <dt>当前状态</dt>
          <dd>{ev?.stale ? '已确认（版本已变更，确认失效）' : ev?.decision === 'confirmed' ? '已确认' : ev?.decision === 'pending' ? '待确认' : '未开始'}</dd>
          {p.source === 'fixture' && (<><dt>数据来源</dt><dd>演示快照（fixture）</dd></>)}
        </dl>
        {ev && ev.blocked.length > 0 && (
          <div className="wfe-field"><span>阻塞原因（按当前产物实时计算）</span>
            <ul className="wfe-blocklist">
              {ev.blocked.map((b) => <li key={b}>{b}</li>)}
            </ul>
          </div>
        )}
        <label className="wfe-field"><span>推荐方案（系统建议，≠确认）</span>
          <textarea rows={2} value={String(p.recommendation ?? '')} onChange={(e) => onParams({ recommendation: e.target.value })} placeholder="可记录推荐方向；填写推荐不会改变确认状态" />
        </label>
        <label className="wfe-field"><span>批准范围（每行一项）</span>
          <textarea rows={2} value={lines(p.validFor)} onChange={(e) => onParams({ validFor: parseLines(e.target.value) })} />
        </label>
        <label className="wfe-field"><span>保留意见（每行一项）</span>
          <textarea rows={2} value={lines(p.notApproved)} onChange={(e) => onParams({ notApproved: parseLines(e.target.value) })} />
        </label>
        {ev?.decision === 'confirmed' && !ev.stale ? (
          <button type="button" className="wfe-btn" onClick={() => onParams({ decision: 'pending', confirmedFor: undefined, confirmedAt: undefined })}>
            撤销确认
          </button>
        ) : (
          <button
            type="button"
            className="wfe-btn is-primary"
            disabled={!primaryNode || ev?.primaryStatus === 'missing'}
            onClick={() => onParams({ decision: 'confirmed', confirmedFor: { kind: primaryKind, version: primaryVersion }, confirmedAt: new Date().toISOString() })}
          >
            确认{primaryLabel}{primaryVersion ? ` ${primaryVersion}` : ''}
          </button>
        )}
        {(!primaryNode || ev?.primaryStatus === 'missing') && <p className="wfe-hint">请先添加主检产物，再确认。</p>}
        {typeof p.confirmedAt === 'string' && p.confirmedAt && (
          <p className="wfe-hint">确认时间：{new Date(p.confirmedAt).toLocaleString('zh-CN')}（本地记录）</p>
        )}
        <TechDetails node={node} />
      </div>
    )
  }

  if (node.data.defType === 'artifact') {
    const kind = ARTIFACT_KIND_MAP[String(p.kind ?? '')]
    return (
      <div className="wfe-insp">
        <InspHead
          kicker={`产物 · 阶段 ${kind?.stage ?? ''} ${STRUCTURED_STAGES[kind?.stage ?? 0]?.label ?? ''}`}
          title={kind?.label ?? '产物'}
          chip={<span className="wfn-artifact-chip" data-s={String(p.status ?? 'missing')}>{ARTIFACT_STATUS_LABEL[String(p.status ?? 'missing')] ?? String(p.status ?? '')}</span>}
        />
        <p className="wfe-hint">{kind?.filename}。状态与摘要是本工作流内的真实记录，demo 不代生成。</p>
        <div className="wfe-sect3">
        <InspParamsHead runLabel="评估此节点" busy={props.busy} onRunNode={props.onRunNode} />
        <label className="wfe-field"><span>状态</span>
          <select value={String(p.status ?? 'missing')} onChange={(e) => onParams({ status: e.target.value })}>
            <option value="missing">尚无产物</option>
            <option value="draft">草稿</option>
            <option value="candidate">待确认</option>
            <option value="confirmed">已确认</option>
          </select>
        </label>
        <label className="wfe-field"><span>版本</span>
          <input value={String(p.version ?? '')} onChange={(e) => onParams({ version: e.target.value })} placeholder="如 v1" />
        </label>
        <label className="wfe-field"><span>摘要（1–3 行）</span>
          <textarea rows={4} value={String(p.summary ?? '')} onChange={(e) => onParams({ summary: e.target.value })} />
        </label>
        <label className="wfe-check">
          <input type="checkbox" checked={!!p.fixture} onChange={(e) => onParams({ fixture: e.target.checked })} />
          <span>演示快照（fixture）</span>
        </label>
        </div>
        <TechDetails node={node} />
      </div>
    )
  }

  return (
    <div className="wfe-insp">
      <InspHead
        kicker={def.group}
        title={NODE_COPY[node.data.defType]?.title ?? def.label}
        chip={node.data.status !== 'idle' ? <span className="wfe-insp-run" data-s={node.data.status}>{RUN_STATUS_TXT[node.data.status] ?? ''}</span> : undefined}
      />
      <p className="wfe-hint">{NODE_COPY[node.data.defType]?.description ?? def.description}</p>
      <div className="wfe-sect3">
      <InspParamsHead runLabel="只运行此节点" busy={props.busy} onRunNode={props.onRunNode} />

      {node.data.defType === 'prompt' && (
        <>
          <label className="wfe-field"><span>原始提示词</span>
            <textarea rows={7} value={String(p.text ?? '')} onChange={(e) => onParams({ text: e.target.value })} placeholder={typeof p.promptScaffold === 'string' && p.promptScaffold.trim() ? p.promptScaffold : '直接写创作需求，不必先整理成结构化文档'} />
          </label>
          {/* 骨架只在用户主动点击时填入，并接在已写内容后面，不覆盖原话 */}
          {typeof p.promptScaffold === 'string' && p.promptScaffold.trim() && !String(p.text ?? '').includes(p.promptScaffold.trim()) && (
            <button type="button" className="wfe-textbtn" onClick={() => {
              const current = String(p.text ?? '').trimEnd()
              const scaffold = String(p.promptScaffold).trim()
              onParams({ text: current ? `${current}\n\n${scaffold}` : scaffold })
            }}>
              填入视频类型需求骨架
            </button>
          )}
          <label className="wfe-field"><span>目标受众</span>
            <input value={String(p.audience ?? '')} onChange={(e) => onParams({ audience: e.target.value })} />
          </label>
          <label className="wfe-field"><span>时长 / 比例</span>
            <input value={String(p.duration ?? '')} onChange={(e) => onParams({ duration: e.target.value })} placeholder="如 约 3 分钟" />
          </label>
          <div className="wfe-seg">
            {['16:9', '9:16', '1:1'].map((r) => (
              <button key={r} type="button" data-on={p.ratio === r ? '' : undefined} aria-pressed={p.ratio === r} onClick={() => onParams({ ratio: r })}>{r}</button>
            ))}
          </div>
        </>
      )}

      {node.data.defType === 'refs' && (
        <>
          {Array.isArray(p.requiredInputs) && p.requiredInputs.length > 0 && (
            <div className="wfe-req-box">
              <b>当前视频类型建议准备的素材</b>
              <ul>
                {(p.requiredInputs as Array<{ kind?: unknown; label?: unknown; required?: unknown; requiredWhen?: unknown } | string>).map((item, idx) => {
                  const text = typeof item === 'string' ? item : String(item?.label ?? '')
                  const req = typeof item !== 'object' ? '' : item?.required ? '（全部场景必需）'
                    : item?.requiredWhen ? `（适用条件：${String(item.requiredWhen)}）` : ''
                  return text ? <li key={idx}>{text}{req}</li> : null
                })}
              </ul>
            </div>
          )}
          <p className="wfe-hint">从本机素材库引用真实文件；用途和参考片区间会随本次请求传递。</p>
          {assetError&&<p className="wfe-hint" role="alert">{assetError}</p>}
          {!assetError&&!tokenAssets.length&&<p className="wfe-hint">当前没有可选素材，可先在「我的素材」导入。</p>}
          <div className="wfe-checks">
            {tokenAssets.map((a) => {
              const ids = (p.assetIds as string[] | undefined) ?? []
              const on = ids.includes(a.id)
              return (
                <label key={a.id} className="wfe-check">
                  <input type="checkbox" checked={on} onChange={() => onParams({ assetIds: on ? ids.filter((x) => x !== a.id) : [...ids, a.id] })} />
                  <span>{a.name}</span><em>{MEDIA_LABEL[a.mediaType]}</em>
                </label>
              )
            })}
          </div>
          {((p.assetIds as string[]|undefined)??[]).filter(id=>!tokenAssets.some(a=>a.id===id)).map(id=><p className="wfe-hint" key={id}>已选素材未在列表中找到：{id}<button type="button" className="wfe-textbtn" onClick={()=>onParams({assetIds:((p.assetIds as string[])??[]).filter(x=>x!==id)})}>移除</button></p>)}
          {((p.refSegmentIds as string[] | undefined) ?? []).length > 0 && (
            <div className="wfe-field"><span>已接入的参考结论</span>
              <ul className="wfe-reflist">
                {((p.refSegmentIds as string[]) ?? []).map((id) => {
                  const seg = REFERENCE_SEGMENTS.find((s) => s.id === id)
                  const film = seg ? REFERENCE_VIDEOS.find((v) => v.id === seg.videoId) : null
                  return (
                    <li key={id}>
                      <span>{film ? `${film.title} · 片段 ${(seg?.index ?? 0) + 1}` : id}</span>
                      <button type="button" className="wfe-textbtn" onClick={() => onParams({ refSegmentIds: ((p.refSegmentIds as string[]) ?? []).filter((x) => x !== id) })}>移除</button>
                    </li>
                  )
                })}
              </ul>
            </div>
          )}
        </>
      )}

      {node.data.defType === 'capability' && (
        <>
          <p className="wfe-hint">从能力注册表（本地特效技法库快照）勾选候选；运行只记录检索结果，不执行能力。</p>
          <div className="wfe-checks">
            {FX_TECHNIQUES.map((t) => {
              const ids = (p.techniqueIds as string[] | undefined) ?? []
              const on = ids.includes(t.id)
              return (
                <label key={t.id} className="wfe-check">
                  <input type="checkbox" checked={on} onChange={() => onParams({ techniqueIds: on ? ids.filter((x) => x !== t.id) : [...ids, t.id] })} />
                  <span>{t.name}</span><em>{t.execLabel}</em>
                </label>
              )
            })}
          </div>
        </>
      )}

      {node.data.defType === 'create' && (
        <>
          <label className="wfe-field"><span>制作模式</span>
            <select value={String(p.mode ?? 'sketch')} onChange={(e) => onParams({ mode: e.target.value })}>
              <option value="sketch">sketch · 快速试作</option>
              <option value="prototype">prototype · 原型</option>
              <option value="production">production · 正式制作</option>
            </select>
          </label>
          <label className="wfe-field"><span>目标规格</span>
            <select value={String(p.resolution ?? '1080p')} onChange={(e) => onParams({ resolution: e.target.value })}>
              <option value="1080p">1080p · 1920×1080</option>
              <option value="1440p">1440p · 2560×1440</option>
              <option value="4k">4k · 3840×2160</option>
            </select>
          </label>
          <p className="wfe-hint">{props.workflow?.projectId ? '完整运行会在关联项目中调用 Agent 制作与渲染；单节点测试仅生成请求记录。' : '未关联项目，当前运行只生成演示记录，不会制作视频。'}</p>
        </>
      )}

      {node.data.defType === 'review' && (() => {
        const checks = (p.checks as Record<string, boolean> | undefined) ?? {}
        const verdict: 'pending' | 'done' | 'rework' = checks.done && !checks.rework ? 'done' : checks.rework && !checks.done ? 'rework' : 'pending'
        const lr = props.latestRender
        return (
          <>
            <div className="wfe-field"><span>审片结论</span>
              <div className="wfe-seg" role="group" aria-label="审片结论">
                <button
                  type="button"
                  data-on={verdict === 'pending' ? '' : undefined}
                  aria-pressed={verdict === 'pending'}
                  onClick={() => onParams({ checks: { ...checks, done: false, rework: false }, reviewedVersion: undefined, reviewedArtifactPath: undefined, reviewedRunId: undefined })}
                >
                  待审片
                </button>
                <button
                  type="button"
                  disabled={!lr}
                  title={!lr ? '尚无本次运行的渲染结果' : undefined}
                  data-on={verdict === 'done' ? '' : undefined}
                  aria-pressed={verdict === 'done'}
                  onClick={() => {
                    if (!lr) return
                    onParams({
                      checks: { ...checks, done: true, rework: false },
                      reviewedVersion: lr.version ?? undefined,
                      reviewedArtifactPath: lr.artifactPath ?? undefined,
                      reviewedRunId: lr.runId,
                      decidedAt: new Date().toISOString(),
                    })
                  }}
                >
                  审片通过
                </button>
                <button
                  type="button"
                  data-on={verdict === 'rework' ? '' : undefined}
                  aria-pressed={verdict === 'rework'}
                  onClick={() => onParams({ checks: { ...checks, done: false, rework: true }, decidedAt: new Date().toISOString() })}
                >
                  需要修改
                </button>
              </div>
              {!lr && <p className="wfe-hint">暂无匹配当前工作流版本的渲染产物；需先运行制作节点，才能标记「审片通过」。</p>}
              {verdict === 'done' && p.reviewedVersion != null && (
                <p className="wfe-hint">已通过渲染版本 v{String(p.reviewedVersion)}。</p>
              )}
              {verdict === 'rework' && (
                <p className="wfe-hint">已标记需要修改：下次运行将清理制作循环旧结果，并把下方修改意见作为 correction 写入 corrections.md。</p>
              )}
            </div>
            <div className="wfe-field"><span>审片检查（查看画面后确认）</span>
              <div className="wfe-checks">
                {Array.from(new Set([
                  ...(Array.isArray(p.customChecklist) ? p.customChecklist.map(String).filter(Boolean) : []),
                  ...QUALITY_QUESTIONS,
                ])).map((q) => (
                  <label key={q} className="wfe-check">
                    <input type="checkbox" checked={!!checks[q]} onChange={() => onParams({ checks: { ...checks, [q]: !checks[q] } })} />
                    <span>{q}</span>
                    {Array.isArray(p.customChecklist) && p.customChecklist.map(String).includes(q) && <em>Skill</em>}
                  </label>
                ))}
              </div>
            </div>
            <label className="wfe-field"><span>问题与修改意图</span>
              <textarea rows={6} value={String(p.issues ?? '')} onChange={(e) => onParams({ issues: e.target.value })} placeholder="对着真实预览记录：哪里不对、想怎么改" />
            </label>
          </>
        )
      })()}

      {node.data.defType === 'delivery' && (() => {
        const revNode = props.workflow?.nodes.find((n) => n.type === 'review')
        const revChecks = (revNode?.params.checks as Record<string, boolean> | undefined) ?? {}
        const lr = props.latestRender
        const revDone = Boolean(revChecks.done && !revChecks.rework)
        const versionMatches = !lr || lr.version == null || revNode?.params.reviewedVersion == null || Number(revNode.params.reviewedVersion) === Number(lr.version)
        const readyToDeliver = Boolean(lr && revDone && versionMatches)
        return (
          <>
            <p className="wfe-hint">确定性交付节点（不调用 Agent）：只有审片通过，且通过的就是最新那次渲染时，才会输出本次渲染；否则停在「等待审片通过」。</p>
            <dl className="wfe-kv">
              <dt>当前状态</dt>
              <dd>{readyToDeliver ? '审片已通过最新渲染，可输出交付' : '等待审片通过'}</dd>
              {lr?.version != null && <><dt>最新渲染</dt><dd>v{String(lr.version)}</dd></>}
            </dl>
            <label className="wfe-field"><span>交付备注</span>
              <textarea rows={5} value={String(p.notes ?? '')} onChange={(e) => onParams({ notes: e.target.value })} placeholder="可选记录：交付说明或版本备注" />
            </label>
          </>
        )
      })()}
      </div>

      <TechDetails node={node} />
    </div>
  )
}
