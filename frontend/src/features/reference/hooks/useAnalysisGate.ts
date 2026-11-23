import { useEffect, useState } from 'react'
import { studioHttpApi, mergeCapability, capabilityGate } from '@/api'

export interface AnalysisGate {
  enabled: boolean
  reason: string
}

/**
 * 「开始分析」的闸门：读 `GET /capabilities` 的 `referenceAnalysis`。
 * 只有 available 放行；缺项、demo、读取失败都按不可用处理，旁注用服务端 note。
 * 它只是提前提示 —— 真点下去后端仍可能返回 422，调用方照常处理。
 */
export function useAnalysisGate(): AnalysisGate {
  const [gate, setGate] = useState<AnalysisGate>({ enabled: false, reason: '正在确认解析能力' })
  useEffect(() => {
    let alive = true
    studioHttpApi().system.capabilities()
      .then((caps) => {
        if (alive) setGate(capabilityGate(mergeCapability(caps.referenceAnalysis), '参考片解析'))
      })
      .catch(() => {
        if (alive) setGate({ enabled: false, reason: '无法读取解析能力' })
      })
    return () => { alive = false }
  }, [])
  return gate
}
