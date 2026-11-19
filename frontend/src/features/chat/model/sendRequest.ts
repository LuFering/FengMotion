import type { ComposerAttachment } from '@/features/chat/model/composerAttachment'
import type { TargetSnapshot } from '@/features/chat/hooks/useDraftStore'
import type { SessionsState } from '@/features/chat/hooks/useSessions'

/** 会话消息上的引用列表（与 `threads.sendMessage` 的 references 同型）。 */
export type MessageReferences = NonNullable<NonNullable<Parameters<SessionsState['sendMessage']>[2]>['references']>

/**
 * 只把「上传成功」的附件带上。上传中或失败的跳过 ——
 * 带一个没有 fileId 的附件过去，后端只能忽略或报错，都不如不带。
 * 用户看到失败标记时可以选择重试或去掉它。
 */
export function readyAttachments(attachments: ComposerAttachment[]) {
  return attachments
    .filter((a) => a.fileId && !a.uploading && !a.uploadError)
    // 字段名对齐契约 TaskAttachment：sizeBytes 而不是 size，不额外塞 kind
    // （后端能由 mimeType 推出归类，重复字段只会带来不一致风险）
    .map((a) => ({
      fileId: a.fileId!,
      name: a.name,
      mimeType: a.mimeType ?? '',
      sizeBytes: a.size,
    }))
}

/**
 * 在素材/参考引用之后补上这一轮的工程目标引用。
 *
 * <p>action 决定后端按「改工程」还是「只提问」处理，必须和发送判定一致。</p>
 */
export function withProjectTarget(refs: MessageReferences, input: {
  projectId: string | null | undefined
  targetSnapshot: TargetSnapshot | null | undefined
  isModifyIntent: boolean
  isWholeConfirmedContinuation: boolean
}): MessageReferences {
  const creationReferences: MessageReferences = [...refs]
  const { projectId, targetSnapshot, isModifyIntent, isWholeConfirmedContinuation } = input
  if (projectId) {
    if (targetSnapshot) {
      creationReferences.push({
        id: `ref-target-${projectId}`,
        role: isModifyIntent ? 'target' : 'context',
        kind: 'project',
        projectId,
        label: targetSnapshot.label || (targetSnapshot.rangeSpan ? `时间段（${targetSnapshot.rangeSpan.start}–${targetSnapshot.rangeSpan.end}）` : '工作台引用目标'),
        action: isModifyIntent ? 'workflow_modify' : 'workflow_query',
      })
    } else if (isWholeConfirmedContinuation && isModifyIntent) {
      /* 只有确定是修改时才推「整片工程修改」目标。
         用户已改成「关于此提问」时不能推这个 action —— 那会让后端按改工程处理。 */
      creationReferences.push({
        id: `ref-target-${projectId}`,
        role: 'target',
        kind: 'project',
        projectId,
        label: '整片工程修改',
        action: 'workflow_modify',
      })
    } else if (isWholeConfirmedContinuation) {
      /* 确认整片过、但用户改成了提问：仍把整片作为上下文带上，action 是查询。 */
      creationReferences.push({
        id: `ref-target-${projectId}`,
        role: 'context',
        kind: 'project',
        projectId,
        label: '整片工程（仅提问，不修改）',
        action: 'workflow_query',
      })
    } else if (isModifyIntent) {
      /* 明确选了「修改此目标」但没有局部目标、也没点过「确认整片」：
         这是一次整片工程修改，**必须推 workflow_modify 引用**。
         不推的话消息里没有任何修改标记，自动续流守卫
         （按 action === 'workflow_modify' 判断是否创作任务）识别不出来，
         于是修改提交完又额外起了一条普通对话回复 —— 实测复现：
         一次修改同时出现 AI 思考回复 + 创作任务两条线。
         同时这也让「这条消息触发的是哪种动作」在服务端历史里可查。 */
      creationReferences.push({
        id: `ref-target-${projectId}`,
        role: 'target',
        kind: 'project',
        projectId,
        label: '整片工程修改',
        action: 'workflow_modify',
      })
    }
  }
  return creationReferences
}

/** 修改说明：带时间段时在用户原话前标出「指定时间段 m:ss–m:ss」。 */
export function correctionTextFor(text: string, span: TargetSnapshot['rangeSpan'] | undefined): string {
  const spanText = span ? `${Math.floor(span.start / 60)}:${String(Math.floor(span.start % 60)).padStart(2, '0')}–${Math.floor(span.end / 60)}:${String(Math.floor(span.end % 60)).padStart(2, '0')}` : ''
  return spanText ? `【指定时间段 ${spanText}】\n\n用户原话：${text.trim()}` : text.trim()
}

/** 严格合规校验：必须是合法的图片数据（JPEG Data URL 或图片路径），绝不传递 mp4 视频文件。 */
export function previewImageOf(rawImg: string | null | undefined): string | undefined {
  return (rawImg && (rawImg.startsWith('data:image/') || rawImg.endsWith('.jpg') || rawImg.endsWith('.jpeg') || rawImg.endsWith('.png')))
    ? rawImg
    : undefined
}

/** 创作 requestId：可复用的旧 id 优先，否则新生成。 */
export function requestIdFor(oldReqId: string | null | undefined): string {
  return (oldReqId && oldReqId.trim())
    ? oldReqId.trim()
    : (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : '00000000-0000-4000-8000-' + String(Date.now()).padStart(12, '0'))
}
