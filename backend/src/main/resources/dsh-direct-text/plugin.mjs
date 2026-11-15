import fs from 'node:fs'

export const name = 'fengmotion-direct-text'
export const inject = ['llm', 'credentials']

// This short-lived bridge uses the provider already mounted in the selected profile.
// It never reads credentials or starts an Agent.
export function apply(ctx) {
  void (async () => {
    const resultPath = process.env.FENGMOTION_DIRECT_RESULT
    const publish = value => {
      const temporary = resultPath + '.tmp'
      fs.writeFileSync(temporary, JSON.stringify(value), { mode: 0o600 })
      fs.renameSync(temporary, resultPath)
    }
    try {
      const request = JSON.parse(fs.readFileSync(process.env.FENGMOTION_DIRECT_REQUEST, 'utf8'))
      for (let i = 0; i < 150 && !ctx.llm.listProviders().some(p => p.id === request.provider); i++) {
        await new Promise(resolve => setTimeout(resolve, 100))
      }
      if (!ctx.llm.listProviders().some(p => p.id === request.provider)) {
        publish({ error: 'PROVIDER_UNAVAILABLE' })
        return
      }
      let text = '', finish = null, usage = null, toolCalls = 0
      for await (const chunk of ctx.llm.stream({
        provider: request.provider, model: request.model,
        system: request.system || undefined,
        messages: [{ role: 'user', content: [{ type: 'text', text: request.prompt }] }],
        tools: [], maxTokens: request.maxTokens, signal: AbortSignal.timeout(request.timeoutMs)
      })) {
        if (chunk.type === 'text-delta') text += chunk.text
        if (chunk.type === 'tool-call-delta') toolCalls++
        if (chunk.type === 'usage') usage = chunk.usage
        if (chunk.type === 'finish') finish = chunk.reason
      }
      if (!finish || finish.kind !== 'stop' || toolCalls) {
        // Provider messages can contain credentials; expose only the structured code.
        const code = typeof finish?.failure?.code === 'string' && /^[A-Za-z0-9_.-]{1,80}$/.test(finish.failure.code)
          ? finish.failure.code : 'UNKNOWN'
        publish({ error: 'MODEL_' + (finish?.kind || 'NO_FINISH').toUpperCase().replace(/[^A-Z_]/g, '_'), code })
      } else publish({ text, usage })
    } catch (_) {
      publish({ error: 'BRIDGE_FAILURE' })
    }
  })()
}
