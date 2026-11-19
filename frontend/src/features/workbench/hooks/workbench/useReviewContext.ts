import type * as React from 'react'
import { useState, useMemo, useCallback, useEffect } from 'react'
import type { AgentReference } from '@/api/studioApi'
import { workflowResourceReferences } from '@/features/workflow/services/workflowService'
import { useWorkbenchReview } from '@/features/workbench/hooks/useWorkbenchReview'
import { summarizeRounds } from '@/features/workbench/services/workbenchReviewService'
import { studioHttpApi } from '@/api'
import { useBoundSession } from '@/features/workbench/hooks/workbench/useBoundSession'
import type { BackendCapabilityInfo } from '@/features/workbench/services/workbenchCapabilityEvaluator'
import type { WorkflowDef } from '@/features/workflow/model/workflowTypes'
import type { WorkbenchProps } from '@/features/workbench/Workbench'

export interface UseReviewContextArgs {
  backendCapability: BackendCapabilityInfo
  capabilityProbe: number
  progressWorkflow: WorkflowDef | null
  projectId: WorkbenchProps['projectId']
  projectRecords: ReturnType<typeof useBoundSession>['projectRecords']
  projectTask: ReturnType<typeof useBoundSession>['projectTask']
  selectedTaskRecordId: string | null
  setBackendCapability: React.Dispatch<React.SetStateAction<BackendCapabilityInfo>>
  setCapabilityProbe: React.Dispatch<React.SetStateAction<number>>
}

/** 从 Workbench.tsx 的 Workbench 原样搬出的一段状态与逻辑；参数与返回值和原处的变量同名。 */
export function useReviewContext({ backendCapability, capabilityProbe, progressWorkflow, projectId, projectRecords, projectTask, selectedTaskRecordId, setBackendCapability, setCapabilityProbe }: UseReviewContextArgs) {
  const [references, setReferences] = useState<AgentReference[]>(() => progressWorkflow ? workflowResourceReferences(progressWorkflow) : [])
  const originalBrief = String(progressWorkflow?.nodes.find((n) => n.type === 'prompt')?.params.text ?? progressWorkflow?.description ?? '')
  const review = useWorkbenchReview(projectId, originalBrief)
  /* 每一轮的真实输入差异。演示执行器不写文件，所以这里归纳的是「提交了什么」，
     不是文件改动清单 —— 变更清单在演示下本就为空，不能编。 */
  const roundSummaries = useMemo(() => summarizeRounds(review.opinions), [review.opinions])
  const retryBackendCapability = useCallback(() => setCapabilityProbe((n) => n + 1), [])
  useEffect(() => {
    let active = true
    setBackendCapability({ status: 'checking' })
    void studioHttpApi().workflowContext.previewImageCapability(projectId)
      .then((capability) => {
        if (!active) return
        /* 画面与时间段需要的接口不同，分开记录，避免一项缺失把另一项也关掉。 */
        const missingForSpan: string[] = []
        if (!capability.baseVersionCheck) missingForSpan.push('版本预检校验')
        if (!capability.atomicCorrection) missingForSpan.push('原子意见保存')
        if (!capability.correctionRetryId) missingForSpan.push('重试任务标识')
        const missingForImage = capability.supported ? [...missingForSpan] : ['画面图像接收', ...missingForSpan]
        setBackendCapability({
          status: missingForSpan.length > 0 ? 'unsupported' : 'ready',
          spanSupported: missingForSpan.length === 0,
          imageSupported: missingForImage.length === 0,
          missingForSpan,
          missingForImage,
        })
      })
      .catch((err) => {
        if (!active) return
        const msg = err instanceof Error ? err.message : String(err)
        setBackendCapability({ status: 'connection_error', error: msg })
      })
    return () => { active = false }
  }, [projectId, capabilityProbe])
  /* 后端恢复后自动重探：只在「连接失败」状态下轮询，避免常态打扰服务。 */
  useEffect(() => {
    if (backendCapability.status !== 'connection_error') return
    const timer = window.setTimeout(() => setCapabilityProbe((n) => n + 1), 15000)
    return () => window.clearTimeout(timer)
  }, [backendCapability.status, capabilityProbe])

  const selectedTaskRecord = projectRecords.find((r) => r.task.id === selectedTaskRecordId) ?? projectRecords[0] ?? null
  const selectedTask = selectedTaskRecord ? (projectTask?.task?.id === selectedTaskRecord.task.id ? projectTask.task : selectedTaskRecord.task) : (projectTask?.task ?? null)
  return { setReferences, review, references, selectedTaskRecord, selectedTask, retryBackendCapability, roundSummaries }
}
