import { UiIcon, SemIcons } from '@/shared/icons/UiIcon'
import { File01, Folder, Keyboard01 } from '@untitledui/icons'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from '@/shared/ui/dropdown-menu'

/** 画布快捷键：只列编辑器里真的接了的键 */
const SHORTCUTS: Array<[string[], string]> = [
  [['Ctrl', 'S'], '保存'],
  [['Ctrl', 'Z'], '撤销'],
  [['Ctrl', 'Shift', 'Z'], '重做'],
  [['Ctrl', 'D'], '复制选中的节点'],
  [['Delete'], '删除选中的节点或连线'],
  [['F'], '适应画布'],
  [['/'], '搜索节点库'],
  [['Esc'], '取消选择'],
]

/** 编辑器顶栏「更多」：工作稿、进入工作台，以及快捷键表。次要入口集中在这里，顶栏只留主线操作。 */
export function EditorMoreMenu(props: {
  showDrafts: boolean
  draftsNeedMigration: boolean
  onOpenDrafts: () => void
  projectLinked: boolean
  onOpenWorkbench: () => void
}) {
  const { showDrafts, draftsNeedMigration, onOpenDrafts, projectLinked, onOpenWorkbench } = props
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="wfe-iconbtn wfe-more-trigger" aria-label="更多操作" title="更多">
          <UiIcon icon={SemIcons.more} size="md" />
          {draftsNeedMigration && <i className="wfe-more-dot" aria-hidden="true" />}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="wfe-menu">
        {showDrafts && (
          <DropdownMenuItem className="wfe-menu-item" onClick={onOpenDrafts}>
            <UiIcon icon={File01} size="sm" />工作稿
            {draftsNeedMigration && <em className="wfe-menu-badge">待迁移</em>}
          </DropdownMenuItem>
        )}
        <DropdownMenuItem className="wfe-menu-item" disabled={!projectLinked} onClick={onOpenWorkbench}>
          <UiIcon icon={Folder} size="sm" />进入项目工作台
          {!projectLinked && <span className="wfe-menu-why">先关联项目</span>}
        </DropdownMenuItem>
        <DropdownMenuSeparator className="wfe-menu-sep" />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="wfe-menu-item"><UiIcon icon={Keyboard01} size="sm" />快捷键</DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="wfe-menu wfe-menu-keys">
            <table>
              <tbody>
                {SHORTCUTS.map(([keys, label]) => (
                  <tr key={label}>
                    <td>{label}</td>
                    <td className="wfe-kbds">{keys.map((k) => <kbd key={k}>{k}</kbd>)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
