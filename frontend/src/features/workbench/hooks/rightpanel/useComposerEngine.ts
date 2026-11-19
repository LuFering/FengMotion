import { useHarnesses, matchHarness, modelsOf } from '@/features/harness/hooks/useHarnesses'
import { useHarnessSelection, setHarnessSelection } from '@/features/harness/hooks/useHarnessSelection'
import { useMemo } from 'react'
import { HARNESSES } from '@/features/harness/model/harnesses'

/** 工作台输入框的引擎选择：提供可选引擎及其模型列表、当前生效的模型，以及切换引擎、模型和推理强度的方法。 */
export function useComposerEngine() {
  /* ── 输入框里的引擎 / 模型 / 推理强度 ──
     与对话界面同一套派生逻辑：模型列表以**后端目录**为准
     （`/api/harnesses/{id}/models`），本地 harness.models 只是产品侧写的名字，
     与 DSH 实际路由的模型对不上。 */
  const probe = useHarnesses()
  const engineSelection = useHarnessSelection()
  const harnessId = engineSelection.harness
  const setHarnessId = (harness: string) => setHarnessSelection({ harness, model: undefined, reasoningEffort: undefined })
  const model = engineSelection.model ?? ''
  const setModel = (model: string) => setHarnessSelection({ model })
  const workbenchEffort = engineSelection.reasoningEffort ?? null
  const setWorkbenchEffort = (level: string) => setHarnessSelection({ reasoningEffort: level })
  const selectedHarness = matchHarness(probe.harnesses, harnessId)
  const composerHarnesses = useMemo(() => probe.harnesses.map((h) => ({
    id: h.id,
    name: HARNESSES.find((item) => item.id === (h.id === 'dsh-sdk' ? 'deepseek' : h.id))?.name ?? h.name,
    iconUrl: HARNESSES.find((item) => item.id === (h.id === 'dsh-sdk' ? 'deepseek' : h.id))?.icon ?? './assets/brand/deepseek.svg',
    available: h.status === 'available',
    models: (probe.modelsByHarness[h.id] ?? []).map((m) => ({ id: m.id, name: m.label || m.id, reasoningEfforts: m.reasoningEfforts })),
  })), [probe.harnesses, probe.modelsByHarness, probe.access])
  const backendModels = modelsOf(probe, selectedHarness?.id ?? harnessId).models
  const effectiveModel =
    backendModels.length === 0 || backendModels.some((m) => m.id === model)
      ? model
      : (backendModels.find((m) => m.default) ?? backendModels[0]).id
  void effectiveModel
  void workbenchEffort
  return { backendModels, effectiveModel, composerHarnesses, selectedHarness, setHarnessId, setModel, setWorkbenchEffort, workbenchEffort }
}
