import type * as React from 'react'
import { quickActions, type SideTab } from '@/features/workbench/model/workbenchConsole'
import type { ModificationConstraints } from '@/api/studioApi'
import { versionBadgeLabel, versionItemLabel } from '@/features/workbench/model/versionIdentity'
import { ViewSwitch } from '@/shared/components/ViewSwitch'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/shared/ui/tooltip'
import { UiIcon, SemIcons } from '@/shared/icons/UiIcon'
import type { StageVisual } from '@/features/workbench/model/stageVisual'
import type { WorkbenchProps } from '@/features/workbench/Workbench'

export interface UseWorkbenchExportArgs {
  constraints: ModificationConstraints
  deliverableLead: StageVisual | null
  exporting: boolean
  focusFeedback: () => void
  onNavigate: WorkbenchProps['onNavigate']
  openReview: (tab: SideTab) => void
  setConstraints: React.Dispatch<React.SetStateAction<ModificationConstraints>>
  setExporting: React.Dispatch<React.SetStateAction<boolean>>
  setNotice: React.Dispatch<React.SetStateAction<string>>
  setPanelOpen: React.Dispatch<React.SetStateAction<boolean>>
  setWorkbenchDraftText: (text: string) => void
  stageDeliverable: boolean
  viewedPreview: StageVisual | null
}

/** 工作台顶栏的导出与快捷操作：确认取得到最新整片后再发起下载并如实提示结果，处理快捷操作，并提供导出按钮与视图切换。 */
export function useWorkbenchExport({ constraints, deliverableLead, exporting, focusFeedback, onNavigate, openReview, setConstraints, setExporting, setNotice, setPanelOpen, setWorkbenchDraftText, stageDeliverable, viewedPreview }: UseWorkbenchExportArgs) {
  const runQuickAction = (action: (typeof quickActions)[number]) => {
    if (action.compare) {
      /* 只从当前项目真实存在的预览选择比较来源。 */
      openReview('versions')
      return
    }
    if (action.constraint === 'attachment') { setNotice('素材上传还没接通。'); return }
    if (action.constraint) {
      const enabled = !constraints[action.constraint]
      const nextConstraints = { ...constraints, [action.constraint as keyof ModificationConstraints]: enabled }
      setConstraints(nextConstraints)
      /* 请求里的约束必须就是这次切换后的值：setConstraints 是异步的，
         直接读 constraints 闭包会拿到切换前的一份。 */
      setNotice('保留条件已更新，将随下一条意见发送。')
      return
    }
    if (action.id === 'undo' || action.id === 'redo') {
      setNotice('没有可撤销的修改。')
      return
    }
    if (action.prompt) { setWorkbenchDraftText(action.prompt); focusFeedback() }
  }

  /**
   * 下载最新可交付整片。
   *
   * <p>为什么不能只写一句「已开始下载」：<a download> 的点击是同步返回的，
   * 浏览器不会告诉我们文件有没有真的取到。目标不可达（后端没起、产物被清理、
   * 网络中断）时，界面照样提示「已开始下载」，用户去文件夹里却找不到东西 ——
   * 这正是「导出成功或失败时的实际行为」要核对的地方。</p>
   *
   * <p>所以先用一次 HEAD/GET 探测产物是否真的可读，确认后才触发下载；
   * 取不到就如实说取不到，并指出是哪个版本。</p>
   */
  const exportDeliverable = async () => {
    const target = deliverableLead
    if (!target) {
      setNotice('这次制作还没有产出整片，没有可导出的文件。')
      return
    }
    if (!target.file) {
      setNotice(`v${target.revision} 的整片没有可下载的地址，无法导出。`)
      return
    }
    setExporting(true)
    try {
      /* 必须先把字节取回来，再用 blob: 地址下载。
         为什么不能直接 <a href={产物地址} download>：产物地址是后端的
         http://127.0.0.1:8080，与应用页面（fengmotion://app/）不同源，
         浏览器会忽略 download 属性、把视频当页面直接打开 ——
         实测点「导出」会跳走整个工作台去播放那个文件，而不是下载。
         先取字节再下载，既避开跨源限制，也能据此判断成功与否。 */
      const response = await fetch(target.file)
      if (!response.ok) {
        setNotice(`导出失败：v${target.revision} 的整片无法读取（HTTP ${response.status}）。`)
        return
      }
      /* 按后端契约判断返回内容：非视频类型的 2xx 多半是错误页/JSON，
         当成视频存下去用户会得到一个打不开的文件。 */
      const contentType = (response.headers.get('content-type') ?? '').toLowerCase()
      if (contentType && !contentType.startsWith('video/') && !contentType.includes('octet-stream')) {
        setNotice(`导出失败：v${target.revision} 返回的不是视频（${contentType.slice(0, 40)}）。`)
        return
      }
      const blob = await response.blob()
      if (blob.size === 0) {
        setNotice(`导出失败：v${target.revision} 的整片是空文件。`)
        return
      }
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = target.name
      document.body.append(a)
      a.click()
      a.remove()
      /* 立刻回收会让部分浏览器来不及开始下载，留一拍再释放。 */
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
      /* 说明这次导出的是哪一版 —— 用户可能正在看历史版本。
         用 versionItemLabel 统一口径：场景版本写 vN，试片/工作流产物带来源前缀。 */
      const viewing = viewedPreview && viewedPreview.id !== target.id
        ? `（当前正在查看 ${versionBadgeLabel(viewedPreview)}，导出的仍是最新整片 ${versionItemLabel(target)}）`
        : ''
      /* 【文案边界】`a.click()` 之后应用**无法观测**用户是否接受保存、
         目标路径是否可写、下载是否被取消、文件是否落盘 ——
         浏览器没有把这个结果回传给页面的接口。
         所以这里只能说「已获取数据并已发起下载」。
         写「已下载」是把不可知的事说成已确认，用户遇到取消或磁盘满
         就会以为文件在，实际没有。真实完成/取消要等原生下载接口能返回结果。 */
      setNotice(`已获取 ${versionItemLabel(target)} 的整片，已发起下载${viewing}`)
    } catch (error) {
      /* 取字节失败：产物不可达或后端没起，如实说明，不提示成功。 */
      const message = error instanceof Error ? error.message : String(error)
      setNotice(`导出失败：无法读取 v${target.revision} 的整片（${message.slice(0, 80)}）。`)
    } finally {
      setExporting(false)
    }
  }
  const workbenchViewSwitch = (
    <ViewSwitch
      current="workbench"
      onSwitch={(target) => {
        if (target === 'conversation') {
          setPanelOpen(true)
          onNavigate('conversation')
        }
      }}
    />
  )
  const previewExport = (
      <div className="wb-top-actions">
        <Tooltip>
          <TooltipTrigger asChild>
            <button className="wb-export" type="button" disabled={!stageDeliverable || exporting}
                    onClick={() => void exportDeliverable()}>
              <UiIcon icon={SemIcons.download} size="md" />{exporting ? '导出中…' : '导出最新版本'}
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={6}>
            {stageDeliverable && deliverableLead
              ? `下载最新产出的整片（v${deliverableLead.revision}），即使当前正在查看历史版本。`
              : '这次制作还没有产出整片，没有可导出的文件。'}
          </TooltipContent>
        </Tooltip>
      </div>
  )
  const previewActions = <div className="wb-preview-actions">{previewExport}{workbenchViewSwitch}</div>
  return { previewActions, runQuickAction, exportDeliverable, workbenchViewSwitch }
}
