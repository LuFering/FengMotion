import { LICENSE_LABEL, type MyAsset } from '@/data/myAssets'

/**
 * 中栏的第一种形态：**项目还没有产出画面时**该显示什么。
 *
 * 作者的表：刚开始 → 创作需求摘要 + 参考素材，**无画面时不要放假视频**。
 * 所以这里不给播放器、不给时间线，只把两样真实存在的东西摆出来：
 *   · 创作需求 = 工作流提示词节点里的原文（用户真正提的需求）；
 *   · 参考素材 = 引用节点真实绑定的素材（有缩略图就给缩略图）。
 * 末尾如实写一句「还没有产出画面」以及这里以后会放什么 —— 不拿占位片子凑。
 *
 * 需求与参考都为空时说清楚是空，而不是给一张假画面。
 */
export function RequirementStage({ promptText, references, onOpenMaterials }: {
  /** 工作流提示词节点的原文 */
  promptText: string
  /** 引用节点绑定的素材 */
  references: MyAsset[]
  onOpenMaterials: () => void
}) {
  return (
    <div className="fw-req">
      <section className="fw-req-block">
        <div className="fw-req-hd">
          创作需求<span className="spacer" />
          <span className="fw-req-src">工作流 · 提示词输入</span>
        </div>
        {promptText.trim()
          ? <p className="fw-req-text">{promptText}</p>
          : <p className="fw-req-none">工作流的提示词节点还是空的 —— 先在对话里说清这条片要做什么。</p>}
      </section>

      <section className="fw-req-block">
        <div className="fw-req-hd">
          参考素材<span className="spacer" />
          <span className="fw-req-src num">{references.length}</span>
        </div>
        {references.length === 0 ? (
          <p className="fw-req-none">
            还没有绑定参考。参考资料与素材都在左栏「资料」里，点了会按格式堆成一摞一摞。
          </p>
        ) : (
          <ul className="fw-req-refs">
            {references.map((a) => (
              <li key={a.id}>
                <span className="fw-req-thumb">
                  {a.thumbnailPath ? <img src={a.thumbnailPath} alt="" /> : <span>{a.name.slice(-4)}</span>}
                </span>
                <span className="fw-req-refname" title={a.filePath}>{a.name}</span>
                <span className="fw-req-refmeta">{LICENSE_LABEL[a.licenseStatus]}</span>
              </li>
            ))}
          </ul>
        )}
        <button type="button" className="fw-req-more" onClick={onOpenMaterials}>
          去左栏「资料」看全部素材与参考 ›
        </button>
      </section>

      <p className="fw-req-foot">
        还没有产出画面。这条片第一次渲染出来后，这里会换成最近一次的成片或局部试片
        （整片播放、按帧/范围/区域指认问题都在那一屏）。
      </p>
    </div>
  )
}
