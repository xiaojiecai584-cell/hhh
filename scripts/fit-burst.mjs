// 用 25 条标注录音评估「活动段计数」，并与旧算法对比；再做训练/验证划分。
// 运行：node scripts/fit-burst.mjs <json...>
import { readFileSync } from 'node:fs'
import { createServer } from 'vite'

const files = process.argv.slice(2)
const raw = []
for (const p of files) {
  const d = JSON.parse(readFileSync(p, 'utf8'))
  for (const s of d.samples ?? []) raw.push(s)
}

const server = await createServer({
  configFile: 'vite.config.ts',
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
})
const { countBursts, detectBursts } = await server.ssrLoadModule('/src/core/analysis/burstCounter.ts')
const { RepCounter } = await server.ssrLoadModule('/src/core/analysis/repCounter.ts')
const { repOptionsFor } = await server.ssrLoadModule('/src/core/analysis/repOptions.ts')

const data = raw.map((s) => ({
  s,
  frames: s.frames.map((f) => ({ t: f.t, ax: f.ax, ay: f.ay, az: f.az, gx: f.gx, gy: f.gy, gz: f.gz })),
}))

function oldCount(d) {
  const c = new RepCounter({ ...repOptionsFor(d.s.actionId) })
  for (const x of d.frames) c.push(x)
  c.flush(d.frames[d.frames.length - 1].t)
  return c.repCount
}

console.log(`样本 ${data.length} 条\n`)
console.log('=== 逐条：活动段计数 vs 旧算法 ===')
console.log('#  工况        真值  活动段  差   旧算法  差')
let okNew = 0
let okOld = 0
let absNew = 0
let absOld = 0
data.forEach((d, i) => {
  const n = countBursts(d.frames)
  const o = oldCount(d)
  const dn = n - d.s.trueReps
  const dOld = o - d.s.trueReps
  if (dn === 0) okNew++
  if (dOld === 0) okOld++
  absNew += Math.abs(dn)
  absOld += Math.abs(dOld)
  console.log(
    `${String(i + 1).padStart(2)}  ${(d.s.condition ?? '').padEnd(10)} ${String(d.s.trueReps).padStart(4)}  ` +
      `${String(n).padStart(6)}  ${String(dn).padStart(4)}   ${String(o).padStart(5)}  ${String(dOld).padStart(4)}`,
  )
})
console.log(`\n活动段：完全正确 ${okNew}/${data.length} = ${((okNew / data.length) * 100).toFixed(1)}%  平均绝对误差 ${(absNew / data.length).toFixed(2)}`)
console.log(`旧算法：完全正确 ${okOld}/${data.length} = ${((okOld / data.length) * 100).toFixed(1)}%  平均绝对误差 ${(absOld / data.length).toFixed(2)}`)

// ---- 参数网格 + 训练/验证划分 ----
const GRID = []
for (const signal of ['accel','omega'])
for (const highRatio of [0.35, 0.45, 0.55])
  for (const lowRatio of [0.12, 0.2, 0.3])
    for (const mergeGapMs of [300, 500, 800])
      for (const minSegMs of [100, 200, 350])
        for (const minSegPeakRatio of [0.2, 0.35, 0.5]) GRID.push({ signal, highRatio, lowRatio, mergeGapMs, minSegMs, minSegPeakRatio })

const table = GRID.map((g) => data.map((d) => countBursts(d.frames, g)))

let seed = 20250101
const rnd = () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
  return seed / 0x100000000
}

const ROUNDS = 20
let trSum = 0
let vaSum = 0
const freq = new Map()
for (let r = 0; r < ROUNDS; r++) {
  const idx = data.map((_, i) => i)
  for (let i = idx.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1))
    ;[idx[i], idx[j]] = [idx[j], idx[i]]
  }
  const cut = Math.round(idx.length * 0.7)
  const train = idx.slice(0, cut)
  const val = idx.slice(cut)
  let best = 0
  let bestScore = -1
  GRID.forEach((g, gi) => {
    let ok = 0
    for (const i of train) if (table[gi][i] === data[i].s.trueReps) ok++
    if (ok > bestScore) {
      bestScore = ok
      best = gi
    }
  })
  let vOk = 0
  for (const i of val) if (table[best][i] === data[i].s.trueReps) vOk++
  trSum += bestScore / train.length
  vaSum += vOk / val.length
  const k = JSON.stringify(GRID[best])
  freq.set(k, (freq.get(k) ?? 0) + 1)
}

console.log(`\n=== 训练/验证划分（70/30，20 轮）===`)
console.log(`训练集平均一致率 ${((trSum / ROUNDS) * 100).toFixed(1)}%`)
console.log(`验证集平均一致率 ${((vaSum / ROUNDS) * 100).toFixed(1)}%`)
console.log('\n被选中的参数组合：')
for (const [k, n] of [...freq.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${n} 次  ${k}`)

// ---- 全量最优 ----
let bestAll = 0
let bestScore = -1
GRID.forEach((g, gi) => {
  let ok = 0
  for (let i = 0; i < data.length; i++) if (table[gi][i] === data[i].s.trueReps) ok++
  if (ok > bestScore) {
    bestScore = ok
    bestAll = gi
  }
})
console.log(`\n全量最优（过拟合风险）：${JSON.stringify(GRID[bestAll])} → ${bestScore}/${data.length}`)

await server.close()
