// 真实端到端联调：把线上录到的数据 POST 给本地 Python 后端，并与本地规则分析器逐项对比。
// 用法：先起后端（uvicorn motion_ai.api.app:app --port 8000），再 node scripts/test-backend.mjs [记录索引...]
import { readFileSync } from 'node:fs'
import { createServer } from 'vite'

const BASE = process.env.MOTION_AI_BASE_URL || 'http://127.0.0.1:8000'
const rows = JSON.parse(readFileSync('D:/lindoway/.tmp-data/collect.json', 'utf8'))
const server = await createServer({ configFile: 'vite.config.ts', server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' })
const { RepCounter } = await server.ssrLoadModule('/src/core/analysis/repCounter.ts')
const { classifyMotion } = await server.ssrLoadModule('/src/core/analysis/ruleClassifier.ts')
const { toApiSample } = await server.ssrLoadModule('/src/core/analysis/contract.ts')

let fail = 0
const check = (n, c, extra = '') => {
  console.log(`  ${c ? '✓' : '✗'} ${n}${extra ? `  ${extra}` : ''}`)
  if (!c) fail++
}

/** 复刻 useBleStore：计数 + 按次切样本 */
function collect(pkt) {
  const counter = new RepCounter()
  const ring = []
  const reps = []
  for (const s of pkt.samples) {
    ring.push(s)
    if (ring.length > 1000) ring.splice(0, ring.length - 1000)
    const ev = counter.push(s)
    if (ev) reps.push({ index: ev.index, samples: ring.filter((x) => x.t >= ev.startMs && x.t <= ev.endMs) })
  }
  const tail = counter.flush(pkt.samples.at(-1).t)
  if (tail) reps.push({ index: tail.index, samples: ring.filter((x) => x.t >= tail.startMs && x.t <= tail.endMs) })
  return reps
}

async function analyze(baseUrl, rep, actionId, sensorPosition = 'right_upper_arm') {
  const res = await fetch(`${baseUrl}/api/v1/motion/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId: 'session-e2e',
      actionId,
      sensorPosition,
      samples: rep.samples.map(toApiSample),
    }),
  })
  const text = await res.text()
  return { status: res.status, body: (() => { try { return JSON.parse(text) } catch { return text } })() }
}

console.log(`后端：${BASE}\n`)

// ---------- 1. 动作注册表 ----------
console.log('=== 1. GET /api/v1/actions ===')
const acts = await (await fetch(`${BASE}/api/v1/actions`)).json()
check('返回 2 个动作', acts.actions?.length === 2)
check('佩戴位置只有 right/left_upper_arm', JSON.stringify(acts.actions[0].sensorPositions) === '["right_upper_arm","left_upper_arm"]')
check('五阶段齐全', JSON.stringify(acts.actions[0].phases) === '["ready","lifting","top","lowering","complete"]')
check('五个错误码齐全', acts.actions[0].errorCodes.length === 5)

// ---------- 2. 真实数据逐次分析：后端 vs 本地 ----------
console.log('\n=== 2. 真实数据 · 后端 vs 本地规则分析器 ===')
const cases = process.argv.slice(2).length ? process.argv.slice(2).map(Number) : [24, 27, 2]
let compared = 0
let codeMatch = 0
for (const idx of cases) {
  const pkt = rows[idx]
  const actionId = pkt.actionId ?? 1
  const reps = collect(pkt)
  console.log(`\n记录 #${idx} ${pkt.actionName} → ${reps.length} 次`)
  for (const rep of reps.slice(0, 3)) {
    const local = classifyMotion(rep.samples, actionId)
    const { status, body } = await analyze(BASE, rep, actionId)
    if (status !== 200) {
      console.log(`  第${rep.index}次  ✗ HTTP ${status} ${JSON.stringify(body).slice(0, 160)}`)
      fail++
      continue
    }
    compared++
    const backendCodes = body.errors.map((e) => e.code).sort()
    const localCodes = local.errors.map((e) => e.code).sort()
    const same = JSON.stringify(backendCodes) === JSON.stringify(localCodes)
    if (same) codeMatch++
    console.log(
      `  第${rep.index}次  ${String(rep.samples.length).padStart(3)}点\n` +
        `    后端  错误=[${backendCodes.join(',') || '无'}]  总分=${body.score.overall}  信号可用=${body.signalQuality.isUsable}  阶段=${body.state.phase}\n` +
        `    本地  错误=[${localCodes.join(',') || '无'}]  总分=${local.score.overall}  信号可用=${local.signalQuality.isUsable}\n` +
        `    特征对比  durationMs ${body.features.durationMs} vs ${local.features.durationMs} | peak ${body.features.peakAngularVelocity?.toFixed?.(1)} vs ${local.features.peakAngularVelocity.toFixed(1)} | stability ${body.features.stabilityStd?.toFixed?.(2)} vs ${local.features.stabilityStd.toFixed(2)}\n` +
        `    错误码${same ? '一致 ✓' : '不一致 ✗'}`,
    )
    check(`  第${rep.index}次 模型字段包含决策策略`, body.model?.decisionPolicy === 'rule_primary_model_auxiliary')
  }
}
check(`错误码一致率 ${codeMatch}/${compared}`, codeMatch === compared, compared === 0 ? '（没有可比对的样本）' : '')

// ---------- 3. 校验与错误处理 ----------
console.log('\n=== 3. 后端校验行为 ===')
const rep0 = collect(rows[cases[0]])[0]
const badPos = await analyze(BASE, rep0, rows[cases[0]].actionId ?? 1, 'wrist')
check('不支持的佩戴位置 wrist → 422', badPos.status === 422, JSON.stringify(badPos.body).slice(0, 120))
const badAction = await analyze(BASE, rep0, 99)
check('不存在的 actionId → 404', badAction.status === 404, JSON.stringify(badAction.body).slice(0, 120))
const short = await analyze(BASE, { index: 1, samples: rep0.samples.slice(0, 20) }, rows[cases[0]].actionId ?? 1)
check('少于 32 点 → 422', short.status === 422, JSON.stringify(short.body).slice(0, 120))
const dupTs = { index: 1, samples: rep0.samples.map((s, i) => (i === 5 ? { ...s, t: rep0.samples[4].t } : s)) }
const dupRes = await analyze(BASE, dupTs, rows[cases[0]].actionId ?? 1)
check('时间戳重复 → 422', dupRes.status === 422, JSON.stringify(dupRes.body).slice(0, 120))

// ---------- 4. 教练接口 ----------
console.log('\n=== 4. POST /api/v1/coach/advice ===')
// 找一个命中高风险（INCOMPLETE_REPETITION）的真实样本，专门验安全覆盖
let highRiskAnalysis = null
let normalAnalysis = null
outer: for (const idx of cases) {
  const pkt = rows[idx]
  const actionId = pkt.actionId ?? 1
  for (const rep of collect(pkt)) {
    const { status, body } = await analyze(BASE, rep, actionId)
    if (status !== 200) continue
    if (body.errors.some((e) => e.severity === 'high')) {
      highRiskAnalysis = body
      break outer
    }
    if (!normalAnalysis) normalAnalysis = body
  }
}

async function coach(analysis) {
  const res = await fetch(`${BASE}/api/v1/coach/advice`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestType: 'single_rep_advice', analysis, userContext: null, question: null }),
  })
  return { status: res.status, body: await res.json() }
}

if (normalAnalysis) {
  const { status, body } = await coach(normalAnalysis)
  console.log(`  普通样本（${normalAnalysis.errors.map((e) => e.code).join(',') || '无错误'}）→ ${JSON.stringify(body)}`)
  check('未配 LLM 时走 fallback 而不是报错', status === 200 && body.source === 'fallback')
  check('含 schema 要求的全部字段', ['summary', 'suggestions', 'riskLevel', 'shouldStop', 'loadRecommendation', 'confidence'].every((k) => k in body))
  check('riskLevel 取值合法', ['low', 'medium', 'high'].includes(body.riskLevel))
  check('loadRecommendation 取值合法', ['increase', 'maintain', 'decrease'].includes(body.loadRecommendation))
}

if (highRiskAnalysis) {
  const { status, body } = await coach(highRiskAnalysis)
  console.log(`  高风险样本（${highRiskAnalysis.errors.map((e) => e.code).join(',')}）→ ${JSON.stringify(body)}`)
  check('高风险：HTTP 200', status === 200)
  check('高风险：riskLevel 强制 high', body.riskLevel === 'high')
  check('高风险：shouldStop 强制 true', body.shouldStop === true)
  check('高风险：loadRecommendation 强制 decrease', body.loadRecommendation === 'decrease')
} else {
  console.log('  （本次样本里没有命中高风险的，跳过安全覆盖用例）')
  fail++
  check('应能构造出高风险样本用于验证安全覆盖', false)
}

console.log(`\n${fail === 0 ? '端到端联调全部通过' : `${fail} 项未通过`}`)
await server.close()
process.exit(fail === 0 ? 0 : 1)
