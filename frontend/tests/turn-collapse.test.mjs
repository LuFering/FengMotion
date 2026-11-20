import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { startViteForModules } from './support/fake-studio.mjs'

/*
 * 一轮结束后收起执行过程（AssistantTurnContent 的 hideProcess）：
 * 只留交付正文 —— 最后一组工具调用之后的那段；夹在调用之间的过程说明一起收起。
 */

let server
let mod
before(async () => {
  server = await startViteForModules()
  mod = await server.ssrLoadModule('/src/features/chat/components/AssistantTurnContent.tsx')
})
after(async () => { await server?.close() })

const text = '我先看一下项目。' + '再确认渲染链路。' + '已交付成片。'
const a = '我先看一下项目。'.length
const b = a + '再确认渲染链路。'.length
const tools = [
  { callId: 't1', name: 'bash', textOffset: a, order: 1, done: true },
  { callId: 't2', name: 'bash', textOffset: b, order: 2, done: true },
]
const render = (props) => renderToString(createElement(mod.AssistantTurnContent, {
  text, tools,
  renderText: (t) => createElement('p', null, t),
  renderTools: (calls) => createElement('i', null, `tools:${calls.length}`),
  ...props,
}))

test('展开时按顺序显示全部正文与工具调用', () => {
  const html = render({})
  assert.match(html, /我先看一下项目。.*tools:1.*再确认渲染链路。.*tools:1.*已交付成片。/)
})

test('收起时只留最后一组调用之后的交付正文', () => {
  const html = render({ hideProcess: true })
  assert.doesNotMatch(html, /我先看一下项目|再确认渲染链路|tools:/)
  assert.match(html, /已交付成片。/)
})

test('一轮以工具调用结尾时，收起后退回显示最后一段正文，不留空白', () => {
  const short = '我先看一下项目。再确认渲染链路。'
  const html = renderToString(createElement(mod.AssistantTurnContent, {
    text: short,
    tools: [{ callId: 't1', name: 'bash', textOffset: a, order: 1 }, { callId: 't2', name: 'bash', textOffset: short.length, order: 2 }],
    renderText: (t) => createElement('p', null, t),
    renderTools: () => createElement('i', null, 'tools'),
    hideProcess: true,
  }))
  assert.match(html, /再确认渲染链路。/)
  assert.doesNotMatch(html, /我先看一下项目|tools/)
})
