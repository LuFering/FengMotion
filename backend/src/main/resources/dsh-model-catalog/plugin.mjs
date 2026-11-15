import fs from 'node:fs'

export const name = 'fengmotion-model-catalog'
export const inject = ['llm', 'credentials']

// Publish only the fields consumed by the backend, never adapter errors or configuration.
export function apply(ctx) {
  void (async () => {
    const result = process.env.FENGMOTION_CATALOG_RESULT
    const publish = value => {
      const temporary = result + '.tmp'
      fs.writeFileSync(temporary, JSON.stringify(value), { mode: 0o600 })
      fs.renameSync(temporary, result)
    }
    try {
      const { provider } = JSON.parse(fs.readFileSync(process.env.FENGMOTION_CATALOG_REQUEST, 'utf8'))
      for (let i = 0; i < 150 && !ctx.llm.listProviders().some(p => p.id === provider); i++) {
        await new Promise(resolve => setTimeout(resolve, 100))
      }
      if (!ctx.llm.listProviders().some(p => p.id === provider)) return publish({ error: 'PROVIDER_UNAVAILABLE' })
      const models = await ctx.llm.listModels(provider)
      const entries = await Promise.all(models.map(async model => {
        try {
          const info = await ctx.llm.resolveModelInfo(provider, model.id)
          return {
            id: info.id, label: info.name || info.id,
            contextWindow: info.context?.contextWindow ?? null,
            maxTokens: null,
            reasoningEfforts: info.reasoning ? info.reasoning.efforts.map(e => e.id) : []
          }
        } catch (_) {
          // A single failed lookup must not hide the remaining models.
          return { id: model.id, label: model.name || model.id, contextWindow: null, maxTokens: null, reasoningEfforts: null }
        }
      }))
      publish({ entries })
    } catch (_) {
      try { publish({ error: 'BRIDGE_FAILURE' }) } catch (_) { /* parent observes exit or timeout */ }
    }
  })()
}
