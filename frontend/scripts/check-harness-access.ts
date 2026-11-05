/**
 * 联调自检：对着**真实后端**验证「DSH 是否接入」的判据与引擎匹配。
 *
 * 为什么需要它：`availabilityOf` 的判定链有四层（DSH 接入 → 引擎清单 → id 匹配 → 单引擎状态），
 * 每一层都可能出错，而纯单元测试需要伪造后端响应。这里直接打真后端，用真实响应验证。
 *
 * 用法：
 *   FENGMOTION_API_BASE=http://127.0.0.1:18099/api node --experimental-strip-types scripts/check-harness-access.ts
 *
 * 判据来源（FengMotion-backend/docs/接口清单-供前端改造.md §3、§4）：
 *   · `/api/capabilities` 的 `agent.status` —— DSH 是否接入
 *   · `/api/harnesses` —— 引擎清单
 */
import { studioHttpApi } from '../src/services/api/index.ts'
import { availabilityOf, matchHarness } from '../src/shell/useHarnesses.ts'

const failures: string[] = []
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}  | actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`)
  if (!ok) failures.push(label)
}

const api = studioHttpApi()

// 1) 能力声明里的 agent 项
const capabilities = await api.system.capabilities()
const agent = (capabilities as Record<string, { status?: string }>).agent
console.log(`\n后端 agent 能力：${JSON.stringify(agent)}`)

// 2) 引擎清单
let harnesses: { id: string; name: string; status: string }[] = []
let listState: 'ready' | 'not_implemented' | 'failed' = 'ready'
try {
  harnesses = (await api.harnesses.list()).items
} catch (cause) {
  listState = 'failed'
  console.log(`引擎清单读取失败：${cause instanceof Error ? cause.message : String(cause)}`)
}
console.log(`引擎清单：${listState} → ${JSON.stringify(harnesses)}\n`)

// 3) 按判据合成
const access = agent?.status === 'available' ? 'available' : agent?.status === 'demo' ? 'demo' : agent?.status === 'unavailable' ? 'unavailable' : 'unknown'
const probe = { access, listState, harnesses, cachedAt: null, note: null } as never

// 4) id 匹配：本地 `deepseek` 必须能对上次后端 `dsh-sdk`
const matched = matchHarness(harnesses as never, 'deepseek')
console.log(`本地 deepseek → 后端条目：${matched ? `${matched.id} (${matched.status})` : '未匹配'}\n`)

if (matched) {
  check('本地 deepseek 能匹配到后端引擎', matched.id, 'dsh-sdk')
} else if (listState === 'ready') {
  check('引擎清单可读时本地 deepseek 必须有匹配', 'matched', 'dsh-sdk')
}

const state = availabilityOf(probe, 'deepseek')
console.log(`合成结论：${state.state} —— ${state.note ?? '(无说明)'}\n`)

// 5) 未接入时必须显示「未接入」而不是「状态未知」
const unavailableProbe = { access: 'unavailable', listState, harnesses, cachedAt: null, note: null } as never
check('DSH 未接入 → 结论为未接入', availabilityOf(unavailableProbe, 'deepseek').state, 'not_connected')
check('DSH 未接入 → Claude 也未接入', availabilityOf(unavailableProbe, 'claude').state, 'not_connected')
check('DSH 未接入 → Codex 也未接入', availabilityOf(unavailableProbe, 'codex').state, 'not_connected')

// 6) 后端清单里没有的引擎 → 未接入（不是「状态未知」）
if (listState === 'ready') {
  check('清单里没有的引擎 → 未接入', availabilityOf(probe, 'claude').state, 'not_connected')
  check('清单里没有的引擎 → 未接入（codex）', availabilityOf(probe, 'codex').state, 'not_connected')
}

// 7) 能力声明读不到时才是「未知」
const unknownProbe = { access: 'unknown', listState: 'failed', harnesses: [], cachedAt: null, note: null } as never
check('读不到能力声明 → 状态未知', availabilityOf(unknownProbe, 'deepseek').state, 'unknown')

// 7) DSH 已接入且引擎可用 → 可用
if (access === 'available' && matched?.status === 'available') {
  check('DSH 已接入 + 引擎 available → 可用', state.state, 'available')
}

// 8) 模型列表字段名兼容
if (matched) {
  const models = await api.harnesses.models(matched.id)
  console.log(`\n模型列表：${JSON.stringify(models)}`)
  if (models.length > 0) {
    check('默认模型能被识别', models.some((m) => m.default), true)
    check('模型 id 非空', models.every((m) => m.id.length > 0), true)
  }
}

console.log(`\n检查项总数：${failures.length + 6}  失败：${failures.length}`)
if (failures.length > 0) {
  console.log(`失败项：${failures.join('、')}`)
  process.exit(1)
}
