import type { ChatMessage as ContractMessage } from '@/api/contracts'
import type { UseRealModifyArgs, RealModifyInput } from '@/features/workbench/hooks/workbench/useRealModify'

/**
 * 普通场景的修改路径：先读当前场景做版本预检，再走后端 modify 任务。
 *
 * <p>从 submitRealModify 原样拆出；异常照旧抛给 submitRealModify 统一处理。</p>
 */
export async function submitSceneModify(
  { buildRequest, chat, constraints, ensureBoundSession, pendingSubmissionRef, projectId, refreshCurrentScene, review, setBottomTab, setRealModifyError, tasks, threads, updatePendingSubmission }: UseRealModifyArgs,
  { prompt, span }: RealModifyInput,
): Promise<boolean> {
  if (span) {
    setRealModifyError('当前项目的场景修改方式暂不支持按时间段修改，未提交请求。')
    return false
  }

  /* 先读当前场景：既拿到 baseVersion 做版本预检，也确认项目确实有场景。
     没有场景时不能提交 —— 后端会拒绝，前端也不该把一个注定失败的请求发出去。 */
  const probe = await tasks.currentScene(projectId)
  if (!probe.scene) {
    setRealModifyError(probe.failure.message || '读取当前场景失败')
    return false
  }
  if (!probe.scene.initialized) {
    /* 修改需要已有场景做基线，没有就明确拒绝。
       这里刻意不再自己造一条「从一句话生成」的旁路：项目已有的
       workflow-v0.1.1 才是创作路径，绕开它另做一条简化管线
       （比如只生成文字卡片）会偏离产品方向，也让两套流程并存。
       真正的创作入口应走工作流，等它接通后替换这句提示。 */
    setRealModifyError('项目还没有场景。请先在工作流里创作一条片子，再对它提出修改。')
    return false
  }

  /* 范围沿用 buildRequest 的推导结果：它在到处都在用，另写一份
     「哪一段」的判定迟早会和它给出不同答案。selection 第一版后端不支持，
     按 project 提交前必须先告诉用户，不能悄悄放大范围。 */
  const derived = buildRequest(prompt, 'modify', constraints)
  if (review.keepNotes.trim()) {
    setRealModifyError('已保存的保留要求暂不参与真实修改。请先清除该要求；当前无法保证这些保留条件。')
    return false
  }
  if (derived.references?.some((ref) => ref.role === 'context')) {
    setRealModifyError('当前场景修改模式暂不支持带入参考上下文。若需提交，请先在引用栏中移除参考引用或清空后再试。')
    return false
  }
  if (derived.scope === 'selection') {
    setRealModifyError('选区修改暂不支持，请改为选定某个场景或整片后再试')
    return false
  }
  // 备用路径同样严格接入服务端会话与持久化，杜绝孤儿消息
  const sessionResult = await ensureBoundSession(prompt)
  if (sessionResult.error || !sessionResult.sessionId) {
    setRealModifyError(`会话未保存：${sessionResult.error || '未能创建项目会话'}。输入已保留，未提交修改任务。`)
    return false
  }
  const effectiveSid = sessionResult.sessionId

  const useScene = derived.scope === 'scene' && derived.sceneIds.length > 0
  const altTargetRef: NonNullable<ContractMessage['references']>[number] = useScene && derived.sceneIds[0]
    ? {
        id: `ref-scene-${derived.sceneIds[0]}`,
        role: 'target',
        kind: 'scene',
        sceneId: derived.sceneIds[0],
        label: '场景修改',
        action: 'workflow_modify',
      }
    : {
        id: `ref-project-${projectId}`,
        role: 'target',
        kind: 'project',
        projectId,
        label: '全局项目修改',
        action: 'workflow_modify',
      }
  const altReferences: NonNullable<ContractMessage['references']> = [altTargetRef]

  // 统一两条提交路径的重试幂等与状态解耦
  const promptKey = `${effectiveSid}:${projectId}:${prompt}:alt`
  const isRetrySamePrompt = pendingSubmissionRef.current?.promptKey === promptKey
  let userMsgId = isRetrySamePrompt && pendingSubmissionRef.current?.userMessageId ? pendingSubmissionRef.current.userMessageId : null
  const altIdempotencyKey = isRetrySamePrompt && pendingSubmissionRef.current?.idempotencyKey ? pendingSubmissionRef.current.idempotencyKey : crypto.randomUUID()

  if (!userMsgId) {
    const nextPending = {
      promptKey,
      idempotencyKey: altIdempotencyKey,
      sessionId: effectiveSid,
      path: 'alt' as const,
      createdAt: Date.now(),
    }
    updatePendingSubmission(nextPending)

    if (threads) {
      try {
        const savedMsg = await threads.sendMessage(effectiveSid, prompt, {
          idempotencyKey: altIdempotencyKey,
          references: altReferences,
        })
        userMsgId = savedMsg.id
        updatePendingSubmission({ ...nextPending, userMessageId: savedMsg.id })
      } catch (saveErr: unknown) {
        const msg = saveErr instanceof Error ? saveErr.message : String(saveErr)
        setRealModifyError(`会话消息未能写入服务端：${msg}。输入内容已保留，未提交修改任务。`)
        return false
      }
    } else {
      userMsgId = `m-wb-alt-${Date.now().toString(36)}`
      updatePendingSubmission({ ...nextPending, userMessageId: userMsgId })
    }

    chat.appendMessage({
      id: userMsgId,
      role: 'user',
      text: prompt,
      projectId,
      sessionId: effectiveSid,
      references: altReferences,
      at: Date.now(),
    })
  }

  // 消息已落盘后，启动后台任务
  const result = await tasks.startModify(projectId, {
    kind: 'modify',
    prompt,
    scope: useScene ? 'scene' : 'project',
    sceneIds: useScene ? derived.sceneIds : [],
    baseVersion: probe.scene.version,
  }, (status) => {
    /* 任务结束后重新读取当前场景：
       - completed：场景已被后端提交为新版本，界面必须立刻反映新内容与新版本
       - 其它：也重读一次，以免界面停留在提交前的旧版本上继续修改
       这一步失败不提示：任务结果本身还没展示完，再弹一个错误会盖住它。 */
    void refreshCurrentScene(status)
  })
  if (!result.taskId) {
    const failure = result.failure
    /* 冲突单独给一句：用户需要知道「刷新后重试」，而不是以为要求写错了 */
    const hint = failure?.reason === 'conflict'
      ? '场景已被其他操作更新，请刷新后再试'
      : failure?.message
    setRealModifyError(`任务启动失败：${hint || '提交失败'}。意见已记录在会话中。`)
    return false
  }
  setRealModifyError('')
  updatePendingSubmission(null)
  // 审阅记录只包含真实提交的目标与文字，不把本地需求、引用或保留条件当成发送记录。
  review.record({
    ...derived,
    scope: useScene ? 'scene' : 'project',
    sceneIds: useScene ? derived.sceneIds : [],
    references: (derived.references ?? []).filter((ref) => ref.role === 'target' && (ref.kind === 'project' || (useScene && ref.kind === 'scene'))),
    constraints: { preserveCamera: false, preserveCaptions: false, limitToSelection: useScene, reuseExistingComponents: false },
  }, { includeBrief: false })

  // 真实落盘至前端 chat，带有确定性 ID、taskId 与 target 引用
  chat.appendMessage({
    id: userMsgId,
    role: 'user',
    text: prompt,
    projectId,
    sessionId: effectiveSid,
    taskId: result.taskId,
    references: altReferences,
    at: Date.now(),
  })
  setBottomTab('activity')
  return true
}
