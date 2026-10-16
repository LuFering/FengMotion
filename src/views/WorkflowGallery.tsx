/**
 * 工作流广场 —— 外部产出的自包含单文件复刻（workflow-gallery.html），
 * 放在 public/replica/ 下用 iframe 全区装载（同 .acr / .atr 的接线方式）。
 *
 * 个性化已做（标注在文件内）：
 *  - 数据：6 张示范模板卡 → FengMotion 真实视频类型（口播科普/对话访谈/
 *    讲书解读/产品宣传/短视频/长视频，取自 src/data/knowledge 的 GENOMES），
 *    缩略图换成真实素材（成片帧 + 首页参考图，预裁于 public/replica/gallery/）；
 *  - 文案：页面文案改中文（从模板开始/从空白开始/返回模板/占位说明）；
 *  - 未接：卡片点击进占位详情页（原文即如此，如实保留「尚未接入」说明）。
 *
 * 旧的只读流程页（MethodsFlow）已被本页取代，文件保留备用。
 */
export function WorkflowGallery() {
  return (
    <div className="wgr">
      <iframe
        className="wgr-frame"
        src="/replica/workflow-gallery.html"
        title="工作流广场"
      />
    </div>
  )
}
