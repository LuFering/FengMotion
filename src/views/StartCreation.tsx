import { useEffect, useMemo, useState } from 'react'
import { WF_PRESETS, type WfPath } from '../data/workflowTemplates'
import { GENOMES } from '../data/genomes'
import { workflowService } from '../services/workflowService'
import type { ProjectSummary } from '../data/projects'
import type { NewProjectInput } from '../shell/useProjects'
import '../styles/start.css'

/**
 * 创作启动层（产品流程定案 M1）——不是独立页面，是首页发送后的就地承接层：
 * 默认快速（一键开始、自动运行），「进入专业制作」展开后才出现路径与资源。
 * 它只做四件事：承接需求、选制作方式（可跳过）、定归属、开始制作。
 * 方案、节点编辑、资源管理都不在这里。
 */

export interface LaunchResult {
  workflowId: string
  projectId: string | null
  autoRun: boolean
}

const READY_PRESETS = WF_PRESETS.filter((p) => p.status === 'ready')

export function StartCreation(props: {
  initialDraft: string
  projects: ProjectSummary[]
  onClose: () => void
  onCreateProject: (input: NewProjectInput) => ProjectSummary
  onLaunch: (r: LaunchResult) => void
  onBrowseLibrary: (view: 'assets' | 'reference' | 'knowledge') => void
}) {
  const [text, setText] = useState(props.initialDraft)
  const [presetId, setPresetId] = useState('general')
  const [proOpen, setProOpen] = useState(false)
  const [proPath, setProPath] = useState<WfPath>('prompt-first')
  const [belong, setBelong] = useState<string>('auto')

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') props.onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [props])

  const firstLine = useMemo(() => text.trim().split('\n')[0] ?? '', [text])
  /* 去 AI 味：首行太短 / 只有数字标点时不直接当名字（如测试输入“1”就成了工作流名“1”） */
  const usableName = firstLine.length >= 2 && !/^[\d\s\p{P}]+$/u.test(firstLine) ? firstLine : ''
  const wfName = usableName.slice(0, 24) || '未命名创作'
  const canStart = text.trim().length > 0

  const resolveProjectId = (): string | null => {
    if (belong !== 'auto') return belong
    const p = props.onCreateProject({
      name: usableName.slice(0, 14) || '未命名创作',
      genome: presetId === 'talking' ? 'explainer' : (GENOMES[0]?.id ?? 'explainer'),
      targetDuration: 180,
    })
    return p.id
  }

  const launch = (quick: boolean) => {
    if (!canStart) return
    const projectId = resolveProjectId()
    const wf = workflowService.createFromPath(quick ? 'prompt-first' : proPath, presetId, wfName, {
      projectId,
      seedPrompt: text,
    })
    props.onLaunch({ workflowId: wf.id, projectId, autoRun: quick })
  }

  return (
    <div className="stc-overlay" role="dialog" aria-modal="true" aria-label="开始制作"
         onMouseDown={(e) => { if (e.target === e.currentTarget) props.onClose() }}>
      <div className="stc-panel">
        <header className="stc-head">
          <b>开始制作</b>
          <button type="button" className="stc-x" onClick={props.onClose} aria-label="关闭">✕</button>
        </header>

        <label className="stc-label">你想做的视频</label>
        <textarea
          className="stc-text"
          rows={3}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="一句话说清这条视频：给谁看、讲什么、什么风格"
          autoFocus
        />

        <label className="stc-label">制作方式</label>
        <div className="stc-chips">
          {READY_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              className="stc-chip"
              data-on={presetId === p.id || undefined}
              onClick={() => setPresetId(p.id)}
              title={p.description}
            >
              {p.name}
            </button>
          ))}
          <span className="stc-chip-note">直接创作 · 用默认路径自动完成制作准备</span>
        </div>

        <label className="stc-label">归属项目</label>
        <select className="stc-select" value={belong} onChange={(e) => setBelong(e.target.value)}>
          <option value="auto">新建项目（按需求自动命名）</option>
          {props.projects.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>

        <button type="button" className="stc-primary" disabled={!canStart} onClick={() => launch(true)}>
          开始制作
        </button>
        <p className="stc-fine">开始后进入工作台自动运行，在工作台里看进度、预览与修改。当前为 DEMO 执行器：产出结构化快照，不生成真实视频。</p>

        <button type="button" className="stc-pro-toggle" onClick={() => setProOpen((v) => !v)} aria-expanded={proOpen}>
          进入专业制作 {proOpen ? '▴' : '▾'}
        </button>
        {proOpen && (
          <div className="stc-pro">
            <div className="stc-seg" role="radiogroup" aria-label="创作路径">
              <button type="button" data-on={proPath === 'prompt-first' || undefined} onClick={() => setProPath('prompt-first')}>
                Prompt-first
                <span>提示词直达创作，工作稿不是审批门</span>
              </button>
              <button type="button" data-on={proPath === 'structured' || undefined} onClick={() => setProPath('structured')}>
                Structured
                <span>分阶段产物 + Gate 检查点，逐步确认</span>
              </button>
            </div>
            <div className="stc-libs">
              <span>先备资源（可选）：</span>
              <button type="button" onClick={() => props.onBrowseLibrary('assets')}>素材库</button>
              <button type="button" onClick={() => props.onBrowseLibrary('reference')}>参考片库</button>
              <button type="button" onClick={() => props.onBrowseLibrary('knowledge')}>特效库</button>
            </div>
            <button type="button" className="stc-secondary" disabled={!canStart} onClick={() => launch(false)}>
              创建并进入工作台（不自动运行）
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
