/**
 * AttachMenu —— 输入框加号弹出的「添加」菜单。
 *
 * 结构对 BoardUI 组件实测（不是照截图猜）：
 *   浮层   361px 宽 / 圆角 16px / 白底 / 1px 边框 / padding 8px
 *   分组   14px 常规字重、次要色（「添加」「插件」）
 *   菜单项 高 32px、图标 24×24、主文案 14px/500、说明 14px 次级色
 *
 * 为什么要有这个菜单而不是直接弹系统文件框：参考组件里加号是
 * 「添加东西」的总入口 —— 除了本地文件，还包括目标、计划模式这类
 * 不产生附件的动作。直接弹文件框会让用户以为「加号 = 只能传文件」。
 */

import { useState } from 'react'
import type { ComponentType } from 'react'
import {
  FileText, Folder, Presentation, Sheet, Target, ListChecks, Code2,
} from 'lucide-react'
import { MorphPanel } from './MorphPanel'
import { useSpringPress } from './useSpringPress'
import { Plus } from 'lucide-react'
import './attach-menu.css'

/** 一个菜单项。 */
export interface AttachMenuItem {
  id: string
  label: string
  /** 右侧灰色说明文字 */
  hint?: string
  icon: ComponentType<{ size?: number; strokeWidth?: number }>
  /** 图标底色（插件类才有；普通动作没有） */
  tone?: 'gray' | 'blue' | 'purple' | 'teal'
  disabled?: boolean
  onSelect: () => void
}

export interface AttachMenuProps {
  onPickFiles: () => void
  /**
   * 已达附件上限时禁用加号。
   *
   * 这是参考组件里加号唯一的「状态变化」：数量到顶后按钮变灰、
   * 光标变禁用，悬停提示改成「已达上限」而不是「添加」。
   * 之前这里永远是可点的，用户点开菜单、选文件、再被静默截断，
   * 完全不知道发生了什么。
   */
  disabled?: boolean
  /** 禁用原因（悬停提示） */
  disabledHint?: string
  /** 这些动作本项目还没有，传 undefined 就不渲染 */
  onGoal?: () => void
  onPlan?: () => void
  /** 插件类动作：直接带出对应类型的说明，本轮只接本地文件 */
  onPluginHint?: (label: string) => void
}

export function AttachMenu({
  onPickFiles, onGoal, onPlan, onPluginHint, disabled = false, disabledHint,
}: AttachMenuProps) {
  const [open, setOpen] = useState(false)
  const pressRef = useSpringPress<HTMLButtonElement>()
  const actions: AttachMenuItem[] = [
    { id: 'files', label: '文件和文件夹', icon: Folder, onSelect: onPickFiles },
    ...(onGoal
      ? [{ id: 'goal', label: '目标', hint: '设定目标以获得更快的结果', icon: Target, onSelect: onGoal }]
      : []),
    ...(onPlan
      ? [{ id: 'plan', label: '计划模式', hint: '管理复杂的任务', icon: ListChecks, onSelect: onPlan }]
      : []),
  ]

  const plugins: AttachMenuItem[] = [
    { id: 'doc', label: '文件', hint: '创建和编辑文档', icon: FileText, tone: 'gray' },
    { id: 'sheet', label: '电子表格', hint: '生成电子表格', icon: Sheet, tone: 'blue' },
    { id: 'deck', label: '演讲', hint: '创建营销资产', icon: Presentation, tone: 'purple' },
    { id: 'code', label: '代码块', hint: '编写和编辑现有代码', icon: Code2, tone: 'teal' },
  ].map((p) => ({ ...p, onSelect: () => onPluginHint?.(p.label) })) as AttachMenuItem[]

  return (
    <span className="am-anchor">
      <button
        ref={pressRef}
        type="button"
        className="cc-attach"
        aria-label="添加附件"
        title={disabled ? disabledHint : '添加附件'}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
      >
        <Plus size={16} />
      </button>

      <MorphPanel open={open && !disabled} width={361} align="left">
        <div className="am-body">
          <p className="am-group">添加</p>
          <ul className="am-list">
            {actions.map((item) => (
              <li key={item.id}>
                <button type="button" className="am-item" onClick={() => { setOpen(false); item.onSelect() }}>
                  <item.icon size={18} strokeWidth={1.8} />
                  <span className="am-label">{item.label}</span>
                  {item.hint ? <span className="am-hint">{item.hint}</span> : null}
                </button>
              </li>
            ))}
          </ul>

          <p className="am-group">插件</p>
          <ul className="am-list">
            {plugins.map((item) => (
              <li key={item.id}>
                <button type="button" className="am-item" data-tone={item.tone}
                        onClick={() => { setOpen(false); item.onSelect() }}>
                  <span className="am-icon" aria-hidden>
                    <item.icon size={16} strokeWidth={2} />
                  </span>
                  <span className="am-label">{item.label}</span>
                  <span className="am-hint">{item.hint}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </MorphPanel>
    </span>
  )
}

export default AttachMenu
