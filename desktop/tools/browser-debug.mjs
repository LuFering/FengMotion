#!/usr/bin/env node
/**
 * 浏览器调试工具（基于 Chrome DevTools Protocol）。
 *
 * 为什么需要它：项目里用的 Tabbit Browser 以 `--remote-debugging-port=0` 启动，
 * 端口是随机的；发现端口后就能直接读控制台、执行 JS、派发真实输入事件。
 *
 * 这比浏览器插件的 browser_click 更可靠：
 *   插件的点击只派发 `click`，不派发 `pointerdown`。Radix 这类组件靠
 *   `pointerdown` 开启菜单，于是会出现「点了没反应」的假象 —— 实际上是
 *   工具观测不到，不是应用坏了。
 *
 * 用法：
 *   node tools/browser-debug.mjs port                    # 列出可用端口与页面
 *   node tools/browser-debug.mjs console                 # 抓控制台（默认 5 秒）
 *   node tools/browser-debug.mjs console --ms 8000
 *   node tools/browser-debug.mjs eval "<js 表达式>"
 *   node tools/browser-debug.mjs click "<css 选择器>"     # 真实鼠标点击
 *   node tools/browser-debug.mjs type "<选择器>" "<文本>"
 *   node tools/browser-debug.mjs shot <输出路径>          # 截图
 *
 * 通用参数：
 *   --url <片段>    选择匹配该 URL 片段的页面（默认取第一个 localhost 页面）
 *   --port <端口>   指定调试端口（默认自动发现）
 */

import { execSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'

/* ── 端口发现 ───────────────────────────────────────────────
   Tabbit 用 --remote-debugging-port=0 让系统随机分配端口。
   从 /proc 里读 chrome 进程的监听端口，再逐个探 /json/version 确认
   是 DevTools 端点（有些端口是 CDP 的其它通道）。 */
function discoverPorts() {
  const ports = new Set()
  try {
    const out = execSync("ss -ltnp 2>/dev/null | grep -oE '127.0.0.1:[0-9]+.*chrome' || true", {
      encoding: 'utf8', shell: '/bin/bash',
    })
    for (const line of out.split('\n')) {
      const m = /127\.0\.0\.1:(\d+)/.exec(line)
      if (m) ports.add(Number(m[1]))
    }
  } catch { /* ss 不可用时退回下面的已知端口探测 */ }
  // 常见固定端口也试一下（Chrome/Electron 惯例）
  for (const p of [9222, 9223, 9224, 9333]) ports.add(p)
  return [...ports]
}

async function findDevToolsPort() {
  for (const port of discoverPorts()) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(800) })
      if (!res.ok) continue
      const info = await res.json()
      if (info.webSocketDebuggerUrl) return { port, browser: info.Browser }
    } catch { /* 该端口不是 CDP，继续 */ }
  }
  return null
}

/* ── CDP 连接 ─────────────────────────────────────────────── */
class Cdp {
  constructor(ws) {
    this.ws = ws
    this.id = 0
    this.pending = new Map()
    this.events = []
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data)
      if (msg.id && this.pending.has(msg.id)) {
        this.pending.get(msg.id)(msg)
        this.pending.delete(msg.id)
      } else if (msg.method) {
        this.events.push(msg)
      }
    })
  }

  static connect(url) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url)
      ws.addEventListener('open', () => resolve(new Cdp(ws)))
      ws.addEventListener('error', () => reject(new Error('无法连接该页面，可能已被关闭')))
    })
  }

  send(method, params = {}) {
    return new Promise((resolve) => {
      const id = ++this.id
      this.pending.set(id, resolve)
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }

  async evaluate(expression) {
    const r = await this.send('Runtime.evaluate', {
      expression, returnByValue: true, awaitPromise: true,
    })
    if (r.result?.exceptionDetails) {
      throw new Error(r.result.exceptionDetails.exception?.description ?? '求值失败')
    }
    return r.result?.result?.value
  }

  close() { this.ws.close() }
}

/* ── 页面选择 ─────────────────────────────────────────────── */
async function pickTarget(port, urlHint) {
  const res = await fetch(`http://127.0.0.1:${port}/json/list`)
  const pages = (await res.json()).filter((t) => t.type === 'page' && t.webSocketDebuggerUrl)
  if (pages.length === 0) throw new Error('没有可调试的页面')
  if (urlHint) {
    const hit = pages.find((p) => p.url.includes(urlHint))
    if (!hit) throw new Error(`没有匹配 "${urlHint}" 的页面。可选：\n` + pages.map((p) => '  ' + p.url).join('\n'))
    return hit
  }
  return pages.find((p) => p.url.includes('localhost')) ?? pages[0]
}

/* ── 命令实现 ─────────────────────────────────────────────── */

/** 抓一段时间内的控制台输出与未捕获异常。 */
async function cmdConsole(cdp, ms) {
  await cdp.send('Runtime.enable')
  await cdp.send('Log.enable')
  const collected = []

  /* Runtime.enable 只会把之后的事件推给我们，所以先连上再等。
     页面已存在的历史日志拿不到 —— 这是 CDP 的限制，不是本次实现的缺陷。 */
  const timer = setTimeout(() => {}, ms)
  await new Promise((resolve) => {
    const done = setTimeout(resolve, ms)
    const drain = setInterval(() => {
      while (cdp.events.length > 0) {
        const e = cdp.events.shift()
        if (e.method === 'Runtime.consoleAPICalled') {
          const text = e.params.args
            .map((a) => a.value ?? a.description ?? a.type)
            .join(' ')
          collected.push(`[${e.params.type}] ${text}`)
        } else if (e.method === 'Runtime.exceptionThrown') {
          const d = e.params.exceptionDetails
          collected.push(`[异常] ${d.exception?.description ?? d.text}`)
        } else if (e.method === 'Log.entryAdded') {
          collected.push(`[${e.params.entry.level}] ${e.params.entry.text}`)
        }
      }
    }, 50)
    setTimeout(() => { clearInterval(drain); clearTimeout(done); resolve() }, ms)
  })
  clearTimeout(timer)

  if (collected.length === 0) {
    console.log(`（${ms}ms 内无控制台输出。注意：只捕获连接之后的日志）`)
  } else {
    collected.forEach((l) => console.log(l))
  }
}

/**
 * 点击元素。
 *
 * <p><strong>为什么不用 element.click()</strong>：它只派发 `click`，
 * 不产生 `pointerdown`。Radix 这类组件（DropdownMenu 等）靠 `pointerdown`
 * 开启，用 element.click() 点击会「毫无反应」——曾据此误判附件菜单有 bug，
 * 白改了两版代码。</p>
 *
 * <p><strong>为什么也不用 Input.dispatchMouseEvent</strong>：在这套页面环境里
 * 实测它同样触发不了 Radix 的开启路径（引擎合成的事件走不到 React 的
 * pointer 监听）。只有页面内手动派发**完整序列**才可靠。</p>
 *
 * <p>序列按浏览器真实顺序：pointerdown → mousedown → pointerup → mouseup → click。
 * 顺序不能乱，Radix 在 pointerup 时判断是否构成一次有效点击。</p>
 */
async function cmdClick(cdp, selector) {
  const result = await cdp.evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return JSON.stringify({ ok: false, reason: 'not-found' });
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    const x = Math.round(r.left + r.width / 2);
    const y = Math.round(r.top + r.height / 2);
    const opts = {
      bubbles: true, cancelable: true, composed: true,
      clientX: x, clientY: y, button: 0, buttons: 1,
      pointerId: 1, pointerType: 'mouse', isPrimary: true,
    };
    el.dispatchEvent(new PointerEvent('pointerdown', opts));
    el.dispatchEvent(new MouseEvent('mousedown', opts));
    el.dispatchEvent(new PointerEvent('pointerup', { ...opts, buttons: 0 }));
    el.dispatchEvent(new MouseEvent('mouseup', { ...opts, buttons: 0 }));
    el.dispatchEvent(new MouseEvent('click', { ...opts, buttons: 0 }));
    return JSON.stringify({ ok: true, x, y, tag: el.tagName });
  })()`)

  const info = JSON.parse(result ?? '{"ok":false,"reason":"no-result"}')
  if (!info.ok) throw new Error(`找不到元素：${selector}`)
  await new Promise((r) => setTimeout(r, 350))
  console.log(`已点击 ${selector}（${info.tag}）@ (${info.x}, ${info.y})`)
}

/** 向输入框输入文本（走真实键盘事件，能触发 React 的 onChange）。 */
async function cmdType(cdp, selector, text) {
  await cmdClick(cdp, selector)
  for (const ch of text) {
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', text: ch })
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', text: ch })
  }
  console.log(`已输入 ${text.length} 个字符到 ${selector}`)
}

/** 截图，便于核对界面实际外观。 */
async function cmdShot(cdp, path) {
  const r = await cdp.send('Page.captureScreenshot', { format: 'png' })
  if (!r.result?.data) throw new Error('截图失败')
  writeFileSync(path, Buffer.from(r.result.data, 'base64'))
  console.log(`已保存截图：${path}`)
}

/* ── 入口 ─────────────────────────────────────────────────── */
async function main() {
  const argv = process.argv.slice(2)
  const flag = (name) => {
    const i = argv.indexOf(`--${name}`)
    return i >= 0 ? argv[i + 1] : undefined
  }
  const command = argv[0]

  if (!command || command === 'help' || command === '--help') {
    console.log(`浏览器调试工具（CDP）

  node tools/browser-debug.mjs pages                      列出页面
  node tools/browser-debug.mjs console [--ms 5000]        抓控制台
  node tools/browser-debug.mjs eval "<js>"                执行 JS
  node tools/browser-debug.mjs click "<css>"              真实鼠标点击
  node tools/browser-debug.mjs type "<css>" "<文本>"      输入文本
  node tools/browser-debug.mjs shot <路径>                截图

通用参数：--url <片段> 选页面；--port <端口> 指定调试端口`)
    return
  }

  let port = Number(flag('port')) || null
  if (!port) {
    const found = await findDevToolsPort()
    if (!found) {
      console.error('没找到 DevTools 调试端口。请确认浏览器以 --remote-debugging-port 启动。')
      process.exit(1)
    }
    port = found.port
    console.error(`[端口 ${port} · ${found.browser}]`)
  }

  if (command === 'pages') {
    const res = await fetch(`http://127.0.0.1:${port}/json/list`)
    for (const t of await res.json()) {
      if (t.type === 'page') console.log(`${t.id}\n  ${t.title}\n  ${t.url}`)
    }
    return
  }

  const target = await pickTarget(port, flag('url'))
  console.error(`[页面 ${target.title}] ${target.url}`)
  const cdp = await Cdp.connect(target.webSocketDebuggerUrl)

  try {
    switch (command) {
      case 'console': await cmdConsole(cdp, Number(flag('ms')) || 5000); break
      case 'eval': {
        const expr = argv[1]
        if (!expr) throw new Error('缺少表达式')
        const value = await cdp.evaluate(expr)
        console.log(typeof value === 'string' ? value : JSON.stringify(value, null, 1))
        break
      }
      case 'click': await cmdClick(cdp, argv[1]); break
      case 'type': await cmdType(cdp, argv[1], argv[2] ?? ''); break
      case 'shot': await cmdShot(cdp, argv[1] ?? '/tmp/shot.png'); break
      default: console.error(`未知命令：${command}`); process.exit(1)
    }
  } finally {
    cdp.close()
  }
}

main().catch((e) => { console.error('错误：' + e.message); process.exit(1) })
