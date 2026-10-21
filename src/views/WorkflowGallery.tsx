/**
 * 工作流 —— 外部产出的自包含单文件复刻（workflow-gallery.html），
 * 放在 public/replica/ 下用 iframe 全区装载（同 .acr / .atr 的接线方式）。
 *
 * v3：文件内含完整三段流程（模板库 → 特效库 → 工作流编辑器，React Flow 画布），
 *     特效库经 ?view=fx 直达（App 侧「特效库」导航同源）；文件内横向导航栏已移除
 *     （与 App 左侧导航重复）。
 *
 * 适配已做（标注在文件内）：
 *  - 广场数据：6 张模板卡 = FengMotion 真实视频类型（口播科普/对话访谈/讲书解读/
 *    产品宣传/短视频/长视频），缩略图为真实素材（public/replica/gallery/）；
 *  - 配色：广场灰系 → 壳层蓝黑 token；编辑器 --fm-* 变量 → 壳层 token
 *    （mint #5eead4 → 品牌蓝 #3B8CF8）；
 *  - 尺寸：对齐首页尺度（标题 16 / 按钮 40 / 标签 32 / 卡片 200 / 4 列网格）；
 *  - 文案：界面全中文（含演示节点、执行日志、tooltip）；
 *  - 编辑器顶栏 52px 由 fm-adapt 保护（h-[52px] 工具类已复用给标签）。
 *
 * 未接：详情页的「模板创建流程」仍是占位（原文如实保留），
 *      「打开工作流编辑器」为文件内可用路径；演示执行为模拟运行（如实标注）。
 */
export function WorkflowGallery() {
  return (
    <div className="wgr">
      <iframe
        className="wgr-frame"
        src="/replica/workflow-gallery.html"
        title="工作流"
      />
    </div>
  )
}
