import { LICENSE_LABEL, type MyAsset } from '@/data/myAssets'
import type { GateEval } from '@/services/workflowService'

export type StageProblem = { id: string; title: string; meta: string }

const GATE_DECISION_LABEL: Record<GateEval['decision'], string> = {
  confirmed: '已确认',
  pending: '待确认',
  'not-started': '未开始',
}

/**
 * 探索方向：对比的是这条片真正绑定的参考，不是生成的测试帧。
 * 测试帧还没有 —— 方向定下来、第一次渲染后，这里会换成测试帧对比。
 */
export function ExploreStage({ references, onAskAI }: {
  references: MyAsset[]
  onAskAI: () => void
}) {
  return (
    <div className="fw-cstage">
      <section className="fw-cstage-block">
        <div className="fw-cstage-hd">
          方向对比<span className="spacer" />
          <span className="fw-cstage-src">工作流 · 引用节点真实绑定</span>
        </div>
        <p className="fw-cstage-note">
          这里对比的是这条片真正绑定的参考素材，不是生成的测试帧 —— 测试帧还没有产出，
          方向定下来、第一次渲染后，这里会换成测试帧对比。
        </p>
        {references.length === 0 ? (
          <p className="fw-cstage-none">还没有绑定参考。参考资料与素材都在左栏「资料」里。</p>
        ) : (
          <ul className="fw-cstage-refs">
            {references.map((a) => (
              <li key={a.id}>
                <span className="fw-cstage-thumb">
                  {a.thumbnailPath ? <img src={a.thumbnailPath} alt="" /> : <span>{a.name.slice(-4)}</span>}
                </span>
                <span className="fw-cstage-refname" title={a.filePath}>{a.name}</span>
                <span className="fw-cstage-refmeta">{LICENSE_LABEL[a.licenseStatus]}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <div className="fw-cstage-actions">
        <button type="button" className="fw-cstage-btn" onClick={onAskAI}>向 AI 说方向 ›</button>
      </div>
      <p className="fw-cstage-foot">
        还没有产出画面。第一次渲染出来后，这里会换成最近一次的成片或局部试片
        （整片播放、按帧/范围/区域指认问题都在那一屏）。
      </p>
    </div>
  )
}

/**
 * 制作中（还没有画面时）：这次执行本身就是内容 —— 跑什么、什么状态、
 * 去哪看执行过程；画面出来后这里会换成最近一次渲染。
 */
export function ProduceStage({ task, onViewTask, onAskAI }: {
  task: { label: string; state: string } | null
  onViewTask: () => void
  onAskAI: () => void
}) {
  return (
    <div className="fw-cstage">
      <section className="fw-cstage-block">
        <div className="fw-cstage-hd">
          正在制作<span className="spacer" />
          <span className="fw-cstage-src">任务 · 进行中</span>
        </div>
        {task
          ? <p className="fw-cstage-task">正在做<b>「{task.label}」</b> —— {task.state}。</p>
          : <p className="fw-cstage-none">没有进行中的任务。</p>}
      </section>
      <div className="fw-cstage-actions">
        <button type="button" className="fw-cstage-btn" onClick={onViewTask}>查看执行 ›</button>
        <button type="button" className="fw-cstage-btn" onClick={onAskAI}>向 AI 提要求 ›</button>
      </div>
      <p className="fw-cstage-foot">
        还没有画面：这次执行产出画面后，这里会换成最近一次渲染（当前场景预览、局部试片）。
      </p>
    </div>
  )
}

/**
 * 修改中（还没有画面时）：问题清单就是内容 —— 看片要改 + Gate 返工，
 * 与待决定、已确认同一快照同一遍历。这一屏不挂前后对比：对比需要画面，
 * 有画面时在播放器用「对比版本」看已存画面 vs 当前影片。
 */
export function ReviseStage({ problems, onAskAI }: {
  problems: StageProblem[]
  onAskAI: () => void
}) {
  return (
    <div className="fw-cstage">
      <section className="fw-cstage-block">
        <div className="fw-cstage-hd">
          发现的问题<span className="spacer" />
          <span className="fw-cstage-src num">{problems.length}</span>
        </div>
        {problems.length === 0 ? (
          <p className="fw-cstage-none">没有待改的问题。</p>
        ) : (
          <ul className="fw-cstage-rows">
            {problems.map((p) => (
              <li key={p.id} className="fw-cstage-row">
                <span className="fm-dot" data-s="failed" />
                <span className="fw-cstage-row-t">{p.title}</span>
                <span className="fw-cstage-row-m">{p.meta}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <div className="fw-cstage-actions">
        <button type="button" className="fw-cstage-btn" onClick={onAskAI}>向 AI 说要改哪里 ›</button>
      </div>
      <p className="fw-cstage-foot">
        前后对比需要画面：有画面时，在播放器用「对比版本」看已存画面 vs 当前影片，
        修改前后画面都在那一屏。
      </p>
    </div>
  )
}

/**
 * 交付前（还没有最终成片时）：实际检查结果就是内容 —— 每个 Gate 的真实评估
 * （确认态 + 受阻项 + 是否对应旧版本），不是一张“全部通过”的贴纸。
 */
export function DeliverStage({ gates, finishingNotes, onAskAI }: {
  gates: GateEval[]
  finishingNotes?: string
  onAskAI: () => void
}) {
  return (
    <div className="fw-cstage">
      <section className="fw-cstage-block">
        <div className="fw-cstage-hd">
          检查结果<span className="spacer" />
          <span className="fw-cstage-src num">{gates.filter((g) => g.decision === 'confirmed').length}/{gates.length} 项已确认</span>
        </div>
        {gates.length === 0 ? (
          <p className="fw-cstage-none">这条片没有 Gate 检查点。</p>
        ) : (
          <ul className="fw-cstage-rows">
            {gates.map((g) => (
              <li key={g.gate} className="fw-cstage-row">
                <span className="fw-cstage-row-t">
                  {g.label}{g.stale ? '（对应旧版本）' : ''}
                  {g.blocked.length > 0 && (
                    <span className="fw-cstage-blocked">仍受阻：{g.blocked.join('；')}</span>
                  )}
                </span>
                <span className="fw-cstage-row-m">{GATE_DECISION_LABEL[g.decision]}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      {finishingNotes && (
        <section className="fw-cstage-block">
          <div className="fw-cstage-hd">
            Finishing 记录<span className="spacer" />
            <span className="fw-cstage-src">工作流 · Finishing 节点</span>
          </div>
          <p className="fw-cstage-task">{finishingNotes}</p>
        </section>
      )}
      <div className="fw-cstage-actions">
        <button type="button" className="fw-cstage-btn" onClick={onAskAI}>向 AI 说交付要求 ›</button>
      </div>
      <p className="fw-cstage-foot">
        还没有最终成片：成片渲染出来后，这里会同时放最终预览与上面这份检查结果。
      </p>
    </div>
  )
}
