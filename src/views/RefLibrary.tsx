/**
 * 参考片库 —— 复刻页 iframe 壳
 *
 * 与「工作流」「特效库」共用同一份单文件（public/replica/workflow-gallery-v4.html），
 * 用 ?view=ref 直达「参考片库」视图（视觉探索首页 / 视频分析工作台 / 镜头知识详情）。
 * 文件内横向导航条已置空（return null），导航统一走 App 左侧。
 * 布局复用 .wgr / .wgr-frame（与工作流、特效库同一套零边距规则）。
 */
export function RefLibrary() {
  return (
    <div className="wgr">
      <iframe
        className="wgr-frame"
        src="/replica/workflow-gallery-v4.html?view=ref"
        title="参考片库"
      />
    </div>
  )
}
