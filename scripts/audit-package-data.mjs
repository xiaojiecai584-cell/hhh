// 清点工程包里的数据到底有多少可用信息
import { readFileSync, existsSync } from 'node:fs'
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const P = 'D:/lindoway/.tmp-data/pkg/fitness_motion_ai_package'

// ---- 1. real_experiment manifest ----
const mf = readFileSync(`${P}/data/real_experiment/annotations/manifest.jsonl`, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
console.log(`=== real_experiment/manifest.jsonl：${mf.length} 条 ===`)
const q = {}
const codeCount = {}
const srcCount = {}
const errPerSample = {}
for (const r of mf) {
  q[r.label.quality] = (q[r.label.quality] ?? 0) + 1
  srcCount[r.label.labelSource] = (srcCount[r.label.labelSource] ?? 0) + 1
  errPerSample[r.label.errors.length] = (errPerSample[r.label.errors.length] ?? 0) + 1
  for (const e of r.label.errors) codeCount[e.code] = (codeCount[e.code] ?? 0) + 1
}
console.log('quality   :', JSON.stringify(q))
console.log('labelSource:', JSON.stringify(srcCount))
console.log('每条错误数:', JSON.stringify(errPerSample))
console.log('错误码分布:', JSON.stringify(codeCount))
console.log('带至少 1 个错误的样本数:', mf.filter((r) => r.label.errors.length > 0).length)
console.log('actionId 分布:', JSON.stringify(mf.reduce((a, r) => ((a[r.actionId] = (a[r.actionId] ?? 0) + 1), a), {})))
console.log('每条的采样点数分布（前几条）:')
const ptCounts = {}
for (const r of mf) {
  const f = join(P, 'data/real_experiment', r.file.replace('../', ''))
  if (!existsSync(f)) continue
  const n = readFileSync(f, 'utf8').trim().split('\n').length - 1
  ptCounts[n] = (ptCounts[n] ?? 0) + 1
}
console.log('  点数→条数:', JSON.stringify(ptCounts))

// ---- 2. rule_baseline metrics ----
for (const rel of ['data/real_experiment/reports/rule_baseline/metrics.json', 'reports/baseline/metrics.json']) {
  const f = `${P}/${rel}`
  if (!existsSync(f)) continue
  const m = JSON.parse(readFileSync(f, 'utf8'))
  console.log(`\n=== ${rel} ===`)
  console.log('顶层字段:', Object.keys(m).join(', '))
  console.log('sampleCount:', m.sampleCount, ' exactMatchRate:', m.exactMatchRate, ' meanScore:', m.meanScore)
  if (Array.isArray(m.samples)) {
    console.log('前 3 条:')
    for (const s of m.samples.slice(0, 3)) console.log('  ', JSON.stringify(s))
    const withExpected = m.samples.filter((s) => (s.expected ?? []).length > 0).length
    console.log(`  有期望标签的样本: ${withExpected}/${m.samples.length}`)
  }
  if (m.perError) console.log('perError:', JSON.stringify(m.perError).slice(0, 600))
  if (m.perClass) console.log('perClass:', JSON.stringify(m.perClass).slice(0, 600))
  if (m.limitations) console.log('limitations:', m.limitations)
}

// ---- 3. inbox（模拟数据？）----
const inbox = `${P}/data/inbox`
let inboxN = 0
for (const a of readdirSync(inbox)) for (const k of readdirSync(join(inbox, a))) inboxN += readdirSync(join(inbox, a, k)).length
console.log(`\n=== data/inbox：${inboxN} 个 CSV（README 的 simulate 命令生成，模拟数据）===`)

// ---- 4. 根 .json ----
const rootJson = `${P}/.json`
const sz = statSync(rootJson).size
const head = readFileSync(rootJson, 'utf8').slice(0, 600)
console.log(`\n=== 根 .json：${(sz / 1024 / 1024).toFixed(2)} MB ===`)
console.log('开头:', head.replace(/\s+/g, ' ').slice(0, 500))

// ---- 5. 模板 ----
for (const t of ['seated_shoulder_press', 'standing_lateral_raise']) {
  const f = `${P}/data/artifacts/templates/${t}.json`
  if (!existsSync(f)) continue
  const j = JSON.parse(readFileSync(f, 'utf8'))
  console.log(`\n=== 模板 ${t} ===`)
  console.log('字段:', Object.keys(j).join(', '))
  console.log(JSON.stringify(j).slice(0, 400))
}
