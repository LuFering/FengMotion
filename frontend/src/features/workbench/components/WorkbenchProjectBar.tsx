import type * as React from 'react'
import { UiIcon, SemIcons } from '@/shared/icons/UiIcon'
import { Folder } from '@untitledui/icons'
import { ProjectTile } from '@/shared/components/ProjectTile'
import type { ProjectSummary } from '@/features/project/model/projects'

export interface WorkbenchProjectBarProps {
  catalog: ProjectSummary[]
  editMode: boolean
  onBack: () => void
  onSwitchProject: (id: string) => void
  previewActions: React.JSX.Element
  project: ProjectSummary
  setSwitchOpen: React.Dispatch<React.SetStateAction<boolean>>
  split: { containerRef: React.RefObject<HTMLDivElement | null>; width: number; bounds: { min: number; max: number }; dragging: boolean; feedback: { offset: number; bend: number; stretch: number }; onPointerDown: (event: React.PointerEvent<HTMLElement>) => void; onPointerMove: (event: React.PointerEvent<HTMLElement>) => void; onPointerUp: (event: React.PointerEvent<HTMLElement>) => void; onPointerCancel: () => void; onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => void; onDoubleClick: () => void; reset: () => void }
  switchOpen: boolean
  switchRef: React.RefObject<HTMLDivElement | null>
}

/** 工作台顶部的项目栏：当前项目胶囊及切换项目菜单，编辑态下附带预览操作。 */
export function WorkbenchProjectBar({ catalog, editMode, onBack, onSwitchProject, previewActions, project, setSwitchOpen, split, switchOpen, switchRef }: WorkbenchProjectBarProps) {
  return (
    <div className="wb-projectbar" data-panel="open" data-editor={editMode} style={{ '--open-chat-width': `${split.width}px` } as React.CSSProperties}>
      {/* 左上角不再放「返回我的创作」和「项目内容与进度」两个孤立方按钮：
          返回有左侧导航「我的创作」常驻，抽屉入口收进了项目标识胶囊的菜单 ——
          顶栏左侧只留一处「我在哪个项目」，视线不用先在一排按钮里找位置。 */}
      <div className="wb-crumb">
        <div className="wb-project-context" ref={switchRef} data-open={switchOpen ? '' : undefined}>
          {/* 项目标识做成一颗胶囊：图标、项目名、展开箭头同属一个控件。
              原先图标是一个独立的白色方块、项目名又是一个透明按钮，
              三块并排看起来像三个不相干的按钮，而不是「当前项目」这一件事。 */}
          <button className="wb-project-switch" type="button"
                  aria-expanded={switchOpen} aria-haspopup="menu"
                  title={`当前项目：${project.name}`}
                  onClick={() => setSwitchOpen((v) => !v)}>
            <ProjectTile name={project.name} />
            <span className="wb-project-name">{project.name}</span>
            <UiIcon icon={SemIcons.collapse} className="wb-caret" />
          </button>
          {switchOpen && (
            <div className="wb-switch-menu" role="menu">
              <div className="wb-switch-head">
                <span>切换项目</span>
                <span className="fw-count">{catalog.length}</span>
              </div>
              {catalog.map((p) => (
                <button key={p.id} type="button" role="menuitem"
                        aria-current={p.id === project.id ? 'true' : undefined}
                        onClick={() => { setSwitchOpen(false); if (p.id !== project.id) onSwitchProject(p.id) }}>
                  <ProjectTile name={p.name} size="sm" />
                  <span className="wb-menu-project">
                    <b className="truncate">{p.name}</b>
                    <small>{p.doneClips}/{p.totalClips} 场</small>
                  </span>
                  {p.id === project.id && <UiIcon icon={SemIcons.check} className="size-3.5 wb-menu-check" />}
                </button>
              ))}
              {/* 「项目空间」那四个页签（概览/产物/内容/资料）已按作者要求移除：
                  菜单只负责「换哪个项目」，不要再塞第二种导航 ——
                  两类操作混在一个下拉里，用户点之前不知道会换项目还是换页。 */}
              <button type="button" role="menuitem" className="wb-switch-all"
                      onClick={() => { setSwitchOpen(false); onBack() }}>
                <UiIcon icon={Folder} className="size-3.5" />全部项目
              </button>
            </div>
          )}
        </div>
        {/* 不再挂「/ 场景版本 vN」面包屑：正在看的版本由画面列顶栏的版本菜单负责，
            这里再写一遍是重复信息，也让顶栏读起来像一条固定的路径。 */}
      </div>
      {editMode && <div className="wb-projectbar-actions">{previewActions}</div>}
    </div>
  )
}
