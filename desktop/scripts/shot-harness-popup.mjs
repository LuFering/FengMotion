/**
 * 用 Playwright 驱动已安装的 Electron 应用，点开引擎弹窗并截图。
 *
 * 为什么不用 capturePage：主进程的 capturePage 只能拍到整页，拍不到「弹窗打开」这个瞬时状态。
 * 这里用真实交互（点击引擎按钮）打开弹窗，再截整页。
 *
 * 用法：
 *   API_BASE=http://127.0.0.1:18099/api node scripts/shot-harness-popup.mjs
 */
import { _electron as electron } from '/home/lufering/.dsh/dsh-browser/node_modules/.pnpm/node_modules/playwright-core/index.mjs'

const API_BASE = process.env.API_BASE ?? 'http://127.0.0.1:18099/api'
const OUT = process.env.OUT ?? '/tmp/fm-popup.png'
const ELECTRON = '/home/lufering/.local/opt/fengmotion-desktop/electron/electron'
const MAIN = '/home/lufering/.local/opt/fengmotion-desktop/app/main.cjs'

// Electron 不能用 chromium.launch（那是给普通浏览器用的），
// 必须走 _electron.launchApplication —— 它会自己解析 Electron 入口。
const app = await electron.launch({
  executablePath: ELECTRON,
  args: [MAIN, '--no-sandbox'],
  env: {
    ...process.env,
    FENGMOTION_API_BASE: API_BASE,
    // 必须清掉：本机环境里存在 ELECTRON_RUN_AS_NODE=1，它会让 Electron 退化成纯 Node，
    // 于是启动失败（Playwright 报 "Process failed to launch!"）。
    ELECTRON_RUN_AS_NODE: undefined,
  },
})

const page = await app.firstWindow()
await page.waitForLoadState('domcontentloaded')
const errors = []
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text())
})
await page.waitForSelector('.hf-harness', { timeout: 20000 })

// 点开引擎弹窗
await page.click('.hf-harness')
await page.waitForSelector('.hf-hp-item', { timeout: 10000 })
await page.waitForTimeout(600)

// 点进模型列表（二级面板），验证模型目录来自后端
let modelItems = []
const modelBtn = await page.$('.hf-hp-item')
if (modelBtn) {
  await modelBtn.click()
  await page.waitForTimeout(500)
  modelItems = await page.$$eval('.hf-hp-model', (nodes) =>
    nodes.map((n) => n.querySelector('.hf-hp-txt b')?.textContent ?? ''),
  )
  console.log('模型列表:', modelItems.join('、') || '(空)')
}

// 读出列表里的真实文案，供终端核对
const items = await page.$$eval('.hf-hp-item', (nodes) =>
  nodes.map((n) => ({
    name: n.querySelector('.hf-hp-txt b')?.textContent ?? '',
    state: n.querySelector('.hf-hp-txt small')?.textContent ?? '',
    off: n.hasAttribute('data-off'),
  })),
)
const head = await page.textContent('.hf-hp-head')
console.log('弹窗标题区:', (head ?? '').trim())
console.log('引擎列表:')
for (const it of items) console.log(`  - ${it.name}: ${it.state}${it.off ? ' [置灰]' : ''}`)

await page.screenshot({ path: OUT })
console.log(`\n截图: ${OUT}`)
if (errors.length) console.log('渲染进程错误:', errors.slice(0, 5).join(' | '))

await app.close()
