/**
 * 特效库 —— 外部产出的自包含单文件复刻（workflow-gallery.html?view=fx），
 * 与工作流页共用同一文件，通过 ?view=fx 直达特效库视图。
 * 文件内原有横向导航栏（模板库/特效库/工作流）已移除 —— 与 App 左侧导航重复。
 *
 * 适配已做（标注在文件内）：
 *  - 配色：原灰系 → 壳层蓝黑 token（fx 视图新增色值一并映射）；
 *  - 尺寸：对齐首页尺度（标题 16px / 卡片与网格沿用文件内 4 列）；
 *  - 文案：全中文（fx 视图自带中文；编辑器/广场遗留英文已补齐）；
 *  - 技法卡内为内嵌演示媒体；执行状态徽标如实标注（可直接执行/可组合/知识参考）。
 *
 * 未接：「尝试效果 / 插入工作流」为文件内路径（演示执行器，模拟运行不做真实生成）；
 *      收藏 / 最近使用为文件内会话状态（未落盘）。
 *
 * 旧的 TechniqueLibrary（知识库页面）已被本页取代，文件保留备用。
 */
export function FxLibrary() {
  return (
    <div className="wgr">
      <iframe
        className="wgr-frame"
        src="/replica/workflow-gallery.html?view=fx"
        title="特效库"
      />
    </div>
  )
}
