import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createServer } from 'vite'
import { fileURLToPath } from 'node:url'

let server, turn, Content, render
before(async () => {
  server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
  turn = await server.ssrLoadModule('/src/services/assistantTurn.ts')
  Content = (await server.ssrLoadModule('/src/components/chat/AssistantTurnContent.tsx')).AssistantTurnContent
  render = (await import('react-dom/server')).renderToStaticMarkup
})
after(async () => { await server?.close() })

test('stage text brackets grouped calls live and after history reload', () => {
  const first = '先检查项目 🎬。'
  const next = '\n\n检查结束，现在修改。'
  const final = '\n\n修改通过验证。'
  let tools = []
  const start = (callId, textOffset) => { tools = turn.updateTurnTools(tools, { type: 'status', phase: 'tool', callId, name: 'read', textOffset }) }
  start('read-1', first.length)
  start('read-2', first.length)
  assert.deepEqual(turn.splitAssistantTurn(first, tools).map(block => block.kind), ['text', 'tools'])
  assert.equal(turn.splitAssistantTurn(first, tools)[1].calls.length, 2)
  tools = turn.updateTurnTools(tools, { type: 'status', phase: 'tool', callId: 'read-1' })
  start('edit', first.length + next.length)
  const text = first + next + final
  const blocks = turn.splitAssistantTurn(text, tools)
  assert.deepEqual(blocks.map(block => block.kind), ['text', 'tools', 'text', 'tools', 'text'])
  assert.equal(blocks[1].calls[0].done, true)
  assert.deepEqual(turn.splitAssistantTurn(text, JSON.parse(JSON.stringify(tools))), blocks)
  assert.equal(blocks.filter(block => block.kind === 'text').map(block => block.text).join(''), text)
})

test('no-argument calls are recorded once and result updates keep their offset', () => {
  const start = { type: 'status', phase: 'tool', callId: 'call', name: 'list', textOffset: 0 }
  const tools = turn.updateTurnTools([], start)
  assert.equal(tools.length, 1)
  assert.equal(tools[0].done, undefined)
  assert.equal(turn.updateTurnTools(tools, start).length, 1)
  const failed = turn.updateTurnTools(tools, { type: 'status', phase: 'tool', callId: 'call', isError: true })
  assert.deepEqual(failed[0], { ...tools[0], done: true, isError: true })
  assert.equal(failed[0].textOffset, 0)
})

test('retry corrections replace only the provisional tail and preserve unicode boundaries', () => {
  let text = '确认 🎬。'
  const confirmed = text
  const offset = text.length
  text = turn.applyTextDelta(text, '\n\n未确认文字')
  text = turn.applyTextDelta(text, '', offset)
  assert.equal(text, confirmed)
  text = turn.applyTextDelta(text, '\n\n已确认的新阶段')
  assert.equal(text, confirmed + '\n\n已确认的新阶段')
})

test('legacy or malformed offsets retain all content without inventing ordering', () => {
  const text = '历史回答'
  for (const offsets of [[undefined, undefined], [10, 20], [3, 1], [-1, 0], [NaN, 0]]) {
    const calls = offsets.map((textOffset, index) => ({ name: 'read', callId: String(index), textOffset }))
    const blocks = turn.splitAssistantTurn(text, calls)
    assert.deepEqual(blocks.map(block => block.kind), ['tools', 'text'])
    assert.equal(blocks[0].calls.length, 2)
    assert.equal(blocks[1].text, text)
  }
})

test('shared renderer places text and call groups in their real arrival order', () => {
  const text = '第一阶段\n\n第二阶段\n\n结束'
  const tools = [{ name: 'read', textOffset: 4 }, { name: 'read', textOffset: 4 }, { name: 'edit', textOffset: 10 }]
  const html = render(Content({ text, tools, renderText: body => body, renderTools: calls => `[${calls.map(call => call.name).join(',')}]` }))
  assert.ok(html.indexOf('第一阶段') < html.indexOf('[read,read]'))
  assert.ok(html.indexOf('[read,read]') < html.indexOf('第二阶段'))
  assert.ok(html.indexOf('第二阶段') < html.indexOf('[edit]'))
  assert.ok(html.indexOf('[edit]') < html.indexOf('结束'))
})

/* 咖啡那轮的真实形态：每一步「思考 → 正文 → 工具」，有的步骤没有正文，
   这一步的思考与上一步的工具落在同一个正文位置，只能靠 order 分先后。 */
test('stage reasoning sits before its own text and after the previous stage tools', () => {
  const s1 = '我理解你的目标。', s2 = '\n\n项目里已经有源码。'
  const text = s1 + s2
  let order = 0
  let segments = []
  let tools = []
  const think = (delta, textOffset) => { segments = turn.appendReasoningSegment(segments, delta, { textOffset, order: segments.at(-1)?.order === order - 1 && segments.at(-1)?.textOffset === textOffset ? order - 1 : order++ }) }
  const call = (callId, textOffset) => { tools = turn.updateTurnTools(tools, { type: 'status', phase: 'tool', callId, name: 'bash', textOffset, order: order++ }) }
  think('先看目录', 0); think('，再读原文', 0)          // 第 1 步：思考两次增量并成一段
  call('a', s1.length); call('b', s1.length)           // 第 1 步：正文后两次调用
  think('有旧版本', s1.length)                          // 第 2 步：与第 1 步工具同一位置
  call('c', text.length)
  think('没有正文的一步', text.length)                   // 第 3 步：只有思考和工具
  call('d', text.length)

  const blocks = turn.splitAssistantTurn(text, tools, segments)
  assert.deepEqual(blocks.map(block => block.kind), ['reasoning', 'text', 'tools', 'reasoning', 'text', 'tools', 'reasoning', 'tools'])
  assert.equal(blocks[0].text, '先看目录，再读原文')
  assert.deepEqual(blocks[2].calls.map(c => c.callId), ['a', 'b'])
  assert.equal(blocks[3].text, '有旧版本')
  assert.deepEqual(blocks[7].calls.map(c => c.callId), ['d'])
  assert.equal(blocks.filter(block => block.kind === 'text').map(block => block.text).join(''), text)

  const html = render(Content({ text, tools, reasoning: segments,
    renderText: t => `T:${t.trim()}|`, renderTools: c => `C:${c.map(x => x.callId).join('')}|`, renderReasoning: (t, last) => `R:${t}${last ? '*' : ''}|` }))
  assert.equal(html, 'R:先看目录，再读原文|T:我理解你的目标。|C:ab|R:有旧版本|T:项目里已经有源码。|C:c|R:没有正文的一步|C:d|')
})

test('old messages without segments or order keep the previous layout', () => {
  const text = '第一段。\n\n第二段。'
  const tools = [{ callId: 'x', name: 'read', textOffset: 4 }]
  assert.deepEqual(turn.splitAssistantTurn(text, tools).map(b => b.kind), ['text', 'tools', 'text'])
  // 有分段但工具缺 order（新旧数据混在一起）：不猜顺序，不分段，调用方退回整块思考
  const segments = [{ textOffset: 0, order: 0, text: '想法' }]
  assert.ok(!turn.splitAssistantTurn(text, tools, segments).some(b => b.kind === 'reasoning'))
  // 分段位置越界同样不分段
  const ordered = [{ callId: 'x', name: 'read', textOffset: 4, order: 1 }]
  assert.ok(!turn.splitAssistantTurn(text, ordered, [{ textOffset: 99, order: 0, text: '想法' }]).some(b => b.kind === 'reasoning'))
  assert.ok(turn.splitAssistantTurn(text, ordered, segments).some(b => b.kind === 'reasoning'))
})
