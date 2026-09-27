// 报告链路端到端验证（本地路径）：
// 真实录音 → RepCounter 逐样本计数 → 按起止时间切出每次重复的原始样本（与 useBleStore 同逻辑）
// → analyzeSet 逐次分析并汇总 → 打印报告
// 运行：node scripts/verify-report.mjs [记录索引]
import { readFileSync } from 'node:fs'
import { createServer } from 'vite'

const rows = JSON.parse(readFileSync('D:/lindoway/.tmp-data/collect.json', 'utf8'))
const server = await createServer({ configFile: 'vite.config.ts', server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' })
const { RepCounter } = await server.ssrLoadModule('/src/core/analysis/repCounter.ts')
const { analyzeSet } = await server.ssrLoadModule('/src/core/analysis/setAnalysis.ts')

const ERROR_LABEL = {
  INSUFFICIENT_RANGE: '行程不足',
  TEMPO_TOO_FAST: '动作过快',
  TEMPO_TOO_SLOW: '动作过慢',
  UNSTABLE_MOTION: '动作不稳定',
  INCOMPLETE_REPETITION: '未完整完成',
}

/** 复刻 useBleStore 的采集流程：样本环 + 按 [startMs,endMs] 切片 */
function collect(pkt) {
  const counter = new RepCounter()
  const ring = []
  const RING_MAX = 1000
  const reps = []
  for (const sample of pkt.samples) {
    ring.push(sample)
    if (ring.length > RING_MAX) ring.splice(0, ring.length - RING_MAX)
    const ev = counter.push(sample)
    if (ev) reps.push({ index: ev.index, samples: ring.filter((x) => x.t >= ev.startMs && x.t <= ev.endMs) })
  }
  const tail = counter.flush(pkt.samples.at(-1).t)
  if (tail) reps.push({ index: tail.index, samples: ring.filter((x) => x.t >= tail.startMs && x.t <= tail.endMs) })
  return { counter, reps }
}

const idx = Number(process.argv[2] ?? 2)
const pkt = rows[idx]
console.log(`=== 记录 #${idx} ${pkt.actionName} actionId=${pkt.actionId} n=${pkt.samples.length} ===`)

const { counter, reps } = collect(pkt)
console.log(`计数：${counter.repCount} 次；带样本的重复 ${reps.length} 个`)
console.log(`每次的样本点数：${reps.map((r) => r.samples.length).join(', ')}`)

const set = await analyzeSet(reps, {
  actionId: pkt.actionId ?? 1,
  actionName: pkt.actionName ?? '未知',
  sensorPosition: 'right_upper_arm',
  sessionId: 'session-verify',
  baseUrl: '', // 空 = 本地规则分析器
})

if (!set) {
  console.log('\n✗ analyzeSet 返回 null（没有任何 ≥32 点的重复）')
  await server.close()
  process.exit(1)
}

console.log('\n=== 生成的报告 ===')
console.log(`动作        ${set.actionName}（actionId=${set.actionId}）`)
console.log(`来源        ${set.backendUsed ? '后端' : '本地规则分析器'}${set.backendError ? `（后端错误：${set.backendError}）` : ''}`)
console.log(`次数        ${set.totalReps} 次，信号可用 ${set.usableReps} 次`)
console.log(`总分        ${set.avgScore.overall}`)
console.log(`  行程      ${set.avgScore.rangeOfMotion}`)
console.log(`  节奏      ${set.avgScore.tempo}`)
console.log(`  稳定      ${set.avgScore.stability}`)
console.log(`  一致性    ${set.avgScore.consistency}`)
console.log(`高风险      ${set.hasHighRisk ? '是' : '否'}`)
console.log('错误分布：')
for (const e of set.errors) {
  console.log(`  ${(ERROR_LABEL[e.code] ?? e.code).padEnd(6)} ${String(e.count).padStart(2)}/${set.usableReps} 次  严重度=${e.severity}  阶段=${e.phase ?? '-'}`)
}
if (set.signalIssues.length) console.log('信号问题：', JSON.stringify(set.signalIssues))
console.log('逐次明细：')
for (const r of set.reps) {
  const errs = r.errors.map((e) => ERROR_LABEL[e.code] ?? e.code).join('/')
  console.log(
    `  第${String(r.index).padStart(2)}次  ${(r.durationMs / 1000).toFixed(1)}s  ${String(r.sampleCount).padStart(3)}点  ${r.score.overall.toFixed(0)}分  ` +
      `${r.usable ? '' : '[信号不可用] '}${errs || (r.usable ? '标准' : '')}`,
  )
}

// ---- 断言 ----
let fail = 0
const check = (n, c, extra = '') => {
  console.log(`  ${c ? '✓' : '✗'} ${n}${extra ? `  ${extra}` : ''}`)
  if (!c) fail++
}
console.log('\n=== 断言 ===')
check('报告对象完整', !!set && typeof set.avgScore.overall === 'number' && Array.isArray(set.reps))
check('逐次结果数量与次数一致', set.reps.length === set.totalReps)
check('每个分项都有值', ['rangeOfMotion', 'tempo', 'stability', 'consistency'].every((k) => typeof set.avgScore[k] === 'number'))
check('来源标记为本地规则', !set.backendUsed && set.backendError === null)
check('每次重复都带样本点数', set.reps.every((r) => r.sampleCount >= 32))
check('错误均为规则来源', set.reps.every((r) => r.errors.every((e) => e.source === 'rule')))
check('无高风险时不给 shouldStop 类置位', set.hasHighRisk === set.reps.some((r) => r.errors.some((e) => e.severity === 'high')))

console.log(`\n${fail === 0 ? '报告链路（本地路径）验证通过' : `${fail} 项未通过`}`)
await server.close()
process.exit(fail === 0 ? 0 : 1)
