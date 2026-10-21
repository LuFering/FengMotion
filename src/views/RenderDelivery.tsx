/**
 * 发布与验收 —— 渲染页（QC Analyzer）的完整复刻装载器。
 *
 * 用户提供自包含单文件复刻 qc-preview-v2.html（Vite 构建产物内联：
 * React 19 + Tailwind + 内嵌 Geist 字体，缩略图为 CSS 渐变占位，零外部资源），
 * 放在 public/replica/ 下用 iframe 原样装载，与 Assets / ProjectOverview 同一模式。
 *
 * 复刻页当前是示范内容（QC Analyzer — Demo Project，8 个示例文件）；
 * 下一阶段「适应项目」再换成 FengMotion 真实渲染/交付数据，然后「修复交互」。
 */
import type { ProjectSummary } from '@/data/projects'
import type { TaskRecord } from '@/hooks/useAgentTasks'

export function RenderDelivery({
  project,
}: { project?: ProjectSummary; tasks?: { records: TaskRecord[] } } = {}) {
  return (
    <div className="acr" data-project={project?.name ?? ''}>
      <iframe
        className="acr-frame"
        src="/replica/qc-preview-v2.html"
        title="渲染页复刻（QC Analyzer — Demo Project）"
      />
    </div>
  )
}
