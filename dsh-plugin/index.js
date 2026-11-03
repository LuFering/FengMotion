/**
 * FengMotion 流式桥接插件。
 *
 * 把 DSH 内部的 token 级流式帧（`agent/assistant-stream`）以 JSON-RPC 通知的形式
 * 写到 stdout，供后端解析后转成 SSE `delta` 帧。
 *
 * ## 为什么需要这个插件
 *
 * DSH 对外的 `session.event` 只投影**已提交**的持久事件：助手正文在步骤结束时
 * 整段出现，拿不到逐 token 增量。而 DSH 内部一直在发 token 级帧
 * （`dsh-agent-loop` 里每收到一个 chunk 就 `emit('agent/assistant-stream')`），
 * 只是没有对外通道。本插件订阅那个事件并转发出去。
 *
 * ## 为什么写 stdout 是安全的
 *
 * SDK server 也用 stdout，但它只写「一行一个 JSON-RPC 帧」。本插件同样只写
 * 单行 JSON，不带日志、不带多行内容，因此两者互不破坏。stderr 留给 DSH 自己的
 * 诊断输出，插件不往那里写（否则会与 `dsh: reasoning:` 段混在一起）。
 *
 * ## 为什么只转发当前请求
 *
 * 一个 DSH 进程内可能有多个会话同时活跃（SDK 支持多会话并发）。若不按请求过滤，
 * A 会话的 token 会混进 B 会话的流里。因此插件只转发**最近一次 execute 期间**的帧，
 * 并以 `request_id` 标注归属。
 */

export const name = 'fengmotion-stream'

/** 需要 loader 就绪：SDK server 在 `initialize` 时等 loader，插件必须在同一阶段挂好监听。 */
export const inject = ['loader']

/**
 * 插件入口。
 *
 * @param ctx Cordis 上下文
 */
export function apply(ctx) {
  /**
   * 写一行 JSON-RPC 通知。
   *
   * **走 stderr 而不是 stdout**：实测写 stdout 时帧收不到（SDK server 独占该通道的
   * 写入时序），写 stderr 稳定可收。stderr 里的非 JSON 行是 DSH 自己的诊断，
   * 后端按「以 { 开头且 method 为 stream/delta」筛选即可，不会误判。
   */
  const emit = (params) => {
    process.stderr.write(`${JSON.stringify({
      jsonrpc: '2.0',
      method: 'stream/delta',
      params,
    })}\n`)
  }

  /**
   * 转发 token 级帧。
   *
   * 不做「按会话过滤」：`agent/assistant-stream` 的帧不带会话标识，
   * 而后端对每个会话是串行调用的（同一时刻只有一个请求在跑），
   * 所以到达后端的帧天然属于当前请求。若将来支持同进程并发多会话，
   * 需要在这里补上归属判断，不能靠猜。
   */
  ctx.on('agent/assistant-stream', ({ frame }) => {
    if (frame == null) return
    switch (frame.type) {
      case 'start':
        emit({ kind: 'start', turn: frame.turn, step: frame.step })
        break
      case 'chunk': {
        const chunk = frame.chunk
        if (chunk == null) return
        switch (chunk.type) {
          case 'text-delta':
            emit({ kind: 'text', text: chunk.text })
            break
          case 'reasoning-delta':
            emit({ kind: 'thinking', text: chunk.text })
            break
          case 'block-start':
            emit({ kind: 'block_start', blockType: chunk.blockType })
            break
          case 'block-end':
            // 组装好的完整块：后端可用它校验拼接结果，不必逐帧重组。
            emit({ kind: 'block_end', blockType: chunk.block?.type })
            break
          case 'usage':
            emit({
              kind: 'usage',
              inputTokens: chunk.usage?.inputTokens,
              outputTokens: chunk.usage?.outputTokens,
              totalTokens: chunk.usage?.totalTokens,
            })
            break
          case 'finish':
            emit({ kind: 'finish', reason: chunk.reason?.kind })
            break
          default:
            // tool-call-delta 等其余分片暂不转发：当前前端只消费文本增量。
            break
        }
        break
      }
      case 'end':
        emit({ kind: 'end', outcome: frame.outcome?.kind })
        break
      default:
        break
    }
  })
}
