// 次数（计数模型）的评估与划分验证。
// 每条样本都带 trueReps，可以像错误分类那样做"训练/验证"划分。
//
// 运行：node scripts/fit-counting.mjs <json...>
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
const { RepCounter } = await server.ssrLoadModule('/src/core/analysis/repCounter.ts')
const { repOptionsFor } = await server.ssrLoadModule('/src/core/analysis/repOptions.ts')

const data = raw.map((s) => ({
  s,
  samples: s.frames.map((f) => ({ t: f.t, ax: f.ax, ay: f.ay, az: f.az, gx: f.gx, gy: f.gy, gz: f.gz })),
}))

function countOf(item, extra = {}) {
  const c = new RepCounter({ ...repOptionsFor(item.s.actionId), ...extra })
  for (const x of item.samples) c.push(x)
  c.flush(item.samples[item.samples.length - 1].t)
  return c.repCount
}

// ---- 1. 当前参数逐条评估 ----
console.log(`样本 ${data.length} 条\n`)
console.log('=== 当前参数逐条评估 ===')
console.log('#  工况        真值  算法   差    时长    标注')
let exact = 0
let absErr = 0
const bad = []
data.forEach((d, i) => {
  const n = countOf(d)
  const diff = n - d.s.trueReps
  if (diff === 0) exact++
  absErr += Math.abs(diff)
  if (diff !== 0) bad.push({ i, d, n, diff })
  console.log(
    `${String(i + 1).padStart(2)}  ${(d.s.condition ?? '').padEnd(10)} ${String(d.s.trueReps).padStart(4)}  ` +
      `${String(n).padStart(4)}  ${String(diff).padStart(4)}  ${(d.s.durationMs / 1000).toFixed(1).padStart(6)}s  ` +
      `${(d.s.errorCodes ?? []).join(',') || '—'}`,
  )
})
console.log(`\n完全正确 ${exact}/${data.length} = ${((exact / data.length) * 100).toFixed(1)}%   平均绝对误差 ${(absErr / data.length).toFixed(2)} 次`)

// ---- 2. 多随机划分：训练集选参，验证集评估 ----
console.log('\n=== 训练/验证划分（每轮 70/30，重复 20 轮）===')
const GRID = []
for (const pauseOmegaFloor of [6, 10, 14, 20])
  for (const pauseQuietRatio of [0.25, 0.3, 0.4])
    for (const pauseQuietFrac of [0.55, 0.6, 0.7])
      for (const moveRatio of [0.5, 0.7, 0.9]) GRID.push({ pauseOmegaFloor, pauseQuietRatio, pauseQuietFrac, moveRatio })

// 预计算：每条样本在每个参数组合下的计数（避免重复跑）
const table = GRID.map((g) => data.map((d) => countOf(d, g)))

const ROUNDS = 20
let valExactSum = 0
let trainExactSum = 0
const picked = []
// 简单可复现的伪随机
let seed = 12345
const rnd = () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
  return seed / 0x100000000
}

for (let r = 0; r < ROUNDS; r++) {
  const idx = data.map((_, i) => i)
  for (let i = idx.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1))
    ;[idx[i], idx[j]] = [idx[j], idx[i]]
  }
  const cut = Math.round(idx.length * 0.7)
  const train = idx.slice(0, cut)
  const val = idx.slice(cut)

  // 在训练集上选最佳参数
  let best = -1
  let bestScore = -1
  GRID.forEach((g, gi) => {
    let ok = 0
    for (const i of train) if (table[gi][i] === data[i].s.trueReps) ok++
    if (ok > bestScore) {
      bestScore = ok
      best = gi
    }
  })
  // 在验证集上评估
  let vOk = 0
  for (const i of val) if (table[best][i] === data[i].s.trueReps) vOk++
  const trAcc = bestScore / train.length
  const vAcc = vOk / val.length
  trainExactSum += trAcc
  valExactSum += vAcc
  picked.push({ g: GRID[best], trAcc, vAcc })
}

console.log(`训练集平均一致率 ${((trainExactSum / ROUNDS) * 100).toFixed(1)}%`)
console.log(`验证集平均一致率 ${((valExactSum / ROUNDS) * 100).toFixed(1)}%`)
const freq = new Map()
for (const p of picked) {
  const k = JSON.stringify(p.g)
  freq.set(k, (freq.get(k) ?? 0) + 1)
}
console.log('\n20 轮中被选中的参数组合：')
for (const [k, n] of [...freq.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${n} 次  ${k}`)

// ---- 3. 全量网格最优（仅供参考，容易过拟合）----
let bestAll = -1
let bestAllScore = -1
GRID.forEach((g, gi) => {
  let ok = 0
  for (let i = 0; i < data.length; i++) if (table[gi][i] === data[i].s.trueReps) ok++
  if (ok > bestAllScore) {
    bestAllScore = ok
    bestAll = gi
  }
})
console.log(`\n全量最优（过拟合风险高，仅参考）：${JSON.stringify(GRID[bestAll])} → ${bestAllScore}/${data.length}`)

await server.close()
