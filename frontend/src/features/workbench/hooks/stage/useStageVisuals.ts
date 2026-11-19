import type * as React from 'react'
import { useMemo, useEffect } from 'react'
import { stageState, type StageVisual } from '@/features/workbench/model/stageVisual'
import { studioHttpApi } from '@/api'
import { workflowService } from '@/features/workflow/services/workflowService'
import { versionSeriesOf, resolveProjectVersion, findProjectVersionVisual, type ProjectVersionInfo } from '@/features/workbench/model/versionIdentity'
import { materialShelves } from '@/features/workbench/model/materialDeck'
import { contentOutline } from '@/features/workbench/model/contentOutline'
import { registerComposer } from '@/features/assets/hooks/usePendingAssets'
import { deliveredReferences } from '@/features/creation/services/creationResources'
import { useSceneVersions } from '@/features/workbench/hooks/useSceneVersions'
import type { ProjectSceneState } from '@/api/taskClient'
import type { WorkflowDef } from '@/features/workflow/model/workflowTypes'
import type { WorkbenchProps } from '@/features/workbench/Workbench'
import type { AgentReference } from '@/api/studioApi'

export interface UseStageVisualsArgs {
  currentSceneState: ProjectSceneState | null
  editorPreviews: StageVisual[]
  progressWorkflow: WorkflowDef | null
  projectId: WorkbenchProps['projectId']
  projectWorkflows: WorkflowDef[]
  referencesEdited: React.RefObject<boolean>
  runsTick: number
  sceneVersions: ReturnType<typeof useSceneVersions>
  setReferences: React.Dispatch<React.SetStateAction<AgentReference[]>>
  stageLive: boolean
  workflowsSnapshot: WorkflowDef[]
}

/**
 * 画面区的画面列表与版本基准：合并场景版本、编辑器试片与工作流产物，区分当前工程版本、可导出整片与可对比的两版；
 * 另提供素材卡与内容大纲，并接收从别处投递来的引用。
 */
export function useStageVisuals({ currentSceneState, editorPreviews, progressWorkflow, projectId, projectWorkflows, referencesEdited, runsTick, sceneVersions, setReferences, stageLive, workflowsSnapshot }: UseStageVisualsArgs) {
  /* 场景版本自带的视频：修改/创建任务真正提交过的那条片子。
     它与工作流产物是两条来源，但用户只关心「现在这条片子长什么样」，
     所以并进同一份画面列表；origin 标成 scene，让界面能说清它是哪来的。 */
  const sceneVisuals = useMemo<StageVisual[]>(() => {
    return sceneVersions.versions
      .filter((v) => Boolean(v.artifactPath))
      .map((v) => ({
        id: `scene:${v.version}`,
        origin: 'scene' as const,
        tier: 'final' as const,
        tierLabel: v.source === 'restore' ? `回退版本 v${v.version}` : `场景版本 v${v.version}`,
        name: v.artifactPath!.split('/').pop() ?? v.artifactPath!,
        media: 'video' as const,
        /* 场景版本存的是相对项目目录的路径（renders/xxx.mp4），
           而 <video src> 需要完整 URL。工作流产物的 file 本身就是可播放地址，
           所以这里必须自己转一次 —— 否则画面区会报「暂时无法播放」。 */
        file: studioHttpApi().artifacts.contentUrl(projectId, v.artifactPath!),
        /* 场景版本没有 runId / workflowId，但 StageVisual 要求这两项。
           用版本号占位而不是编一个工作流 ID —— 界面据此显示的是「场景版本」，不是工作流。 */
        runId: `scene-${v.version}`,
        artifactId: `scene-${v.version}`,
        workflowId: '',
        revision: v.version,
        createdAt: v.createdAt,
        artifactKind: 'scene-version',
        // 场景版本就是当前提交结果，不是「过期预览」
        stale: false,
      }))
  }, [sceneVersions.versions])

  const stage = useMemo(() => {
    const base = stageState(projectWorkflows, workflowService.listRuns())
    /* 场景版本优先排在最前：它是用户最近一次真实提交的结果，
       比工作流演示产物更该被当作「当前这条片子」。 */
    const seen = new Set<string>()
    const visuals = [...sceneVisuals, ...editorPreviews, ...base.visuals]
      .filter((visual) => seen.has(visual.file) ? false : (seen.add(visual.file), true))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    const combined = { ...base, visuals }
    return stageLive ? { ...combined, lastRunStatus: 'running' as const } : combined
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectWorkflows, workflowsSnapshot, runsTick, stageLive, editorPreviews, sceneVisuals])
  /* 有画面就显示「最靠后的那一档」（整片 > 粗略整片 > 试片 > 测试帧）。 */
  /* 画面区里「可以直接对比的两版」：同一个场景、都有真实视频文件、
     而且确实是两个不同版本 —— 只有一版时不给入口，避免点了没东西可比。 */
  const comparablePair = useMemo<[StageVisual, StageVisual] | null>(() => {
    const videos = sceneVisuals.filter((visual) => visual.media === 'video' && !!visual.file)
    if (videos.length < 2) return null
    /* 以当前正在看的那一版为基准，找另一个版本与它对照。 */
    const newest = videos[0]
    const other = videos.find((visual) => visual.id !== newest.id)
    return other ? [other, newest] : null
  }, [sceneVisuals])
  const stageLead: StageVisual | null = stage.visuals[0] ?? null
  /* 注：原先这里有个 `stageStale`（stageLead.stale），用于时间段/画面修改的
     前置校验。现在那两处校验改用 projectVersionLead（当前工程版本），
     过期判断由「服务端场景版本是否一致」承担，不再需要一个独立变量。 */
  /**
   * 最新可交付的整片。
   *
   * <p>为什么要与 stageLead 分开：visuals 按 createdAt 排序，刚渲染的编辑器试片
   * 会排在真实整片前面。如果「最新版本」和「导出目标」都跟着 stageLead 走，
   * 就会出现两种错误：菜单头把试片的导出次数当成项目版本号（写「最新 v2」，
   * 而场景版本其实到了 v4），导出按钮又因为首项不是 final 档而被禁用 ——
   * 项目明明有整片，用户却导不出来。</p>
   *
   * <p>所以这里单独挑出「最新的、没标过期的整片」：导出只认它，
   * 「最新 vN」也只报它。没有整片时如实为 null，由界面说明原因。</p>
   */
  const deliverableLead = useMemo<StageVisual | null>(() => {
    const finals = stage.visuals.filter((visual) => visual.tier === 'final' && !visual.stale)
    if (!finals.length) return null
    /* visuals 已按 createdAt 由近到远排序，取第一个就是最新整片。 */
    return finals[0]
  }, [stage.visuals])

  /**
   * 当前**工程版本** —— 场景序列里最新的那一条。
   *
   * <p>这是「修改要基于哪一版工程」的基准，与下面两个概念必须分开：</p>
   * <ul>
   *   <li>{@code stageLead}：画面列表首项，可能是编辑器试片（按创建时间排）。</li>
   *   <li>{@code deliverableLead}：最新可下载整片，导出只认它。</li>
   * </ul>
   *
   * <p>用 `stageLead` 当工程基准会误拒：场景 v4 才是当前工程版本，
   * 但列表首项若是刚渲染的试片 v2，`viewedPreview.id !== stageLead.id`
   * 就成立，用户拿着当前版本却被要求「先切回或恢复到当前版本」。</p>
   */
  const projectVersionLead = useMemo<StageVisual | null>(() => {
    const scenes = stage.visuals.filter((visual) => versionSeriesOf(visual) === 'scene')
    if (!scenes.length) return null
    /* 场景序列内取 revision 最大的那条 = 当前工程版本 */
    return scenes.reduce((best, cur) => (cur.revision > best.revision ? cur : best))
  }, [stage.visuals])

  /**
   * 当前工程版本号 —— 即使**没有对应的渲染画面**也要有值。
   *
   * <p>为什么要单独一份：`projectVersionLead` 只能从「有 artifactPath 的场景版本」
   * 里取（画面列表是这么构造的）。如果工程已经改到 v17 但这一版还没渲染出片，
   * 列表里最大的仍是 v16 —— 此时拿 v16 当基准会把 v16 自己判成「最新」，
   * 而真实工程版本已经往前走了一格。</p>
   *
   * <p>所以优先用后端 `currentSceneState.version`（权威），
   * 取不到才退回列表里的最大值。两者都没有时保持 null，界面不显示版本结论。</p>
   */
  const projectVersion = useMemo<ProjectVersionInfo>(() => {
    /* 【关键】后端在「项目还没有任何工程版本」时也会返回 version: 0
       （initialized=false）。0 不是一个版本号 —— 把它当权威工程版本会让界面
       显示「当前工程版本 v0」，并把真实存在的画面全判成「比 v0 新」。
       所以只有 initialized 为真时才认这个数字。 */
    const backendVersion = currentSceneState?.initialized === true
      ? currentSceneState.version
      : undefined
    return resolveProjectVersion(backendVersion, stage.visuals)
  }, [currentSceneState?.initialized, currentSceneState?.version, stage.visuals])
  const projectVersionNumber = projectVersion.version

  /**
   * 「回到当前工程版本」该跳到的那条画面。
   *
   * <p>不能跳 `deliverableLead`：它可能是工作流产物（另一条序列），
   * 也可能在「工程 v17、可下载画面仍是 v16」时把用户带到仍是历史的 v16。
   * 找不到对应画面时返回 null —— 界面应说明「尚无对应画面」，
   * 而不是给一个会跳错地方的入口。</p>
   */
  const projectVersionVisual = useMemo(
    () => findProjectVersionVisual(projectVersion, stage.visuals) as StageVisual | null,
    [projectVersion, stage.visuals],
  )

  /* 能导出的前提是这次制作真有整片那一档，且不是过期版本。
     试片、测试帧不能导出：那不是整片，导出来用户会以为拿到成片了。 */
  const stageDeliverable = Boolean(deliverableLead)
  /* 资料页那摞素材卡：本项目真实文件按格式堆叠，外加一张「缺失 / 不可用」。
     工作流引用节点绑定了哪些，卡片上如实标出（不吹成「AI 精选」）。 */
  const materials = useMemo(
    () => materialShelves(projectId, progressWorkflow?.nodes.find((n) => n.type === 'refs')?.params.assetIds as string[] ?? []),
    [projectId, progressWorkflow],
  )

  /* 内容页的行：整片之外，这部片真实有哪些内容单元。
     只读工作流运行产物（见 data/contentOutline.ts）。监看区的问题定位也用同一份行。
     运行记录在快照变化时重读 —— 执行器完成时快照不变，但目前执行器不产出场景结构，行不受影响。 */
  const outline = useMemo(
    () => contentOutline(workflowsSnapshot.filter((w) => w.projectId === projectId), workflowService.listRuns()),
    [workflowsSnapshot, projectId],
  )
  useEffect(() => {
    registerComposer((items) => {
      referencesEdited.current = true
      const incoming = deliveredReferences(items)
      setReferences((old) => [...old.filter((ref) => !incoming.some((next) => next.id === ref.id)), ...incoming])
      return true
    })
    return () => registerComposer(null)
  }, [])
  return { outline, projectVersion, stage, stageLead, projectVersionLead, deliverableLead, stageDeliverable, materials, projectVersionNumber, projectVersionVisual, sceneVisuals, comparablePair }
}
