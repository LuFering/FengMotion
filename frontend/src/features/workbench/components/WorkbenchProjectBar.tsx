import type * as React from 'react'
import { UiIcon, SemIcons } from '@/shared/icons/UiIcon'
import { Folder } from '@untitledui/icons'
import type { ProjectSummary } from '@/features/project/model/projects'
import type { StageVisual } from '@/features/workbench/model/stageVisual'

export interface WorkbenchProjectBarProps {
  catalog: ProjectSummary[]
  editMode: boolean
  onBack: () => void
  onSwitchProject: (id: string) => void
  previewActions: React.JSX.Element
  project: ProjectSummary
  setSwitchOpen: React.Dispatch<React.SetStateAction<boolean>>
  split: { containerRef: React.RefObject<HTMLDivElement | null>; width: number; bounds: { min: number; max: number }; dragging: boolean; feedback: { offset: number; bend: number; stretch: number }; onPointerDown: (event: React.PointerEvent<HTMLElement>) => void; onPointerMove: (event: React.PointerEvent<HTMLElement>) => void; onPointerUp: (event: React.PointerEvent<HTMLElement>) => void; onPointerCancel: () => void; onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => void; onDoubleClick: () => void; reset: () => void }
  stageLead: StageVisual
  switchOpen: boolean
  switchRef: React.RefObject<HTMLDivElement | null>
}

/** 从 Workbench.tsx 原样拆出的界面区块；props 与原处的变量同名。 */
export function WorkbenchProjectBar({ catalog, editMode, onBack, onSwitchProject, previewActions, project, setSwitchOpen, split, stageLead, switchOpen, switchRef }: WorkbenchProjectBarProps) {
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
            <span className="wb-logo" aria-hidden="true"><UiIcon icon={SemIcons.film} size="sm" /></span>
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
        {/* 面包屑只留「项目 / 场景名」。原来还挂着内部编号（S01）与「当前成片」
            —— 编号是数据层的 id，用户不需要；「当前成片」是默认态，说出来等于没说。
            同理删掉右侧的分辨率/帧率/时长：分辨率与帧率画面角标已经有了，
            总时长底部状态条也有，这里是第三遍。 */}
        <span className="wb-crumb-sep">/</span>
        <span className="wb-crumb-scene">{stageLead ? stageLead.tierLabel : '制作工作台'}</span>
      </div>
      {editMode && <div className="wb-projectbar-actions">{previewActions}</div>}
    </div>
  )
}
