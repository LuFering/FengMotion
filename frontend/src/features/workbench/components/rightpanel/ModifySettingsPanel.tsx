import type * as React from 'react'
import { UiIcon } from '@/shared/icons/UiIcon'
import { ChevronLeft, ArrowUpRight } from '@untitledui/icons'
import { SegmentedControl } from '@/shared/ui/segmented-control'
import { CONSTRAINT_LABELS, quickActions, type SideTab } from '@/features/workbench/model/workbenchConsole'
import { REAL_MODIFY_SUPPORTED_CONSTRAINTS } from '@/features/workbench/model/modifyConstraints'
import { Switch } from '@/shared/ui/switch'
import type { ModificationConstraints } from '@/api/studioApi'
import type { ViewId } from '@/shared/navigation/views'
import type { StageVisual } from '@/features/workbench/model/stageVisual'

export interface ModifySettingsPanelProps {
  constraints: ModificationConstraints
  onNavigate: (v: ViewId) => void
  onOpenReview: (tab: any) => void
  onQuickAction: (a: (typeof quickActions)[number]) => void
  onScopeChange: (next: 'project' | 'scene' | 'selection') => void
  preview: StageVisual | null
  scope: 'project' | 'scene' | 'selection'
  setConstraints: React.Dispatch<React.SetStateAction<ModificationConstraints>>
  setSideTab: (v: SideTab) => void
  sourceMode: boolean
}

/** 右栏的「修改设置」页：选择修改作用范围、开关保留条件，提供快捷操作，并显示当前预览来源。 */
export function ModifySettingsPanel({ constraints, onNavigate, onOpenReview, onQuickAction, onScopeChange, preview, scope, setConstraints, setSideTab, sourceMode }: ModifySettingsPanelProps) {
  return (
    <div className="fw-scroll">
      <div className="flex flex-col gap-3 p-3.5">
        <div className="flex items-center gap-2">
          <button className="wb-btn-ghost wb-insp-back" type="button" onClick={() => setSideTab('chat')}>
            <UiIcon icon={ChevronLeft} className="size-3" />返回对话
          </button>
          <span className="fw-panel-title">修改设置</span>
        </div>
        <div className="fw-scene-hd">修改作用范围</div>
        <SegmentedControl value={scope} onChange={onScopeChange}
                          ariaLabel="修改作用范围"
                          className="fw-scope-seg"
                          options={[
                            ...(preview ? [{ value: 'selection' as const, label: '当前预览' }] : []),
                            { value: 'project', label: '整个项目' },
                          ]} />

        <div className="wb-sep" />
        <button type="button" className="wb-desk-secondary" onClick={() => onOpenReview('brief')}>编辑特别保留要求 <UiIcon icon={ArrowUpRight} size="xs" /></button><div className="fw-scene-hd">保留条件</div>
        {CONSTRAINT_LABELS.map(([key, label]) => {
          /* 真实修改暂不执行这些约束：禁用而不是让人勾上然后静默忽略。
             勾了却不生效，用户会以为改动受到了保护。 */
          const supported = sourceMode || REAL_MODIFY_SUPPORTED_CONSTRAINTS.has(key)
          return (
            <div key={key} className="fw-constraint-row" data-unsupported={!supported || undefined}
                 title={supported ? undefined : '当前仅支持修改文字与颜色，该保留条件暂不生效'}>
              <span>{label}</span>
              <Switch checked={constraints[key]} disabled={!supported}
                      aria-label={label}
                      onCheckedChange={(checked) => setConstraints((c) => ({ ...c, [key]: checked }))} />
            </div>
          )
        })}
        <div className="wb-constraint-note">
          当前只支持「不修改其他场景」；其余保留条件暂不生效，已禁用。
        </div>

        <div className="wb-sep" />
        <div className="fw-scene-hd">快捷操作</div>
        <div className="grid grid-cols-3 gap-1.5">
          {quickActions.filter((a) => !['undo', 'redo', 'compare', 'assets', 'camera', 'captions'].includes(a.id)).map((a) => (
            <button key={a.id} type="button" onClick={() => onQuickAction(a)}
                    className="flex min-h-12 flex-col items-center justify-center gap-1 rounded-md border border-line bg-hole p-1 text-center text-[10px] text-dim transition-colors hover:border-acc/60 hover:text-fg">
              <a.icon className="size-3.5" />{a.label}
            </button>
          ))}
        </div>

        <div className="wb-sep" />
        <div className="fw-scene-hd">预览来源</div>
        <div className="rounded-md border border-line bg-hole p-2.5 text-[10.5px] leading-relaxed text-dim">
          {preview ? `${preview.tierLabel} · ${preview.name} · ${preview.origin === 'editor' ? '编辑版本' : '工作流'} v${preview.revision}` : '当前项目还没有生成可查看的预览。'}
        </div>
        <button className="mini h-7 justify-start text-[11px]" type="button" onClick={() => onNavigate('render')}>
          <UiIcon icon={ArrowUpRight} className="size-3" />打开渲染与交付
        </button>
      </div>
    </div>
  )
}
