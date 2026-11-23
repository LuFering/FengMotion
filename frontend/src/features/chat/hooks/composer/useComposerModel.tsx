import type * as React from 'react'
import { HARNESSES, prefsKey, DEFAULT_PREFS, savePrefs, type ModelPrefs } from '@/features/harness/model/harnesses'
import { useHarnesses, availabilityOf, modelsOf, matchHarness } from '@/features/harness/hooks/useHarnesses'
import { useMemo } from 'react'
import { ContextMeter, type Kind } from '@/features/chat/components/bencho/ContextMeter'
import type { ContextUsageSnapshot } from '@/features/chat/components/LeiBoxComposer'
import { shouldShowMessageMeter } from '@/features/chat/model/conversationRound'
import type { ContextBreakdown } from '@/api/contracts'
import type { ChatMessage } from '@/features/chat/hooks/useChat'

export interface UseComposerModelArgs {
  breakdown: ContextBreakdown | null
  contextUsed: number | null
  contextWindow: number | null
  harnessId: string
  messages: ChatMessage[]
  model: string
  prefs: Record<string, ModelPrefs>
  setPrefs: React.Dispatch<React.SetStateAction<Record<string, ModelPrefs>>>
  thinking: string | null
  toolsTokens: number | null
}

/** 对话输入区的引擎与模型派生值：可选引擎和模型清单、实际生效的模型，以及上下文占用的快照、分档与是否显示。 */
export function useComposerModel({ breakdown, contextUsed, contextWindow, harnessId, messages, model, prefs, setPrefs, thinking, toolsTokens }: UseComposerModelArgs) {
  /* ── 输入区派生值 ── */
  const harness = HARNESSES.find((h) => h.id === harnessId) ?? HARNESSES[0]
  const prefKey = prefsKey(harnessId, model)
  const currentPrefs: ModelPrefs = prefs[prefKey] ?? DEFAULT_PREFS
  void currentPrefs
  const setPref = (patch: Partial<ModelPrefs>) => {
    setPrefs((all) => {
      const next = { ...all, [prefKey]: { ...(all[prefKey] ?? DEFAULT_PREFS), ...patch } }
      savePrefs(next)
      return next
    })
  }
  void setPref
  /* 未接入的引擎不许发送（与首页同口径），附件/草稿至少有一个才算有内容。
     服务端会话同样可发：消息会真的保存（POST /chat-sessions/{id}/messages），
     只是回复要等 Agent 接入 —— 这一点由发送后的说明点明，不用禁用输入来表达。 */
  /**
   * 引擎可用性按**真实探测**判定（`/api/capabilities` 的 agent 项 + `/api/harnesses`），
   * 不用本地 harness.ready（那是演示数据）。
   *
   * 注意这里与服务端会话的差异：服务端会话发消息只要求「消息能保存」，
   * 后端 `POST /messages` 已实现（后端清单 §1.6 标 ✅），所以**不因引擎未接入而禁发**；
   * 本地草稿会话的回复要靠 Agent，未接入时发送没有意义，因此禁用。
   */
  const probe = useHarnesses()
  const harnessState = availabilityOf(probe, harness.id)
  void harnessState
  const stateOf = (id: string) => availabilityOf(probe, id)
  void stateOf
  /**
   * 模型列表以**后端目录**为准（`/api/harnesses/{id}/models`）。
   * 本地 `harness.models` 是产品侧写的名字，与 DSH 实际路由的模型不一致。
   */
  const modelsOfHarness = (id: string) => modelsOf(probe, id)

  /**
   * 当前选中的模型可能不在后端目录里（本地默认值 `deepseek-chat` 在 DSH 路由中并不存在）。
   *
   * 用**派生值**而不是 effect 里 setState：effect 里改状态会触发级联渲染
   * （react 规则 set-state-in-effect），而且派生更符合 React 的数据流方向。
   */
  const selectedHarness = matchHarness(probe.harnesses, harnessId)

  const composerHarnesses = useMemo(() => probe.harnesses.map((h) => ({
    id: h.id,
    name: HARNESSES.find((item) => item.id === (h.id === 'dsh-sdk' ? 'deepseek' : h.id))?.name ?? h.name,
    iconUrl: HARNESSES.find((item) => item.id === (h.id === 'dsh-sdk' ? 'deepseek' : h.id))?.icon ?? './assets/brand/deepseek.svg',
    available: h.status === 'available',
    models: (probe.modelsByHarness[h.id] ?? []).map((m) => ({ id: m.id, name: m.label || m.id, reasoningEfforts: m.reasoningEfforts })),
  })), [probe.harnesses, probe.modelsByHarness, probe.access])
  const backendModels = modelsOfHarness(selectedHarness?.id ?? harnessId).models
  const effectiveModel =
    backendModels.length === 0 || backendModels.some((m) => m.id === model)
      ? model
      : (backendModels.find((m) => m.default) ?? backendModels[0]).id
  /**
   * 五档强度始终可选，后端负责映射到模型真正支持的档位（不支持就逐级降级）。
   * 所以这里不做「模型是否支持该档」的拦截 —— 那会让用户以为选不了。
   */
  const effectiveEffort = thinking
  /**
   * 当前模型的上下文窗口（分母），来自后端模型目录。
   *
   * 这条兜底是必需的：DSH 只在 provider/model/窗口**变化时**才发一次
   * `request/context`，所以续接老会话时那一帧根本不会来（实测：全新会话有，
   * 续接会话没有）。只靠流里的帧，老会话的占用率永远不显示。
   * 模型目录里的 contextWindow 与流里那份是同一个值，可以直接用。
   */
  const modelContextWindow = backendModels.find((m) => m.id === effectiveModel)?.contextWindow

  /*
   * 组装官方输入框圆圈要的上下文快照。
   *
   * 字段名与形状照抄官方 hse 组件（contextUsage / context_window / blocks），
   * 不是我们自创的 —— 名字对不上官方会静默当作 null，圆圈恒显示 0%。
   *
   * 数据取「最后一条带 usage 的 AI 消息」：那是落库的持久事实，刷新后仍在；
   * 流式状态只在刚发完这一轮时存在，单独用会让圆圈一刷新就归零。
   */
  const lastUsageMsg = [...messages].reverse().find((m) => m.role === 'ai' && m.usage)?.usage
  const composerPromptTokens = lastUsageMsg?.promptTokens ?? contextUsed ?? null
  const composerWindow =
    lastUsageMsg?.contextWindow ?? contextWindow ?? modelContextWindow ?? 0
  const composerBreakdown = lastUsageMsg?.breakdown ?? breakdown ?? null
  /*
   * 上下文构成分档 —— 消息区那张卡片（.cv3-ctxmeter）的数据源。
   *
   * 原先它挂在输入框圆环上：圆环点开才看得到；现在圆环撤掉，
   * 卡片直接贴在每轮回复末尾，和 token 用量同一档辅助信息。
   *
   * 原版语义：k 是千 token，窗口也是千 token，一个点 = 1K。
   * resultsTokens（bash 回显等工具输出）并进 Tools —— 两者都是工具开销，
   * 且组件的 React key 与配色都要求 id 唯一。
   *
   * 没有真实数据（一次对话都没开始）时不渲染：画一个 0% 的空卡
   * 比不画更容易让人以为读数坏了。
   */
  const messageMeterKinds: Kind[] = composerBreakdown
    ? [
        { id: 'sys', name: '系统', k: composerBreakdown.systemTokens / 1000 },
        { id: 'tools', name: '工具', k: ((toolsTokens ?? 0) + composerBreakdown.resultsTokens) / 1000 },
        { id: 'files', name: '文件', k: composerBreakdown.filesTokens / 1000 },
        { id: 'chat', name: '对话', k: composerBreakdown.chatTokens / 1000 },
        { id: 'mem', name: '记忆', k: composerBreakdown.memoryTokens / 1000 },
      ]
    : []

  /* ⚠️ 必须等到**真的有实测 token 数**才给快照。
     只看窗口大小是不够的：窗口来自模型目录，任何状态下都有值，
     于是「一次对话都没开始」也会传出一个 projected_request_tokens: 0 的快照，
     官方圆圈据此画出 1%、并弹出「预计下一次请求 8k / 1M」的空面板 ——
     那正是用户看到的空状态 bug。没有数据就什么都不传，官方自己不渲染。 */
  const composerContextUsage: ContextUsageSnapshot | null =
    composerWindow > 0 && composerPromptTokens !== null && composerPromptTokens > 0
      ? {
          context_window: composerWindow,
          /* 官方自己会排序、算「其他/未归类」，渲染成列表，
             所以我们只按它的 kind/source/name/tokens 约定给原始分档。 */
          blocks: composerBreakdown
            ? [
                { kind: 'system', source: 'prompt', name: '系统提示', tokens: composerBreakdown.systemTokens },
                { kind: 'memory', source: 'rules', name: '记忆与规则', tokens: composerBreakdown.memoryTokens },
                { kind: 'files', source: 'files', name: '附件与文件', tokens: composerBreakdown.filesTokens },
                { kind: 'results', source: 'tools', name: '工具输出', tokens: composerBreakdown.resultsTokens },
                { kind: 'chat', source: 'turns', name: '对话', tokens: composerBreakdown.chatTokens },
              ].filter((b) => b.tokens > 0)
            : [],
          projected_request_tokens: composerPromptTokens,
        }
      : null

  /* 圆环点开的内容：Bencho 的 ContextMeter（点阵 + 分段条）。 */
  const composerMeterPanel =
    messageMeterKinds.length > 0 && composerWindow > 0 ? (
      <ContextMeter
        kinds={messageMeterKinds}
        windowK={Math.round(composerWindow / 1000)}
        style="Bar"
      />
    ) : null

  /**
   * 消息区卡片要不要画：必须**两个数都有**。
   *
   * 分子优先读落库的 promptTokens（刷新后仍在）；刚发完、消息还没落库那一瞬
   * 落库值为空，退回流里的实时水位 contextUsed —— 否则卡片会「发完就消失一帧」。
   * 分母同理：优先落库，其次流，最后模型目录（续接老会话时 DSH 不发那一帧）。
   */
  const messagePromptTokens = lastUsageMsg?.promptTokens ?? contextUsed ?? null
  /* 卡片画在列表末尾、每条回复的收尾处，属于当前这条回复。
     末尾不是 AI 回复时不画 —— 详见 shouldShowMessageMeter 的说明。 */
  const showMessageMeter = shouldShowMessageMeter({
    messages,
    hasBreakdown: messageMeterKinds.length > 0,
    window: composerWindow,
    promptTokens: messagePromptTokens,
  })
  return { backendModels, effectiveEffort, effectiveModel, selectedHarness, showMessageMeter, messageMeterKinds, composerWindow, composerHarnesses, composerContextUsage, composerPromptTokens, composerMeterPanel }
}
