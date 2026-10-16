/**
 * 创作资产 —— 素材库示范的完整复刻页。
 *
 * 用户提供了自包含的单文件复刻（sonora-ss25.html：自带 CSS 变量体系、
 * 内联图标与图片、示例数据），放在 public/replica/ 下，用 iframe 原样装载。
 *
 * 复刻页当前是示范内容（Sonora — SS25 及其示例素材）；
 * 下一阶段「自定义修改」再把其中的示例数据/图片逐步换成 FengMotion 真实素材台账。
 * 旧的手写复刻实现备份在 src/views/Assets.legacy.tsx.bak（含 assets.css 旧样式）。
 */
export function Assets({ projectName }: { projectName?: string } = {}) {
  return (
    <div className="acr" data-project={projectName ?? ''}>
      <iframe
        className="acr-frame"
        src="/replica/sonora-ss25.html"
        title="素材库复刻（Sonora — SS25）"
      />
    </div>
  )
}
